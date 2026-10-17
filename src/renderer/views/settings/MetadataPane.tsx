import { useState } from 'react';
import { invoke } from '../../api';
import { Button, Spinner, Switch } from '../../components/ui';
import { useLibrary } from '../../state/library';
import { toast } from '../../state/ui';
import { CommitText, Group, Row, useS } from './parts';

export function MetadataPane() {
  const { s, update } = useS();
  const m = s.metadata;
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await invoke('meta:run');
      useLibrary.setState((x) => ({ revision: x.revision + 1 }));
      toast('success', `Matched ${r.matched}${r.episodes ? ` · episode info for ${r.episodes} show${r.episodes === 1 ? '' : 's'}` : ''}${r.skipped ? ` · ${r.skipped} need a manual match` : ''}${r.failed ? ` · ${r.failed} failed` : ''}`);
    } catch (err) { toast('error', (err as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <Group title="Online lookups" footer="Gravity works fully offline. When this is on, show, movie and album titles are sent to the providers below to fetch posters, summaries and genres. Your files are never uploaded or renamed.">
        <Row label="Fetch metadata online" hint="Off by default.">
          <Switch label="Fetch metadata online" checked={m.enabled} onChange={(enabled) => update({ metadata: { enabled } })} />
        </Row>
      </Group>
      <Group title="Providers" footer="Local artwork (folder.jpg, embedded covers) is always kept; online posters only fill gaps. Manual matches made with Fix Match are never replaced by automatic ones.">
        <Row label="AniList" hint="Anime. No account or key needed."><Switch label="AniList" checked={m.anilist} onChange={(anilist) => update({ metadata: { anilist } })} /></Row>
        <Row label="TMDB" hint="Movies and TV. Needs your own free API key.">
          <Switch label="TMDB" checked={m.tmdb} onChange={(tmdb) => update({ metadata: { tmdb } })} />
        </Row>
        <Row label="TMDB API key" hint="Stored only on this computer. Never included in settings exports." stack>
          <CommitText label="TMDB API key" value={m.tmdbKey} placeholder="API key or read access token" mono width={360} onCommit={(tmdbKey) => update({ metadata: { tmdbKey: tmdbKey.trim() } })} />
        </Row>
        <Row label="MusicBrainz" hint="Album lookups and cover art. No key needed."><Switch label="MusicBrainz" checked={m.musicbrainz} onChange={(musicbrainz) => update({ metadata: { musicbrainz } })} /></Row>
        <Row label="Language" hint="Language code for TMDB text, e.g. en, de, ja.">
          <CommitText label="Metadata language" value={m.language} width={80} onCommit={(language) => update({ metadata: { language } })} />
        </Row>
      </Group>
      <Group title="Library" footer="Matches every show and movie that has no match yet, keeping only close title matches. Anything uncertain is left alone — open the show and choose Fix Match.">
        <Row label="Match my library" hint={m.enabled ? undefined : 'Turn on online lookups first.'}>
          <Button onClick={() => void run()} disabled={!m.enabled || busy}>{busy ? <><Spinner size={13} /> Matching…</> : 'Match Now'}</Button>
        </Row>
      </Group>
    </>
  );
}
