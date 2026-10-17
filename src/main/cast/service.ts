import { networkInterfaces } from 'node:os';
import { mimeForExt } from '@shared/formats';
import { IDLE_CAST, castContentType, pickLocalAddress, planCast, type CastCommand, type CastDevice, type CastState, type CastStatus } from '@shared/cast';
import type { PlaybackRequest, PlaybackSession, ProbeInfo } from '@shared/types';
import type { Settings } from '@shared/settings';
import { logger } from '../log';
import { CastV2, type MediaStatus } from './castv2';
import { DlnaClient } from './dlna';
import { discoverChromecasts } from './mdns';
import { CastServer, type CastSource } from './server';
import { discoverDlna } from './ssdp';

const log = logger('cast');

export interface Found { device: CastDevice; controlUrl?: string; port?: number }

/** What the service needs from the rest of the app, so tests can supply fakes. */
export interface CastDeps {
  getRow(id: number): Record<string, unknown> | undefined;
  playback: {
    probe(mediaId: number): Promise<ProbeInfo>;
    open(req: PlaybackRequest): Promise<PlaybackSession>;
    stream(sid: string, signal: AbortSignal): Response;
    close(sid: string): void;
  };
  settings: { get(): Settings; on(event: 'changed', fn: (s: Settings) => void): unknown };
  emit(status: CastStatus): void;
  discover?: () => Promise<Found[]>;
  interfaces?: () => { address: string; netmask: string }[];
}

const localInterfaces = () => Object.values(networkInterfaces()).flat()
  .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4')
  .map((i) => ({ address: i.address, netmask: i.netmask }));

async function lanDiscovery(): Promise<Found[]> {
  const [dlna, cc] = await Promise.allSettled([discoverDlna(), discoverChromecasts()]);
  return [
    ...(dlna.status === 'fulfilled' ? dlna.value.map((d) => ({ device: d.device, controlUrl: d.controlUrl })) : []),
    ...(cc.status === 'fulfilled' ? cc.value.map((d) => ({ device: d.device, port: d.port })) : [])
  ];
}

const STATE_FROM_CC: Record<MediaStatus['playerState'], CastState> = { IDLE: 'idle', BUFFERING: 'buffering', PLAYING: 'playing', PAUSED: 'paused' };
const STATE_FROM_DLNA: Record<string, CastState> = { PLAYING: 'playing', PAUSED_PLAYBACK: 'paused', TRANSITIONING: 'buffering' };

/**
 * Owns at most one cast at a time: discovery, the temporary token server, the protocol client for
 * the chosen device, and the transcode session when the file needs converting. Everything is off
 * until `settings.cast.enabled` is switched on, and turning it off again tears a running cast down.
 */
