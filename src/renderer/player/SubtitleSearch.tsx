import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { languageName } from '@shared/playback-plan';
import type { SubtitleHit } from '@shared/subtitle-search';
import { invoke } from '../api';
import { Button, Spinner } from '../components/ui';
import { videoEngine, useVideoPlayer } from '../lib/video-engine';
import { useSettings } from '../state/settings';
import { navigate } from '../state/router';
import { toast } from '../state/ui';
import '../styles/subtitle-search.css';

const useSheet = create<{ open: boolean }>(() => ({ open: false }));
export const openSubtitleSearch = () => useSheet.setState({ open: true });

/** Search OpenSubtitles for the playing video and save the pick next to it. Mounted by the player. */
export function SubtitleSearchSheet() {
  const open = useSheet((s) => s.open);
  return open ? <Sheet onClose={() => useSheet.setState({ open: false })} /> : null;
}

function Sheet({ onClose }: { onClose: () => void }) {
  const item = useVideoPlayer((s) => s.item);
  const prefLangs = useSettings((s) => s.settings.playback.preferredSubtitleLangs);
  const [q, setQ] = useState(item ? (item.series && item.episode != null ? item.series : item.title) : '');
  const [langs, setLangs] = useState(prefLangs.length ? prefLangs.join(', ') : 'en');
  const [hits, setHits] = useState<SubtitleHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashed, setHashed] = useState(false);

  const search = async () => {
    if (!item) return;
    setBusy(true); setError(null);
    try {
      const r = await invoke('subtitles:search', { mediaId: item.id, languages: langs.split(/[,\s]+/).filter(Boolean), query: q });
      setHits(r.hits); setHashed(r.hashed);
    } catch (err) { setError((err as Error).message); setHits(null); }
    setBusy(false);
  };
  useEffect(() => { void search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const pick = async (h: SubtitleHit) => {
    if (!item) return;
    setSaving(h.fileId); setError(null);
    try {
      const r = await invoke('subtitles:download', item.id, h.fileId, h.language, h.hearingImpaired);
      await videoEngine.reloadSubtitles(r.trackId);
      toast('success', r.where === 'sidecar' ? 'Subtitles saved next to the video' : 'Subtitles saved (the video’s folder is read-only, so they live in Gravity’s cache)');
      onClose();
    } catch (err) { setError((err as Error).message); setSaving(null); }
  };

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet subsearch" role="dialog" aria-labelledby="ss-title">
        <h2 id="ss-title" className="t-headline">Find Subtitles</h2>
        <form className="subsearch__form" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Title to search for" autoFocus />
          <input className="field subsearch__langs" value={langs} onChange={(e) => setLangs(e.target.value)} aria-label="Languages, comma separated" placeholder="en, de" />
          <Button type="submit" disabled={busy}>Search</Button>
        </form>
        <p className="secondary t-footnote">The file’s fingerprint and title are sent to OpenSubtitles. The video is never uploaded.{hashed ? '' : ' This file is too small to fingerprint, so matches are by title only.'}</p>
        <div className="subsearch__list">
          {busy && <div className="page-loading"><Spinner size={18} /></div>}
          {error && (
            <p className="secondary t-callout">
              {error} <button type="button" className="link" onClick={() => { onClose(); useVideoPlayer.getState().close(); navigate({ name: 'settings', pane: 'metadata' }); }}>Open Metadata settings</button>
            </p>
          )}
          {!busy && !error && hits?.length === 0 && <p className="secondary t-callout">No subtitles found. Try a shorter title or another language.</p>}
          {!busy && hits?.map((h) => (
            <div key={h.fileId} className="subsearch__row">
              <div style={{ minWidth: 0 }}>
                <div className="subsearch__release">{h.release || h.title}</div>
                <div className="subsearch__meta secondary t-footnote">
                  <span>{languageName(h.language) || h.language}</span>
                  <span>{h.downloads.toLocaleString()} downloads</span>
                  {h.fps && <span>{h.fps} fps</span>}
                  {h.hashMatch && <span className="subsearch__tag subsearch__tag--match">Exact match</span>}
                  {h.hearingImpaired && <span className="subsearch__tag">SDH</span>}
                </div>
              </div>
              <Button size="sm" onClick={() => void pick(h)} disabled={saving != null}>{saving === h.fileId ? <Spinner size={13} /> : 'Download'}</Button>
            </div>
          ))}
        </div>
        <div className="sheet__actions"><Button onClick={onClose}>Close</Button></div>
      </div>
    </div>,
    document.body
  );
}
