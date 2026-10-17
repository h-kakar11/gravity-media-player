import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ChapterInfo, FfmpegInfo, ProbeInfo, StreamInfo } from '@shared/types';
import type { SettingsStore } from '../settings-store';
import { logger } from '../log';

const log = logger('ffmpeg');
const nodeRequire = createRequire(import.meta.url);

function unpacked(p: string): string {
  // Binaries inside app.asar can't be executed; electron-builder unpacks them next to it.
  return p.replace('app.asar' + (process.platform === 'win32' ? '\\' : '/'), 'app.asar.unpacked' + (process.platform === 'win32' ? '\\' : '/'));
}

function bundledPath(pkg: string): string | null {
  try {
    const mod = nodeRequire(pkg) as { path?: string };
    return mod.path ? unpacked(mod.path) : null;
  } catch {
    return null;
  }
}

function works(bin: string, flag = '-version'): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, [flag], { timeout: 8000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : d;
};

function parseRate(r: unknown): number {
  if (typeof r !== 'string') return 0;
  const [a, b] = r.split('/').map(Number);
  if (!a || !b) return 0;
  return a / b;
}

export function bitDepthOf(pixFmt: string, raw: unknown): number {
  const n = num(raw);
  if (n > 0) return n;
  const m = /(?:p|le|be)(\d{2})(?:le|be)?$/.exec(pixFmt) ?? /yuv\d{3}p(\d{2})/.exec(pixFmt);
  if (m) return Number(m[1]);
  if (/^p0(10|12|16)/.test(pixFmt)) return Number(pixFmt.slice(2, 4));
  return 8;
}

type FfStream = Record<string, unknown> & { tags?: Record<string, string>; disposition?: Record<string, number>; side_data_list?: Record<string, unknown>[] };

export function parseProbe(json: unknown): ProbeInfo {
  const j = json as { format?: Record<string, unknown> & { tags?: Record<string, string> }; streams?: FfStream[]; chapters?: Record<string, unknown>[] };
  const f = j.format ?? {};
  const streams: StreamInfo[] = (j.streams ?? []).map((s) => {
    const type = s.codec_type === 'video' || s.codec_type === 'audio' || s.codec_type === 'subtitle' || s.codec_type === 'attachment' ? s.codec_type : 'data';
    const pixFmt = String(s.pix_fmt ?? '');
    const tags = s.tags ?? {};
    const fpsAvg = parseRate(s.avg_frame_rate);
    const fpsR = parseRate(s.r_frame_rate);
    // r_frame_rate can report tbr (e.g. 1000) for VFR files; prefer avg when plausible.
    const fps = fpsAvg > 0 && fpsAvg <= 1000 ? fpsAvg : fpsR > 0 && fpsR <= 1000 ? fpsR : 0;
    let rotation = num(tags.rotate);
    for (const sd of s.side_data_list ?? []) if (sd.rotation != null) rotation = num(sd.rotation);
    return {
      index: num(s.index),
      type,
      codec: String(s.codec_name ?? 'unknown'),
      profile: String(s.profile ?? ''),
      level: num(s.level),
      width: num(s.width),
      height: num(s.height),
      pixFmt,
      bitDepth: bitDepthOf(pixFmt, s.bits_per_raw_sample),
      fps,
      bitrate: num(s.bit_rate),
      channels: num(s.channels),
      channelLayout: String(s.channel_layout ?? ''),
      sampleRate: num(s.sample_rate),
      language: String(tags.language ?? tags.LANGUAGE ?? ''),
      title: String(tags.title ?? tags.TITLE ?? tags.handler_name ?? '').replace(/^(SoundHandler|VideoHandler|SubtitleHandler|Core Media Audio|Core Media Video)$/, ''),
      isDefault: s.disposition?.default === 1,
      isForced: s.disposition?.forced === 1,
      attachedPic: s.disposition?.attached_pic === 1,
      colorTransfer: String(s.color_transfer ?? ''),
      rotation: ((Math.round(rotation) % 360) + 360) % 360
    };
  });
  const chapters: ChapterInfo[] = (j.chapters ?? []).map((c) => ({
    startSec: num(c.start_time),
    endSec: num(c.end_time),
    title: String((c.tags as Record<string, string> | undefined)?.title ?? '')
  }));
  let duration = num(f.duration);
  if (!duration) duration = Math.max(0, ...((j.streams ?? []).map((s) => num(s.duration))));
  return {
    container: String(f.format_name ?? '').split(',')[0] ?? '',
    formatName: String(f.format_name ?? ''),
    durationSec: duration,
    bitrate: num(f.bit_rate),
    size: num(f.size),
    streams,
    chapters
  };
}

