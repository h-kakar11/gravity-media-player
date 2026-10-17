import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SMART_LIMITS, emptyDefinition, isGroup, type NumberOp, type SmartDefinition, type SmartField, type SmartGroup, type SmartNode, type SmartPreview, type SmartRule, type SmartSort, type TextOp } from '@shared/smart';
import { formatDuration } from '@shared/format';
import { invoke } from '../api';
import { navigate } from '../state/router';
import { closeSmartEditor, useSmartEditor } from '../state/smart';
import { toast } from '../state/ui';
import { Button, IconButton } from './ui';
import '../styles/smart.css';

const FIELDS: { id: SmartField; label: string }[] = [
  { id: 'genre', label: 'Genre' }, { id: 'artist', label: 'Artist' }, { id: 'year', label: 'Year' }, { id: 'rating', label: 'Rating' },
  { id: 'unplayed', label: 'Play status' }, { id: 'addedWithin', label: 'Recently added' }, { id: 'favorite', label: 'Favourite' }
];
const TEXT_OPS: [TextOp, string][] = [['is', 'is'], ['isNot', 'is not'], ['contains', 'contains']];
const NUMBER_OPS: [NumberOp, string][] = [['eq', 'is'], ['gte', 'at least'], ['lte', 'at most'], ['gt', 'more than'], ['lt', 'less than'], ['between', 'between']];
const SORTS: [SmartSort, string][] = [['title', 'Title'], ['added', 'Date added'], ['played', 'Last played'], ['year', 'Year'], ['rating', 'Rating'], ['random', 'Shuffled']];

export function newRule(field: SmartField): SmartRule {
  switch (field) {
    case 'genre': case 'artist': return { field, op: 'is', value: '' };
    case 'year': return { field, op: 'between', value: 1990, value2: 1999 };
    case 'rating': return { field, op: 'gte', value: 4 };
    case 'unplayed': return { field, value: true };
    case 'addedWithin': return { field, days: 30 };
    case 'favorite': return { field, value: true };
  }
}

/** Quick text check so the editor can say what is missing before it asks the main process. */
function problem(n: SmartNode): string | null {
  if (isGroup(n)) { for (const c of n.items) { const p = problem(c); if (p) return p; } return null; }
  if ((n.field === 'genre' || n.field === 'artist') && !n.value.trim()) return `Enter a ${n.field}`;
  if ((n.field === 'year' || n.field === 'rating') && n.op === 'between' && (n.value2 ?? n.value) < n.value) return `The ${n.field} range ends before it starts`;
  return null;
}

const count = (g: SmartGroup): number => g.items.reduce((n, i) => n + (isGroup(i) ? count(i) : 1), 0);

function NumberInput({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (n: number) => void }) {
  return (
    <input
      className="field smart-num" type="number" min={min} max={max} step={1} value={Number.isFinite(value) ? value : ''} aria-label={label}
      onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Math.trunc(Number(e.target.value)))}
    />
  );
}

