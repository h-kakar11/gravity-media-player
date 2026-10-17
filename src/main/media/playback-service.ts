import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { NATIVE_AUDIO_CONTAINERS } from '@shared/formats';
import type { PlaybackRequest, PlaybackSession, ProbeInfo } from '@shared/types';
import type { LibraryRepo } from '../db/repo';
import type { SettingsStore } from '../settings-store';
import { logger } from '../log';
import { Ffmpeg, parseProbe } from './ffmpeg';
import { buildAudioArgs, buildStreamArgs } from './ffmpeg-args';

const log = logger('playback');

interface Session {
  sid: string;
  mediaId: number;
  path: string;
  args: string[];
  mime: string;
  proc: ChildProcess | null;
  lastAccess: number;
  stderr: string;
}

/**
 * Owns ffmpeg sessions that feed the <video>/<audio> elements. A session is created by the
 * renderer (after it decided how the file should be played), and ffmpeg is spawned only when
 * the media element actually requests the stream URL. Closing the element, seeking to an
 * unbuffered position, or quitting the app kills the process.
 */
export class PlaybackService {
  private readonly sessions = new Map<string, Session>();
  private zscale: boolean | null = null;
  private gc: NodeJS.Timeout;

  constructor(private readonly repo: LibraryRepo, private readonly ffmpeg: Ffmpeg, private readonly settings: SettingsStore) {
    this.gc = setInterval(() => this.collect(), 60_000);
    this.gc.unref();
  }

  /** ffprobe results are cached in the database and invalidated when the file changes. */
  async probe(mediaId: number): Promise<ProbeInfo> {
    const row = this.repo.getRow(mediaId);
    if (!row) throw new Error('Media not found');
    const cached = this.repo.getProbeJson(mediaId);
    if (cached) {
      try { return parseProbe(JSON.parse(cached)); } catch { /* re-probe */ }
    }
    const { info, raw } = await this.ffmpeg.probe(String(row.path));
    this.repo.saveProbe(mediaId, raw);
    return info;
  }

  private async hasZscale(): Promise<boolean> {
    if (this.zscale != null) return this.zscale;
    try {
      const out = await this.ffmpeg.runBuffer(['-filters']);
      this.zscale = /\szscale\s/.test(out.toString()) && /\stonemap\s/.test(out.toString());
    } catch {
      this.zscale = false;
    }
    return this.zscale;
  }

