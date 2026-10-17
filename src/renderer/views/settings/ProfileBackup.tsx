import { FileDown, FileUp } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConflictPolicy, ImportReport } from '@shared/backup';
import { invoke } from '../../api';
import { Button } from '../../components/ui';
import { toast } from '../../state/ui';
import { Row } from './parts';

interface Pending { token: string; report: ImportReport }

function Summary({ r }: { r: ImportReport }) {
  const lines: [string, string][] = [
    ['Matched to your library', `${r.media.matched} of ${r.media.total}${r.media.relocated ? ` (${r.media.relocated} found at a different location)` : ''}`],
    ['Ratings, progress & favourites', `${r.state.added} new, ${r.state.updated} updated, ${r.state.unchanged} unchanged`],
    ['History', `${r.history.added} new, ${r.history.duplicate} already present`],
    ['Playlists', `${r.playlists.created} new, ${r.playlists.merged} merged, ${r.playlists.itemsAdded} items added`],
    ['Favourite albums & shows', `${r.favorites.added} new`],
    ['Metadata matches', `${r.matches.added} new${r.matches.replaced ? `, ${r.matches.replaced} replaced` : ''}`]
  ];
  return (
    <div className="stack" style={{ gap: 6 }}>
      {lines.map(([k, v]) => <div key={k} className="row-between"><span className="secondary">{k}</span><span>{v}</span></div>)}
      {r.media.unmatched + r.media.ambiguous > 0 && (
        <div className="secondary">
          {r.media.unmatched} not in your library, {r.media.ambiguous} ambiguous — skipped.
          {[...r.unmatchedSamples, ...r.ambiguousSamples].length > 0 && <> e.g. {[...r.unmatchedSamples, ...r.ambiguousSamples].slice(0, 3).join(', ')}</>}
        </div>
      )}
    </div>
  );
}

export function ProfileBackupRows() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [policy, setPolicy] = useState<ConflictPolicy>('keep');
  const [busy, setBusy] = useState(false);

  const exportIt = async () => {
    try {
      const o = await invoke('backup:export');
      if (o) toast('success', `Exported ${o.media} items, ${o.playlists} playlists and ${o.matches} matches`);
    } catch (e) { toast('error', (e as Error).message); }
  };
  const openIt = async () => {
    try {
      const p = await invoke('backup:open');
      if (p) { setPolicy('keep'); setPending(p); }
    } catch (e) { toast('error', (e as Error).message); }
  };
  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await invoke('backup:apply', pending.token, { conflicts: policy });
      toast('success', `Profile imported: ${r.state.added + r.state.updated} items updated, ${r.history.added} history entries added`);
      setPending(null);
    } catch (e) { toast('error', (e as Error).message); }
    finally { setBusy(false); }
  };

  const r = pending?.report;
  return (
    <>
      <Row label="Export profile" hint="Saves ratings, favourites, playlists, watch progress, history and metadata matches to one portable file. No settings, keys or folder locations are included."><Button size="sm" icon={FileDown} onClick={() => void exportIt()}>Export…</Button></Row>
      <Row label="Import profile" hint="Merges a profile into this library after showing a preview. Nothing is deleted."><Button size="sm" icon={FileUp} onClick={() => void openIt()}>Import…</Button></Row>
      {pending && r && createPortal(
        <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setPending(null); }}>
          <div className="sheet" role="dialog" aria-label="Import profile" style={{ width: 460 }}>
            <div className="t-title-3">Import profile</div>
            <div className="secondary" style={{ margin: '4px 0 12px' }}>Backup from {new Date(r.exportedAt).toLocaleDateString()} · Gravity {r.appVersion || 'unknown'} · format {r.version}</div>
            <Summary r={r} />
            {r.conflictCount > 0 && (
              <div style={{ marginTop: 14 }}>
                <div>{r.conflictCount} difference{r.conflictCount === 1 ? '' : 's'} between the backup and this library:</div>
                <ul className="secondary" style={{ margin: '6px 0', paddingLeft: 18, maxHeight: 110, overflow: 'auto' }}>
                  {r.conflicts.slice(0, 20).map((c, i) => <li key={i}>{c.what} · {c.title}: yours “{c.mine}”, backup “{c.backup}”</li>)}
                </ul>
                <label style={{ display: 'block' }}><input type="radio" checked={policy === 'keep'} onChange={() => setPolicy('keep')} /> Keep what I have</label>
                <label style={{ display: 'block' }}><input type="radio" checked={policy === 'backup'} onChange={() => setPolicy('backup')} /> Use the backup’s values</label>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button size="sm" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={() => void apply()} disabled={busy}>Import</Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