function RuleRow({ rule, onChange, onRemove }: { rule: SmartRule; onChange: (r: SmartRule) => void; onRemove: () => void }) {
  return (
    <div className="smart-row">
      <select className="field" aria-label="Field" value={rule.field} onChange={(e) => onChange(newRule(e.target.value as SmartField))}>
        {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      {(rule.field === 'genre' || rule.field === 'artist') && (
        <>
          <select className="field" aria-label="Condition" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as TextOp })}>
            {TEXT_OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="field smart-grow" aria-label={`${rule.field} value`} placeholder={rule.field === 'genre' ? 'Rock' : 'Artist name'} maxLength={SMART_LIMITS.text} value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })} />
        </>
      )}
      {(rule.field === 'year' || rule.field === 'rating') && (
        <>
          <select className="field" aria-label="Condition" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as NumberOp, value2: e.target.value === 'between' ? rule.value2 ?? rule.value : undefined })}>
            {NUMBER_OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <NumberInput value={rule.value} min={0} max={rule.field === 'year' ? 9999 : 5} label={rule.op === 'between' ? `${rule.field} from` : rule.field} onChange={(value) => onChange({ ...rule, value })} />
          {rule.op === 'between' && (<><span className="secondary">and</span><NumberInput value={rule.value2 ?? rule.value} min={0} max={rule.field === 'year' ? 9999 : 5} label={`${rule.field} to`} onChange={(value2) => onChange({ ...rule, value2 })} /></>)}
          {rule.field === 'rating' && <span className="secondary t-footnote">stars (0 = unrated)</span>}
        </>
      )}
      {rule.field === 'unplayed' && (
        <select className="field" aria-label="Play status" value={rule.value ? 'unplayed' : 'played'} onChange={(e) => onChange({ ...rule, value: e.target.value === 'unplayed' })}>
          <option value="unplayed">Unplayed</option><option value="played">Played</option>
        </select>
      )}
      {rule.field === 'favorite' && (
        <select className="field" aria-label="Favourite" value={rule.value ? 'yes' : 'no'} onChange={(e) => onChange({ ...rule, value: e.target.value === 'yes' })}>
          <option value="yes">Is a favourite</option><option value="no">Is not a favourite</option>
        </select>
      )}
      {rule.field === 'addedWithin' && (
        <>
          <span className="secondary">in the last</span>
          <NumberInput value={rule.days} min={1} max={36500} label="days" onChange={(days) => onChange({ ...rule, days })} />
          <span className="secondary">days</span>
        </>
      )}
      <span className="smart-spacer" />
      <IconButton icon={Trash2} label="Remove rule" size={15} onClick={onRemove} />
    </div>
  );
}

function GroupEditor({ group, depth, onChange, onRemove }: { group: SmartGroup; depth: number; onChange: (g: SmartGroup) => void; onRemove?: () => void }) {
  const set = (i: number, n: SmartNode) => onChange({ ...group, items: group.items.map((x, j) => (j === i ? n : x)) });
  const del = (i: number) => onChange({ ...group, items: group.items.filter((_, j) => j !== i) });
  return (
    <div className={`smart-group ${depth > 1 ? 'smart-group--nested' : ''}`} role="group" aria-label={depth > 1 ? 'Rule group' : 'Rules'}>
      <div className="smart-group__head">
        <span className="secondary">Match</span>
        <select className="field" aria-label="Match all or any" value={group.match} onChange={(e) => onChange({ ...group, match: e.target.value as 'all' | 'any' })}>
          <option value="all">all</option><option value="any">any</option>
        </select>
        <span className="secondary">of the following</span>
        <span className="smart-spacer" />
        {onRemove && <IconButton icon={Trash2} label="Remove group" size={15} onClick={onRemove} />}
      </div>
      {group.items.map((n, i) => (isGroup(n)
        ? <GroupEditor key={i} group={n} depth={depth + 1} onChange={(g) => set(i, g)} onRemove={() => del(i)} />
        : <RuleRow key={i} rule={n} onChange={(r) => set(i, r)} onRemove={() => del(i)} />))}
      <div className="smart-group__foot">
        <Button size="sm" icon={Plus} onClick={() => onChange({ ...group, items: [...group.items, newRule('genre')] })}>Add rule</Button>
        {depth < SMART_LIMITS.depth && <Button size="sm" icon={Plus} onClick={() => onChange({ ...group, items: [...group.items, { match: 'any', items: [newRule('genre')] }] })}>Add group</Button>}
      </div>
    </div>
  );
}

/** Rule editor sheet for creating or editing a smart playlist. Mounted once in the app shell. */
export function SmartEditorHost() {
  const editing = useSmartEditor((s) => s.editing);
  return editing ? <SmartEditor key={editing.id ?? 'new'} id={editing.id} /> : null;
}