  private async pickEncoder(): Promise<string> {
    const pref = this.settings.get().playback.hwaccel;
    if (pref === 'none') return 'libx264';
    const working = await this.ffmpeg.workingHwEncoders();
    if (pref !== 'auto') return working.includes(pref) ? pref : 'libx264';
    // Prefer the most efficient working encoder.
    for (const e of ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_vaapi']) if (working.includes(e)) return e;
    return 'libx264';
  }

  async open(req: PlaybackRequest): Promise<PlaybackSession> {
    const row = this.repo.getRow(req.mediaId);
    if (!row) throw new Error('Media not found');
    const path = String(row.path);
    const probe = await this.probe(req.mediaId);
    const base = { durationSec: probe.durationSec || Number(row.duration) || 0, audioIndex: req.audioIndex, reason: req.reason };
    const sid = randomUUID();

    if (req.mode === 'direct') {
      return { sid, mode: 'direct', url: `gravity://app/media/${req.mediaId}`, offsetSec: 0, encoder: '', videoCodecOut: probe.streams.find((s) => s.type === 'video')?.codec ?? '', audioCodecOut: probe.streams.find((s) => s.type === 'audio')?.codec ?? '', ...base };
    }
    if (!(await this.ffmpeg.available())) throw new Error('This file needs ffmpeg to play, but ffmpeg was not found. Install ffmpeg or set its path in Settings → Playback.');

    const hasVideo = probe.streams.some((s) => s.type === 'video' && !s.attachedPic);
    const ext = String(row.ext);
    // Audio-only files (music) use the FLAC path; everything else becomes fragmented MP4.
    if (!hasVideo || (String(row.kind) === 'audio')) {
      const { args, mime } = buildAudioArgs({ file: path, startSec: req.startSec, probe, audioIndex: req.audioIndex });
      this.sessions.set(sid, { sid, mediaId: req.mediaId, path, args, mime, proc: null, lastAccess: Date.now(), stderr: '' });
      return { sid, mode: 'transcode', url: `gravity://app/stream/${sid}`, offsetSec: Math.max(0, req.startSec), encoder: 'flac', videoCodecOut: '', audioCodecOut: 'flac', ...base };
    }

    const mode = req.mode === 'remux' ? 'remux' : 'transcode';
    // Stream copy can only start on a keyframe; report the real start so the UI clock stays accurate.
    const start = mode === 'remux' ? await this.ffmpeg.keyframeBefore(path, req.startSec) : Math.max(0, req.startSec);
    const encoder = mode === 'transcode' ? await this.pickEncoder() : 'copy';
    const plan = buildStreamArgs({
      file: path, mode, startSec: start, probe, audioIndex: req.audioIndex, burnSubtitle: req.burnSubtitle, maxHeight: req.maxHeight || this.settings.get().playback.transcodeMaxHeight,
      encoder, quality: this.settings.get().playback.transcodeQuality, hasZscale: await this.hasZscale()
    });
    this.sessions.set(sid, { sid, mediaId: req.mediaId, path, args: plan.args, mime: 'video/mp4', proc: null, lastAccess: Date.now(), stderr: '' });
    log.info(`Session ${sid.slice(0, 8)} ${mode} (${plan.encoder}) from ${start.toFixed(1)}s: ${ext} ${req.reason}`);
    return { sid, mode, url: `gravity://app/stream/${sid}`, offsetSec: start, encoder: plan.encoder, videoCodecOut: plan.videoOut, audioCodecOut: plan.audioOut, ...base };
  }

  /** Called by the protocol handler when the media element requests the stream. */
  stream(sid: string, signal: AbortSignal): Response {
    const s = this.sessions.get(sid);
    if (!s) return new Response('Unknown session', { status: 404 });
    this.kill(s);
    s.lastAccess = Date.now();
    s.stderr = '';
    const proc = this.ffmpeg.spawn(s.args);
    s.proc = proc;
    proc.stderr?.on('data', (d: Buffer) => { s.stderr = (s.stderr + d.toString()).slice(-2000); });
    proc.on('close', (code) => {
      if (s.proc === proc) s.proc = null;
      if (code && code !== 255 && s.stderr.trim()) log.warn(`ffmpeg ${sid.slice(0, 8)} exited ${code}: ${s.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    });
    signal.addEventListener('abort', () => { if (s.proc === proc) this.kill(s); }, { once: true });
    const body = Readable.toWeb(proc.stdout!) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers: { 'Content-Type': s.mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' } });
  }

  private kill(s: Session): void {
    if (s.proc && !s.proc.killed) {
      try { s.proc.kill('SIGKILL'); } catch { /* already gone */ }
    }
    s.proc = null;
  }

  close(sid: string): void {
    const s = this.sessions.get(sid);
    if (!s) return;
    this.kill(s);
    this.sessions.delete(sid);
  }

  closeAll(): void {
    for (const s of this.sessions.values()) this.kill(s);
    this.sessions.clear();
    clearInterval(this.gc);
  }

  private collect(): void {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [sid, s] of this.sessions) if (!s.proc && s.lastAccess < cutoff) this.sessions.delete(sid);
  }

  activeCount(): number {
    return [...this.sessions.values()].filter((s) => s.proc).length;
  }

  /** Whether a path is plausibly playable by Chromium without ffmpeg (used for quick checks). */
  static nativeAudio(ext: string): boolean {
    return NATIVE_AUDIO_CONTAINERS.has(ext.toLowerCase());
  }

  fileExists(mediaId: number): boolean {
    const row = this.repo.getRow(mediaId);
    if (!row) return false;
    try { statSync(String(row.path)); return true; } catch { return false; }
  }
}
