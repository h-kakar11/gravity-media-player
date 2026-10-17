import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MetaApplyTarget, MetaCandidate, MetaKind, MetaMatch } from '@shared/metadata';
import { invoke } from '../api';
import { useLibrary } from '../state/library';
import { navigate } from '../state/router';
import { toast } from '../state/ui';
import { Button, Spinner } from './ui';

const PROVIDER_NAMES = { anilist: 'AniList', tmdb: 'TMDB', musicbrainz: 'MusicBrainz' } as const;

/**
 * Search the enabled providers by hand and pick the right entry. Manual picks are locked against auto-match.
 * `artist` narrows an album search (the title field then holds only the album name).
 */
export function FixMatchSheet({ kind, target, initial, year, artist, onClose }: { kind: MetaKind; target: MetaApplyTarget; initial: string; year?: number; artist?: string; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<MetaCandidate[] | null>(null);
  const [current, setCurrent] = useState<MetaMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true); setError(null);
    try { setResults(await invoke('meta:search', kind, kind === 'album' && artist ? `${q}\u0001${artist}` : q, year)); } catch (err) { setError((err as Error).message); setResults(null); }
    setBusy(false);
  };
  useEffect(() => { void search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { invoke('meta:match', target).then(setCurrent, () => setCurrent(null)); }, [target.kind, target.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const pick = async (c: MetaCandidate) => {
    setBusy(true);
    try {
      const res = await invoke('meta:apply', target, c);
      useLibrary.setState((s) => ({ revision: s.revision + 1 }));
      // The match is saved either way; episode info is a bonus that can fail on its own (offline, no key).
      if (res.episodeError) toast('info', `Matched to “${c.title}”. Episode info unavailable: ${res.episodeError}`);
      else if (res.episodes) toast('success', `Matched to “${c.title}” · ${res.episodes.episodes} episode${res.episodes.episodes === 1 ? '' : 's'} updated`);
      else toast('success', `Matched to “${c.title}”`);
      onClose();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-labelledby="fm-title" style={{ width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <h2 id="fm-title" className="t-headline">Fix Match</h2>
        {current && (
          <p className="secondary t-footnote" style={{ margin: '4px 0 0' }}>
            Currently matched to “{current.title}” on {PROVIDER_NAMES[current.provider]}{current.locked ? ' (chosen by you)' : ''}.
          </p>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void search(); }} style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          <input className="field" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Title to search for" autoFocus />
          <Button type="submit" disabled={busy}>Search</Button>
        </form>
        <div style={{ overflow: 'auto', flex: 1, minHeight: 120 }}>
          {busy && <div className="page-loading"><Spinner size={18} /></div>}
          {error && (
            <p className="secondary t-callout">
              {error} <button type="button" className="link" onClick={() => { onClose(); navigate({ name: 'settings', pane: 'metadata' }); }}>Open Metadata settings</button>
            </p>
          )}
          {!busy && !error && results?.length === 0 && <p className="secondary t-callout">No matches. Try a shorter title.</p>}
          {!busy && results?.map((c) => (
            <button key={`${c.provider}:${c.id}`} type="button" className="side-item" style={{ height: 'auto', padding: '8px 10px', gap: 10, alignItems: 'flex-start', textAlign: 'left' }} onClick={() => void pick(c)}>
              {c.poster ? <img src={c.poster} alt="" width={44} height={64} style={{ objectFit: 'cover', borderRadius: 4, flex: 'none' }} referrerPolicy="no-referrer" /> : <span style={{ width: 44, height: 64, flex: 'none' }} />}
              <span style={{ minWidth: 0 }}>
                <strong>{c.title}</strong> <span className="secondary">{c.year ?? ''}</span>
                <span className="secondary t-footnote" style={{ display: 'block' }}>{PROVIDER_NAMES[c.provider]}{c.genres.length ? ` · ${c.genres.slice(0, 3).join(', ')}` : ''}</span>
                {c.plot && <span className="secondary t-footnote" style={{ display: 'block', overflow: 'hidden', maxHeight: '3.6em' }}>{c.plot}</span>}
              </span>
            </button>
          ))}
        </div>
        <div className="sheet__actions"><Button onClick={onClose}>Cancel</Button></div>
      </div>
    </div>,
    document.body
  );
}
