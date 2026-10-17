import { useEffect, useMemo, useState } from 'react';
import { invoke } from '../../api';
import { Button, Spinner, Switch } from '../../components/ui';
import { DEFAULT_ORGANISE, type BinItem, type OrganiseJournalInfo, type OrganiseOptions, type OrganisePlan } from '@shared/organise';
import { useLibrary } from '../../state/library';
import { toast, useUi } from '../../state/ui';
import { Group, Row, Select } from './parts';

type Busy = 'plan' | 'apply' | 'bin' | null;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const bytes = (n: number) => {
  if (n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i < 2 ? 0 : 1)} ${u[i]}`;
};

export function TidyPane() {
  const roots = useLibrary((s) => s.roots).filter((r) => r.enabled && r.online);
  const [rootId, setRootId] = useState<number | null>(null);
  const [opts, setOpts] = useState(DEFAULT_ORGANISE);
  const [plan, setPlan] = useState<OrganisePlan | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [history, setHistory] = useState<OrganiseJournalInfo[]>([]);
  const [bin, setBin] = useState<BinItem[]>([]);
  const [summary, setSummary] = useState<{ journalId: string | null; moved: number; binned: number; failed: number; error?: string } | null>(null);
  const id = rootId ?? roots[0]?.id ?? null;
  const full = useMemo<OrganiseOptions | null>(() => (id == null ? null : { rootId: id, ...opts }), [id, opts]);

  const loadHistory = () => void invoke('organise:history').then(setHistory).catch(() => undefined);
  const loadBin = () => {
    if (id == null) { setBin([]); return; }
    void invoke('organise:bin', id).then(setBin).catch(() => setBin([]));
  };
  useEffect(loadHistory, []);
  useEffect(loadBin, [id]);
  useEffect(() => { setPlan(null); setSummary(null); }, [id, opts]);

  const refreshLibrary = () => useLibrary.setState((x) => ({ revision: x.revision + 1 }));
  const confirm = (title: string, message: string, confirmLabel: string, destructive = false) => useUi.getState().confirm({ title, message, confirmLabel, destructive });

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } catch (err) { toast('error', (err as Error).message); }
    setBusy(null);
  };

  const applyEntries = async (ids: number[]) => {
    if (!full) return;
    const r = await invoke('organise:apply', full, ids);
    refreshLibrary();
    setPlan(null);
    setSummary({ journalId: r.journalId, moved: r.moved, binned: r.binned, failed: r.failed, error: r.errors[0] });
    loadHistory();
    loadBin();
  };

  /** The one-button path: plan, tell the user exactly what will happen, then do all of it. */
  const cleanUp = () => run('plan', async () => {
    if (!full) return;
    const p = await invoke('organise:plan', full);
    const todo = p.entries.filter((e) => e.status === 'move' || e.status === 'bin');
    if (todo.length === 0) { toast('success', 'Already tidy — nothing to clean up.'); return; }
    const lines = [
      p.counts.move > 0 ? `${plural(p.counts.move, 'file')} will be renamed or moved into a clean layout.` : '',
      p.counts.bin > 0 ? `${plural(p.counts.bin, 'duplicate or leftover file')} will go to the Gravity Bin. Nothing is deleted — you can restore or delete them from there.` : '',
      p.counts.conflict > 0 ? `${plural(p.counts.conflict, 'file')} will be left alone because they clash with another file.` : ''
    ].filter(Boolean);
    const ok = await confirm('Clean up this library?', `${lines.join(' ')} You can undo it afterwards.`, 'Clean Up');
    if (!ok) return;
    setBusy('apply');
    await applyEntries(todo.map((e) => e.id));
  });

  const preview = () => run('plan', async () => {
    if (!full) return;
    const p = await invoke('organise:plan', full);
    setPlan(p);
    setSummary(null);
    setPicked(new Set(p.entries.filter((e) => e.status === 'move' || e.status === 'bin').map((e) => e.id)));
  });

  const applyPicked = async () => {
    if (!plan || picked.size === 0) return;
    const ok = await confirm(`Tidy ${plural(picked.size, 'file')}?`, 'Files are renamed and moved inside this folder only. Duplicates go to the Gravity Bin instead of being deleted, and you can undo this afterwards.', 'Tidy Up');
    if (!ok) return;
    await run('apply', () => applyEntries([...picked]));
  };

  const undo = (journalId: string) => run('apply', async () => {
    const r = await invoke('organise:undo', journalId);
    refreshLibrary();
    setSummary(null);
    loadHistory();
    loadBin();
    toast(r.failed ? 'error' : 'success', `Restored ${r.moved}${r.failed ? ` · ${r.failed} could not be restored` : ''}`);
  });

  const restore = (ids: string[]) => run('bin', async () => {
    if (id == null) return;
    const r = await invoke('organise:binRestore', id, ids);
    refreshLibrary();
    loadBin();
    toast(r.failed ? 'error' : 'success', r.failed ? `Restored ${r.moved} · ${r.failed} failed: ${r.errors[0]}` : `Restored ${plural(r.moved, 'file')} to the library`);
  });

  const destroy = async (ids: string[], label: string) => {
    const ok = await confirm(`Delete ${label} forever?`, 'This permanently deletes the files from your disk. This cannot be undone.', 'Delete Forever', true);
    if (!ok || id == null) return;
    await run('bin', async () => {
      const r = await invoke('organise:binDelete', id, ids);
      loadBin();
      loadHistory();
      toast(r.failed ? 'error' : 'success', r.failed ? `Deleted ${r.moved} · ${r.failed} failed: ${r.errors[0]}` : `Deleted ${plural(r.moved, 'item')} from the Gravity Bin`);
    });
  };

  const toggle = (eid: number) => setPicked((p) => { const n = new Set(p); if (n.has(eid)) n.delete(eid); else n.add(eid); return n; });
  const actionable = plan?.entries.filter((e) => e.status === 'move' || e.status === 'bin') ?? [];
  const shown = plan?.entries.filter((e) => e.status !== 'ok').slice(0, 500) ?? [];
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));
  const binBytes = bin.reduce((a, b) => a + b.size, 0);

  return (
    <>
      <Group
        title="Clean Up Library"
        footer="One click renames and sorts everything: movies as “Title (Year)/Title (Year).ext”, shows as “Show/Season 01/Show - S01E02 - Title.ext”, music as “Artist/Album/01 - Title.ext”. Release tags, site watermarks and numbering junk are removed, messy or duplicate folders are merged into one clean folder (empty ones are removed), and subtitles, thumbnails and artwork travel with their video. Duplicates and leftovers are never deleted — they go to the Gravity Bin."
      >
        <Row label="Folder">
          {roots.length === 0 ? <span className="secondary">No folders online</span> : (
            <Select label="Folder" value={id ?? 0} options={roots.map((r) => ({ value: r.id, label: r.name }))} onChange={setRootId} />
          )}
        </Row>
        <Row label="Movies & clips"><Switch label="Tidy movies and clips" checked={opts.movies} onChange={(movies) => set({ movies })} /></Row>
        <Row label="TV episodes"><Switch label="Tidy episodes" checked={opts.episodes} onChange={(episodes) => set({ episodes })} /></Row>
        <Row label="Episode titles in file names" hint="“Show - S01E02 - Pilot” instead of “Show - S01E02”."><Switch label="Episode titles" checked={opts.episodeTitles} onChange={(episodeTitles) => set({ episodeTitles })} /></Row>
        <Row label="Music"><Switch label="Tidy music" checked={opts.music} onChange={(music) => set({ music })} /></Row>
        <Row label="Move duplicates to the Gravity Bin" hint="Identical copies, unfinished downloads and orphaned artwork. The best copy stays; nothing is deleted."><Switch label="Move duplicates to the Gravity Bin" checked={opts.duplicates} onChange={(duplicates) => set({ duplicates })} /></Row>
        <Row label="Use online titles" hint="Use matched show and movie names from Settings → Metadata where available."><Switch label="Use online titles" checked={opts.useOnlineTitles} onChange={(useOnlineTitles) => set({ useOnlineTitles })} /></Row>
        <Row label="Tidy">
          <Button variant="primary" onClick={() => void cleanUp()} disabled={!full || busy !== null}>
            {busy === 'plan' || busy === 'apply' ? <><Spinner size={13} /> Working…</> : 'Clean Up Library'}
          </Button>
          <Button onClick={() => void preview()} disabled={!full || busy !== null}>Review First</Button>
        </Row>
      </Group>

      {summary && (
        <Group title="Done">
          <Row
            label={summary.moved + summary.binned === 0 ? 'Nothing was changed.' : `${plural(summary.moved, 'file')} tidied`}
            hint={summary.failed ? `${summary.failed} could not be moved: ${summary.error ?? ''}` : undefined}
          >
            {summary.journalId && <Button size="sm" onClick={() => void undo(summary.journalId!)} disabled={busy !== null}>Undo</Button>}
          </Row>
          {summary.binned > 0 && (
            <Row label={`${plural(summary.binned, 'duplicate or leftover file')} moved to the Gravity Bin`} hint="Nothing was deleted. Review them below to restore or delete them.">
              <a className="link" href="#gravity-bin" onClick={(e) => { e.preventDefault(); document.getElementById('gravity-bin')?.scrollIntoView({ behavior: 'smooth' }); }}>View Bin</a>
            </Row>
          )}
        </Group>
      )}

      {plan && (
        <Group
          title={`${plan.counts.move} to move · ${plan.counts.bin} to the bin · ${plan.counts.ok} already tidy${plan.counts.conflict ? ` · ${plan.counts.conflict} conflicts` : ''}${plan.counts.skip ? ` · ${plan.counts.skip} skipped` : ''}`}
          action={<Button variant="primary" onClick={() => void applyPicked()} disabled={busy !== null || picked.size === 0}>{busy === 'apply' ? <Spinner size={13} /> : `Tidy ${plural(picked.size, 'File')}`}</Button>}
        >
          {actionable.length > 0 && (
            <Row label="Select">
              <Button size="sm" variant="plain" onClick={() => setPicked(new Set(actionable.map((e) => e.id)))}>All</Button>
              <Button size="sm" variant="plain" onClick={() => setPicked(new Set())}>None</Button>
            </Row>
          )}
          {shown.length === 0 && <Row label="Everything is already tidy." />}
          {shown.map((e) => {
            const act = e.status === 'move' || e.status === 'bin';
            return (
              <Row
                key={e.id} stack
                label={act ? (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`${e.status === 'bin' ? 'Bin' : 'Move'} ${e.from}`} />
                    <span className="truncate">{e.from}</span>
                  </label>
                ) : <span className="truncate">{e.from}</span>}
                hint={act ? <>{e.status === 'bin' ? 'Gravity Bin: ' : '→ '}{e.status === 'bin' ? e.reason : e.to}{e.sidecars.length > 0 ? ` (+${e.sidecars.length} extra)` : ''}</> : <>{e.status === 'conflict' ? 'Conflict: ' : 'Skipped: '}{e.reason}</>}
              />
            );
          })}
        </Group>
      )}

      <div id="gravity-bin">
        {bin.length > 0 && (
          <Group
            title={`Gravity Bin · ${plural(bin.length, 'item')}${binBytes ? ` · ${bytes(binBytes)}` : ''}`}
            action={(
              <span style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" onClick={() => void restore(bin.map((b) => b.id))} disabled={busy !== null}>Restore All</Button>
                <Button size="sm" variant="danger" onClick={() => void destroy(bin.map((b) => b.id), 'everything in the Gravity Bin')} disabled={busy !== null}>Empty Bin</Button>
              </span>
            )}
            footer="Duplicates and leftovers from Clean Up wait here, in the “Gravity Bin” folder inside your library folder. Nothing is deleted until you choose Delete Forever. Restore puts a file back exactly where it was."
          >
            {bin.slice(0, 200).map((b) => (
              <Row
                key={b.id} stack
                label={<span className="truncate">{b.name}</span>}
                hint={<>{b.reason}{b.extras > 0 ? ` · +${b.extras} extra` : ''}{b.size ? ` · ${bytes(b.size)}` : ''}</>}
              >
                <Button size="sm" onClick={() => void restore([b.id])} disabled={busy !== null}>Restore</Button>
                <Button size="sm" variant="danger" onClick={() => void destroy([b.id], `“${b.name}”`)} disabled={busy !== null}>Delete</Button>
              </Row>
            ))}
            {bin.length > 200 && <Row label={`…and ${bin.length - 200} more`} />}
          </Group>
        )}
      </div>

      {history.length > 0 && (
        <Group title="Recent tidy-ups" footer="Undo puts files back where they were, including anything that went to the Gravity Bin, as long as they haven’t been changed since.">
          {history.slice(0, 5).map((j) => (
            <Row
              key={j.id} label={`${j.rootName} · ${plural(j.moved, 'file')}`}
              hint={<>{new Date(j.at).toLocaleString()}{j.binned > 0 ? ` · ${plural(j.binned, 'item')} to the Gravity Bin` : ''}</>}
            >
              {j.undone ? <span className="secondary">Undone</span> : <Button size="sm" onClick={() => void undo(j.id)} disabled={busy !== null}>Undo</Button>}
            </Row>
          ))}
        </Group>
      )}
    </>
  );
}