export class CastService {
  private found = new Map<string, Found>();
  private status: CastStatus = IDLE_CAST;
  private server: CastServer | null = null;
  private dlna: DlnaClient | null = null;
  private cc: CastV2 | null = null;
  private sid: string | null = null;
  private offsetSec = 0;
  private url = '';
  private timer: NodeJS.Timeout | null = null;
  private playedOnce = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: CastDeps) {
    d.settings.on('changed', (s) => { if (!s.cast.enabled && this.status.state !== 'idle') void this.stop(); });
  }

  private enabled(): boolean { return this.d.settings.get().cast.enabled; }

  devices(): CastDevice[] {
    return this.enabled() ? [...this.found.values()].map((f) => f.device).sort((a, b) => a.name.localeCompare(b.name)) : [];
  }

  async discover(): Promise<CastDevice[]> {
    if (!this.enabled()) throw new Error('Casting is turned off. Enable it in Settings → Casting.');
    const list = await (this.d.discover ?? lanDiscovery)();
    this.found = new Map(list.map((f) => [f.device.id, f]));
    return this.devices();
  }

  getStatus(): CastStatus { return this.status; }

  private set(patch: Partial<CastStatus>): void {
    this.status = { ...this.status, ...patch };
    this.d.emit(this.status);
  }

  /** Operations run one at a time so a quick seek-seek-pause can't interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  start(deviceId: string, mediaId: number, startSec: number, audioIndex: number): Promise<CastStatus> {
    return this.serial(() => this.doStart(deviceId, mediaId, startSec, audioIndex));
  }

  control(cmd: CastCommand): Promise<CastStatus> {
    return this.serial(async () => {
      if (this.status.state === 'idle' || this.status.state === 'error') return this.status;
      try {
        if (cmd.type === 'stop') await this.doStop();
        else if (cmd.type === 'seek') await this.doSeek(cmd.sec);
        else {
          if (this.dlna) await (cmd.type === 'play' ? this.dlna.play() : this.dlna.pause());
          if (this.cc) await (cmd.type === 'play' ? this.cc.play() : this.cc.pause());
          this.set({ state: cmd.type === 'play' ? 'playing' : 'paused' });
        }
      } catch (err) {
        await this.fail(err);
      }
      return this.status;
    });
  }

  stop(): Promise<CastStatus> { return this.serial(async () => { await this.doStop(); return this.status; }); }

  private async sourceFor(mediaId: number, startSec: number, plan: ReturnType<typeof planCast>, ext: string): Promise<{ source: CastSource; offsetSec: number; sid: string | null; session: PlaybackSession | null }> {
    const row = this.d.getRow(mediaId)!;
    if (plan.mode === 'direct') {
      return { source: { kind: 'file', path: String(row.path), mime: castContentType('direct', ext, mimeForExt) }, offsetSec: 0, sid: null, session: null };
    }
    const session = await this.d.playback.open({ mediaId, mode: plan.mode, startSec, audioIndex: plan.audioIndex, maxHeight: plan.maxHeight, burnSubtitle: -1, reason: plan.reason });
    return { source: { kind: 'stream', mime: 'video/mp4', open: (signal) => this.d.playback.stream(session.sid, signal) }, offsetSec: session.offsetSec, sid: session.sid, session };
  }

  private async doStart(deviceId: string, mediaId: number, startSec: number, audioIndex: number): Promise<CastStatus> {
    if (!this.enabled()) throw new Error('Casting is turned off. Enable it in Settings → Casting.');
    const found = this.found.get(deviceId);
    if (!found) throw new Error('That device is no longer visible. Scan again.');
    const row = this.d.getRow(mediaId);
    if (!row || String(row.kind) !== 'video') throw new Error('Only videos can be cast.');
    await this.doStop();
    const { device } = found;
    const title = String(row.title ?? '');
    this.playedOnce = false;
    this.set({ ...IDLE_CAST, state: 'connecting', device, mediaId, title, durationSec: Number(row.duration) || 0 });
    try {
      const ext = String(row.ext);
      const probe = await this.d.playback.probe(mediaId);
      const plan = planCast(probe, ext, device.protocol, audioIndex);
      const local = pickLocalAddress(device.address, (this.d.interfaces ?? localInterfaces)());
      if (!local) throw new Error(`This computer has no network address on the same network as ${device.name}.`);
      const src = await this.sourceFor(mediaId, startSec, plan, ext);
      this.sid = src.sid;
      this.offsetSec = src.offsetSec;
      this.server = new CastServer(device.address);
      await this.server.listen(local);
      this.url = this.server.url(local) + this.server.setSource(src.source);
      const live = plan.mode !== 'direct';
      this.set({ mode: plan.mode, reason: plan.reason, seekRestarts: live, durationSec: probe.durationSec || Number(row.duration) || 0, positionSec: src.offsetSec });
      const mime = src.source.mime;
      if (device.protocol === 'dlna') {
        if (!found.controlUrl) throw new Error('This renderer did not advertise a control URL.');
        this.dlna = new DlnaClient(found.controlUrl);
        await this.dlna.setUri(this.url, title, mime);
        await this.dlna.play();
        if (!live && startSec > 1) await this.dlna.seek(startSec);
      } else {
        const cc = new CastV2(device.address, { port: found.port });
        this.cc = cc;
        cc.onMedia = (m) => this.onCastMedia(m);
        cc.onClose = () => { if (this.cc === cc && this.status.state !== 'idle') void this.stop(); };
        await cc.connect();
        await cc.launch();
        await cc.load(this.url, mime, title, live ? 0 : startSec);
      }
      this.set({ state: 'buffering' });
      this.startPolling();
      log.info(`Casting "${title}" to ${device.name} (${plan.mode}: ${plan.reason})`);
    } catch (err) {
      await this.fail(err);
      throw err;
    }
    return this.status;
  }

  private async doSeek(sec: number): Promise<void> {
    const target = Math.max(0, Math.min(sec, this.status.durationSec || sec));
    if (!this.status.seekRestarts) {
      if (this.dlna) await this.dlna.seek(target);
      if (this.cc) await this.cc.seek(target);
      this.set({ positionSec: target });
      return;
    }
    // Live output can't be range-seeked, so convert again from the new position and re-point the device.
    const row = this.d.getRow(this.status.mediaId!)!;
    const probe = await this.d.playback.probe(this.status.mediaId!);
    const plan = planCast(probe, String(row.ext), this.status.device!.protocol, 0);
    const old = this.sid;
    const src = await this.sourceFor(this.status.mediaId!, target, plan, String(row.ext));
    this.sid = src.sid;
    this.offsetSec = src.offsetSec;
    if (old) this.d.playback.close(old);
    const query = this.server!.setSource(src.source);
    this.url = this.url.replace(/\?.*$/, '') + query;
    this.set({ state: 'buffering', positionSec: src.offsetSec });
    if (this.dlna) {
      await this.dlna.setUri(this.url, this.status.title, src.source.mime);
      await this.dlna.play();
    }
    if (this.cc) await this.cc.load(this.url, src.source.mime, this.status.title, 0);
  }

  private onCastMedia(m: MediaStatus): void {
    if (this.status.state === 'idle') return;
    if (m.playerState === 'IDLE') {
      if (m.idleReason === 'ERROR') void this.fail(new Error('The Chromecast could not play this stream.'));
      else if (this.playedOnce && m.idleReason) void this.stop();
      return;
    }
    if (m.playerState === 'PLAYING') this.playedOnce = true;
    this.set({ state: STATE_FROM_CC[m.playerState], positionSec: this.offsetSec + m.currentTime, durationSec: this.status.durationSec || m.duration });
  }

  private startPolling(): void {
    this.stopPolling();
    this.timer = setInterval(() => void this.poll(), 1000);
    this.timer.unref();
  }
  private stopPolling(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private async poll(): Promise<void> {
    try {
      if (this.cc) { await this.cc.poll(); return; }
      if (!this.dlna || this.status.state === 'idle') return;
      const state = await this.dlna.transportState();
      const pos = await this.dlna.position();
      if (STATE_FROM_DLNA[state] === 'playing') this.playedOnce = true;
      if ((state === 'STOPPED' || state === 'NO_MEDIA_PRESENT') && this.playedOnce && this.status.state !== 'buffering') { void this.stop(); return; }
      const mapped = STATE_FROM_DLNA[state];
      this.set({ state: mapped ?? this.status.state, positionSec: this.offsetSec + pos.positionSec, durationSec: this.status.durationSec || pos.durationSec });
    } catch (err) {
      log.debug(`Poll failed: ${(err as Error).message}`);
    }
  }

  private async fail(err: unknown): Promise<void> {
    const message = (err as Error).message || 'Casting failed';
    log.warn(`Cast failed: ${message}`);
    const { device, mediaId, title } = this.status;
    await this.teardown();
    this.set({ ...IDLE_CAST, state: 'error', device, mediaId, title, error: message });
  }

  private async doStop(): Promise<void> {
    if (this.status.state === 'idle' && !this.server) return;
    await this.teardown();
    this.set({ ...IDLE_CAST });
  }

  private async teardown(): Promise<void> {
    this.stopPolling();
    const { dlna, cc, server, sid } = this;
    this.dlna = null; this.cc = null; this.server = null; this.sid = null;
    if (dlna) await dlna.stop().catch(() => undefined);
    if (cc) await cc.stop().catch(() => undefined);
    if (sid) this.d.playback.close(sid);
    server?.close();
  }

  async closeAll(): Promise<void> { await this.stop(); }
}