function SmartEditor({ id }: { id: number | null }) {
  const [name, setName] = useState('');
  const [def, setDef] = useState<SmartDefinition>(() => ({ ...emptyDefinition(), root: { match: 'all', items: [newRule('genre')] } }));
  const [loaded, setLoaded] = useState(id == null);
  const [preview, setPreview] = useState<SmartPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id == null) return;
    let alive = true;
    invoke('smart:list').then((all) => {
      const p = all.find((x) => x.id === id);
      if (!alive) return;
      if (!p) { toast('error', 'That smart playlist no longer exists'); closeSmartEditor(); return; }
      setName(p.name);
      setDef(p.error ? { ...emptyDefinition(), root: { match: 'all', items: [newRule('genre')] } } : p.definition);
      if (p.error) setError(`The saved rules could not be read (${p.error}). Rebuild them below.`);
      setLoaded(true);
    }, () => { if (alive) closeSmartEditor(); });
    return () => { alive = false; };
  }, [id]);

  const local = problem(def.root) ?? (count(def.root) === 0 ? 'Add at least one rule' : null);

  // Live preview, debounced; ignores stale answers.
  useEffect(() => {
    if (!loaded || local) { setPreview(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      invoke('smart:preview', def).then((p) => { if (alive) { setPreview(p); setError(null); } }, (err: Error) => { if (alive) { setPreview(null); setError(err.message); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [def, loaded, local]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeSmartEditor(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);

  const save = async () => {
    if (saving || local || !name.trim()) return;
    setSaving(true);
    try {
      const pl = id == null ? await invoke('smart:create', name.trim(), def) : await invoke('smart:update', id, { name: name.trim(), definition: def });
      closeSmartEditor();
      navigate({ name: 'smart', id: pl.id });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeSmartEditor(); }}>
      <div className="sheet sheet--wide smart-editor" role="dialog" aria-labelledby="smart-title">
        <h2 id="smart-title" className="t-headline">{id == null ? 'New Smart Playlist' : 'Edit Smart Playlist'}</h2>
        <input className="field" aria-label="Smart playlist name" placeholder="Name" maxLength={SMART_LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <GroupEditor group={def.root} depth={1} onChange={(root) => setDef({ ...def, root })} />
        <div className="smart-row">
          <span className="secondary">Order by</span>
          <select className="field" aria-label="Order by" value={def.sort} onChange={(e) => setDef({ ...def, sort: e.target.value as SmartSort })}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {def.sort !== 'random' && (
            <select className="field" aria-label="Direction" value={def.desc ? 'desc' : 'asc'} onChange={(e) => setDef({ ...def, desc: e.target.value === 'desc' })}>
              <option value="asc">ascending</option><option value="desc">descending</option>
            </select>
          )}
          <label className="smart-limit">
            <input type="checkbox" checked={def.limit != null} onChange={(e) => setDef({ ...def, limit: e.target.checked ? 50 : null })} /> Limit to
          </label>
          {def.limit != null && <NumberInput value={def.limit} min={1} max={SMART_LIMITS.limit} label="limit" onChange={(limit) => setDef({ ...def, limit: Number.isFinite(limit) ? limit : 1 })} />}
          {def.limit != null && <span className="secondary">items</span>}
        </div>
        <div className="smart-preview secondary t-callout" aria-live="polite">
          {local ? local : error ? error : preview ? `${preview.count} match${preview.count === 1 ? '' : 'es'} right now${preview.durationSec ? ` · ${formatDuration(preview.durationSec, { long: true })}` : ''}${preview.items.length ? ` — ${preview.items.slice(0, 3).map((i) => i.title).join(', ')}${preview.count > 3 ? '…' : ''}` : ''}` : 'Checking…'}
        </div>
        {local && error && <div className="smart-error t-callout">{error}</div>}
        <div className="sheet__actions">
          <Button onClick={closeSmartEditor}>Cancel</Button>
          <Button variant="primary" disabled={saving || !!local || !name.trim() || !loaded} onClick={() => void save()}>{id == null ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
