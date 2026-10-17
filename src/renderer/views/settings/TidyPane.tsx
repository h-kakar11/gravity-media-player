import { useEffect, useMemo, useState } from 'react';
import { invoke } from '../../api';
import { Button, Spinner, Switch } from '../../components/ui';
import { DEFAULT_ORGANISE, type OrganiseJournalInfo, type OrganiseOptions, type OrganisePlan } from '@shared/organise';
import { useLibrary } from '../../state/library';
import { toast, useUi } from '../../state/ui';
import { Group, Row, Select } from './parts';

export function TidyPane() {
  const roots = useLibrary((s) => s.roots).filter((r) => r.enabled && r.online);
  const [rootId, setRootId] = useState<number | null>(null);
  const [opts, setOpts] = useState(DEFAULT_ORGANISE);
  const [plan, setPlan] = useState<OrganisePlan | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null);
  const [history, setHistory] = useState<OrganiseJournalInfo[]>([]);
  const id = rootId ?? roots[0]?.id ?? null;
  const full = useMemo<OrganiseOptions | null>(() => (id == null ? null : { rootId: id, ...opts }), [id, opts]);

  const loadHistory = () => void invoke('organise:history').then(setHistory).catch(() => undefined);
  useEffect(loadHistory, []);
  useEffect(() => { setPlan(null); }, [id, opts]);

  const refreshLibrary = () => useLibrary.setState((x) => ({ revision: x.revision + 1 }));

  const preview = async () => {
    if (!full) return;
    setBusy('plan');
    try {
      const p = await invoke('organise:plan', full);
      setPlan(p);
      setPicked(new Set(p.entries.filter((e) => e.status === 'move').map((e) => e.id)));
    } catch (err) { toast('error', (err as Error).message); }
    setBusy(null);
  };

  const apply = async () => {
    if (!full || !plan || picked.size === 0) return;
    const ok = await useUi.getState().confirm({
      title: `Move ${picked.size} file${picked.size === 1 ? '' : 's'}?`,
      message: 'Files are renamed and moved inside this folder only. Nothing is deleted or overwritten, and you can undo this afterwards.',
      confirmLabel: 'Tidy Up'
    });
    if (!ok) return;
    setBusy('apply');
    try {
      const r = await invoke('organise:apply', full, [...picked]);
      refreshLibrary();
      toast(r.failed ? 'error' : 'success', `Moved ${r.moved}${r.failed ? ` · ${r.failed} failed: ${r.errors[0]}` : ''}`);
      setPlan(null);
      loadHistory();
    } catch (err) { toast('error', (err as Error).message); }
    setBusy(null);
  };

  const undo = async (j: OrganiseJournalInfo) => {
    setBusy('apply');
    try {
      const r = await invoke('organise:undo', j.id);
      refreshLibrary();
      toast(r.failed ? 'error' : 'success', `Restored ${r.moved}${r.failed ? ` · ${r.failed} could not be restored` : ''}`);
      loadHistory();
    } catch (err) { toast('error', (err as Error).message); }
    setBusy(null);
  };

  const toggle = (eid: number) => setPicked((p) => { const n = new Set(p); if (n.has(eid)) n.delete(eid); else n.add(eid); return n; });
  const movable = plan?.entries.filter((e) => e.status === 'move') ?? [];
  const shown = plan?.entries.filter((e) => e.status !== 'ok').slice(0, 500) ?? [];
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));

  return (
    <>
      <Group title="Tidy Library" footer="Renames and moves files into a clean layout: Movies as “Title (Year)/Title (Year).ext”, shows as “Show/Season 01/Show - S01E02 - Title.ext”, music as “Artist/Album/01 - Title.ext”. Subtitles and .nfo files with the same name travel along. Always preview first; nothing is deleted or overwritten.">
        <Row label="Folder">
          {roots.length === 0 ? <span className="secondary">No folders online</span> : (
            <Select label="Folder" value={id ?? 0} options={roots.map((r) => ({ value: r.id, label: r.name }))} onChange={setRootId} />
          )}
        </Row>
        <Row label="Movies"><Switch label="Tidy movies" checked={opts.movies} onChange={(movies) => set({ movies })} /></Row>
        <Row label="TV episodes"><Switch label="Tidy episodes" checked={opts.episodes} onChange={(episodes) => set({ episodes })} /></Row>
        <Row label="Episode titles in file names" hint="“Show - S01E02 - Pilot” instead of “Show - S01E02”."><Switch label="Episode titles" checked={opts.episodeTitles} onChange={(episodeTitles) => set({ episodeTitles })} /></Row>
        <Row label="Music"><Switch label="Tidy music" checked={opts.music} onChange={(music) => set({ music })} /></Row>
        <Row label="Use online titles" hint="Use matched show and movie names from Settings → Metadata where available."><Switch label="Use online titles" checked={opts.useOnlineTitles} onChange={(useOnlineTitles) => set({ useOnlineTitles })} /></Row>
        <Row label="Preview">
          <Button onClick={() => void preview()} disabled={!full || busy !== null}>{busy === 'plan' ? <><Spinner size={13} /> Planning…</> : 'Preview Changes'}</Button>
        </Row>
      </Group>

      {plan && (
        <Group
          title={`${plan.counts.move} to move · ${plan.counts.ok} already tidy${plan.counts.conflict ? ` · ${plan.counts.conflict} conflicts` : ''}${plan.counts.skip ? ` · ${plan.counts.skip} skipped` : ''}`}
          action={<Button variant="primary" onClick={() => void apply()} disabled={busy !== null || picked.size === 0}>{busy === 'apply' ? <Spinner size={13} /> : `Tidy ${picked.size} File${picked.size === 1 ? '' : 's'}`}</Button>}
        >
          {movable.length > 0 && (
            <Row label="Select">
              <Button size="sm" variant="plain" onClick={() => setPicked(new Set(movable.map((e) => e.id)))}>All</Button>
              <Button size="sm" variant="plain" onClick={() => setPicked(new Set())}>None</Button>
            </Row>
          )}
          {shown.length === 0 && <Row label="Everything is already tidy." />}
          {shown.map((e) => (
            <Row
              key={e.id} stack
              label={e.status === 'move' ? (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Move ${e.from}`} />
                  <span className="truncate">{e.from}</span>
                </label>
              ) : <span className="truncate">{e.from}</span>}
              hint={e.status === 'move' ? <>→ {e.to}{e.sidecars.length > 0 ? ` (+${e.sidecars.length} extra)` : ''}</> : <>{e.status === 'conflict' ? 'Conflict: ' : 'Skipped: '}{e.reason}</>}
            />
          ))}
        </Group>
      )}

      {history.length > 0 && (
        <Group title="Recent tidy-ups" footer="Undo puts files back where they were, as long as they haven’t been changed since.">
          {history.slice(0, 5).map((j) => (
            <Row key={j.id} label={`${j.rootName} · ${j.moved} files`} hint={new Date(j.at).toLocaleString()}>
              {j.undone ? <span className="secondary">Undone</span> : <Button size="sm" onClick={() => void undo(j)} disabled={busy !== null}>Undo</Button>}
            </Row>
          ))}
        </Group>
      )}
    </>
  );
}
