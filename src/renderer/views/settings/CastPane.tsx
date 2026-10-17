import { Switch } from '../../components/ui';
import { Group, Row, useS } from './parts';

export function CastPane() {
  const { s, update } = useS();
  const enabled = s.cast.enabled;
  const toggle = (on: boolean) => {
    // The cast button is a player control, so turning casting on also puts it on the control bar.
    const video = on && !s.controls.video.includes('cast') ? [...s.controls.video, 'cast'] : s.controls.video;
    update({ cast: { enabled: on }, controls: { video } });
  };
  return (
    <>
      <Group
        title="Casting"
        footer="Off by default. While off, Gravity sends nothing on your network and opens no ports. When on, scanning sends discovery packets to your local network only (SSDP for DLNA, mDNS for Chromecast)."
      >
        <Row label="Enable casting" hint="Adds a Cast button to the video player."><Switch label="Enable casting" checked={enabled} onChange={toggle} /></Row>
      </Group>
      <Group title="How it works" footer="Experimental: tested against simulated devices only, not yet verified on real TVs or Chromecasts.">
        <Row label="Only while casting" hint="When you start a cast Gravity opens a small web server on your local network address, and closes it when the cast ends. It hands one video to the device you chose, over a secret link, and refuses every other computer." stack />
        <Row label="Conversion" hint="Files the device cannot play (HEVC, 10-bit, HDR, 4K, surround audio, MKV) are converted on this computer with ffmpeg first, so they need ffmpeg installed. Seeking in a converted stream restarts it." stack />
        <Row label="Not included" hint="Subtitles are not sent to the device, and only videos can be cast." stack />
      </Group>
    </>
  );
}