export class Ffmpeg {
  private info: FfmpegInfo | null = null;
  private infoPromise: Promise<FfmpegInfo> | null = null;
  private hwProbe: Promise<string[]> | null = null;

  constructor(private readonly settings: SettingsStore) {
    settings.on('changed', () => { this.info = null; this.infoPromise = null; this.hwProbe = null; });
  }

  /** Resolve binaries: user-configured path → system PATH → bundled static build. */
  async resolve(): Promise<FfmpegInfo> {
    if (this.info) return this.info;
    if (this.infoPromise) return this.infoPromise;
    this.infoPromise = this.doResolve().then((i) => (this.info = i));
    return this.infoPromise;
  }

  private async doResolve(): Promise<FfmpegInfo> {
    const cfg = this.settings.get().ffmpeg;
    const candidates: { ff: string; fp: string; source: FfmpegInfo['source'] }[] = [];
    if (cfg.path) candidates.push({ ff: cfg.path, fp: cfg.ffprobePath || cfg.path.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), source: 'custom' });
    const exe = process.platform === 'win32' ? '.exe' : '';
    candidates.push({ ff: `ffmpeg${exe}`, fp: `ffprobe${exe}`, source: 'system' });
    const bf = bundledPath('@ffmpeg-installer/ffmpeg');
    const bp = bundledPath('@ffprobe-installer/ffprobe');
    if (bf && bp && existsSync(bf) && existsSync(bp)) candidates.push({ ff: bf, fp: bp, source: 'bundled' });

    for (const c of candidates) {
      const [v, pv] = await Promise.all([works(c.ff), works(c.fp)]);
      if (v && pv) {
        const version = /version\s+(\S+)/.exec(v)?.[1] ?? null;
        const encoders = await this.listEncoders(c.ff);
        const hw = await this.listHwaccels(c.ff);
        log.info(`Using ${c.source} ffmpeg ${version} (${c.ff})`);
        return { ffmpegPath: c.ff, ffprobePath: c.fp, version, source: c.source, encoders, hwaccels: hw };
      }
    }
    log.warn('ffmpeg not found; only natively supported formats will play');
    return { ffmpegPath: null, ffprobePath: null, version: null, source: 'none', encoders: [], hwaccels: [] };
  }

  private listEncoders(ff: string): Promise<string[]> {
    return new Promise((resolve) => {
      execFile(ff, ['-hide_banner', '-encoders'], { timeout: 10000, windowsHide: true, maxBuffer: 4_000_000 }, (err, out) => {
        if (err) return resolve([]);
        const wanted = ['libx264', 'libx265', 'aac', 'flac', 'libopus', 'libvpx-vp9', 'h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_amf', 'h264_mf'];
        resolve(wanted.filter((e) => new RegExp(`\\s${e}\\s`).test(String(out))));
      });
    });
  }

  private listHwaccels(ff: string): Promise<string[]> {
    return new Promise((resolve) => {
      execFile(ff, ['-hide_banner', '-hwaccels'], { timeout: 8000, windowsHide: true }, (err, out) => {
        if (err) return resolve([]);
        resolve(String(out).split('\n').slice(1).map((l) => l.trim()).filter(Boolean));
      });
    });
  }

  async ffmpegBin(): Promise<string> {
    const i = await this.resolve();
    if (!i.ffmpegPath) throw new Error('ffmpeg is not available');
    return i.ffmpegPath;
  }

  async available(): Promise<boolean> {
    return (await this.resolve()).ffmpegPath != null;
  }

  async probe(file: string): Promise<{ info: ProbeInfo; raw: string }> {
    const i = await this.resolve();
    if (!i.ffprobePath) throw new Error('ffprobe is not available');
    const raw = await new Promise<string>((resolve, reject) => {
      execFile(
        i.ffprobePath!,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', '-i', file],
        { timeout: 45_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout)))
      );
    });
    return { info: parseProbe(JSON.parse(raw)), raw };
  }

  /** Time (seconds) of the keyframe ffmpeg lands on when seeking to `t` — needed for accurate stream-copy offsets. */
  async keyframeBefore(file: string, t: number): Promise<number> {
    const i = await this.resolve();
    if (!i.ffprobePath || t <= 0) return Math.max(0, t);
    return new Promise((resolve) => {
      execFile(
        i.ffprobePath!,
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', '-read_intervals', `${t.toFixed(3)}%+#1`, '-i', file],
        { timeout: 20_000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(t);
          const line = String(stdout).split('\n').find((l) => l.includes(','));
          const pts = line ? parseFloat(line.split(',')[0]!) : NaN;
          resolve(Number.isFinite(pts) && pts <= t + 0.001 ? pts : t);
        }
      );
    });
  }

  spawn(args: string[], opts: { stdin?: 'ignore' | 'pipe' } = {}): ChildProcess {
    const bin = this.info?.ffmpegPath;
    if (!bin) throw new Error('ffmpeg is not available');
    return spawn(bin, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
      stdio: [opts.stdin ?? 'ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  }

  /** Run ffmpeg to completion and return stdout. Rejects on non-zero exit with stderr in the message. */
  async runBuffer(args: string[], timeoutMs = 60_000): Promise<Buffer> {
    await this.resolve();
    return new Promise((resolve, reject) => {
      const p = this.spawn(args);
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, timeoutMs);
      p.stdout!.on('data', (d: Buffer) => out.push(d));
      p.stderr!.on('data', (d: Buffer) => err.push(d));
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(out));
        else reject(new Error(`ffmpeg exited with ${code}: ${Buffer.concat(err).toString().slice(0, 400)}`));
      });
    });
  }

  /**
   * Hardware H.264 encoders that actually work on this machine. Listing encoders isn't enough
   * (e.g. NVENC is compiled in but there's no GPU), so each candidate does a one-frame test encode.
   */
  async workingHwEncoders(): Promise<string[]> {
    if (this.hwProbe) return this.hwProbe;
    this.hwProbe = (async () => {
      const i = await this.resolve();
      if (!i.ffmpegPath) return [];
      const tests: { enc: string; pre: string[]; vf?: string }[] = [
        { enc: 'h264_videotoolbox', pre: [] },
        { enc: 'h264_nvenc', pre: [] },
        { enc: 'h264_qsv', pre: [] },
        { enc: 'h264_amf', pre: [] },
        { enc: 'h264_vaapi', pre: ['-vaapi_device', '/dev/dri/renderD128'], vf: 'format=nv12,hwupload' }
      ].filter((t) => i.encoders.includes(t.enc));
      const ok: string[] = [];
      for (const t of tests) {
        try {
          await this.runBuffer([...t.pre, '-f', 'lavfi', '-i', 'color=c=black:s=256x144:d=0.2:r=10', ...(t.vf ? ['-vf', t.vf] : []), '-frames:v', '2', '-c:v', t.enc, '-f', 'null', '-'], 10_000);
          ok.push(t.enc);
        } catch { /* not usable */ }
      }
      log.info('Working hardware encoders:', ok.join(', ') || 'none');
      return ok;
    })();
    return this.hwProbe;
  }
}
