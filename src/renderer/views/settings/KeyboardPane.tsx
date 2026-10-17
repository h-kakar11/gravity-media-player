import { AlertTriangle, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ACTION_BY_ID, ACTIONS, comboLabel, effectiveKeymap, eventToCombo, findConflicts, normalizeCombo } from '@shared/hotkeys';
import { isMac } from '../../api';
import { Button, Icon } from '../../components/ui';
import { hotkeyCapture } from '../../lib/hotkeys';
import { toast, useUi } from '../../state/ui';
import { Group, useS } from './parts';

const sameCombos = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => normalizeCombo(c) === normalizeCombo(b[i]!));

export function KeyboardPane() {
  const { s, update } = useS();
  const [filter, setFilter] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const map = effectiveKeymap(s.hotkeys);
  const conflicts = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const c of findConflicts(map)) for (const id of c.actions) out.set(id, [...new Set([...(out.get(id) ?? []), ...c.actions.filter((x) => x !== id)])]);
    return out;
  }, [map]);

  const setCombos = (id: string, combos: string[]) => update({ hotkeys: { [id]: combos } });

  // Record the next key combination for the chosen action.
  useEffect(() => {
    if (!recording) return;
    hotkeyCapture.active = true;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) { setRecording(null); return; }
      const combo = eventToCombo(e, isMac);
      if (!combo) return; // a bare modifier: wait for the real key
      const current = map[recording] ?? [];
      if (!current.some((c) => normalizeCombo(c) === combo)) {
        setCombos(recording, [...current, combo]);
        const clash = ACTIONS.filter((a) => a.id !== recording && (map[a.id] ?? []).some((c) => normalizeCombo(c) === combo));
        if (clash.length) toast('info', `${comboLabel(combo, isMac)} is also used for ${clash.map((c) => c.label).join(', ')}.`);
      }
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); hotkeyCapture.active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const resetAll = async () => {
    if (!(await useUi.getState().confirm({ title: 'Restore default shortcuts?', message: 'All custom shortcuts are replaced by the defaults.', confirmLabel: 'Restore' }))) return;
    update({ hotkeys: Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.defaults]])) });
  };

  const q = filter.trim().toLowerCase();
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  const matches = (a: (typeof ACTIONS)[number]) => !q || a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q) || (map[a.id] ?? []).some((c) => comboLabel(c, isMac).toLowerCase().includes(q));
  const visible = groups.filter((g) => ACTIONS.some((a) => a.group === g && matches(a)));

  return (
    <>
      <div className="kb-tools">
        <label className="kb-search"><Icon as={Search} size={14} className="tertiary" /><input className="field" type="search" placeholder="Search actions or keys" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search shortcuts" /></label>
        <Button size="sm" variant="plain" icon={RotateCcw} onClick={() => void resetAll()}>Restore Defaults</Button>
      </div>
      {conflicts.size > 0 && (
        <div className="callout callout--warn" role="status"><Icon as={AlertTriangle} size={16} /><span>{conflicts.size} shortcut{conflicts.size === 1 ? ' is' : 's are'} assigned to more than one action. The one that’s active in the current screen wins — review the rows marked below.</span></div>
      )}
      {visible.map((g) => (
        <Group key={g} title={g}>
          {ACTIONS.filter((a) => a.group === g && matches(a)).map((a) => {
            const combos = map[a.id] ?? [];
            const custom = !sameCombos(combos, a.defaults);
            const clash = conflicts.get(a.id);
            const rec = recording === a.id;
            return (
              <div key={a.id} className="srow srow--compact kb-row">
                <div className="srow__text">
                  <span>{a.label}</span>
                  {a.scope !== 'global' && <span className="kb-scope t-footnote tertiary">{a.scope === 'player' ? 'while playing' : a.scope === 'reader' ? 'while reading' : 'music'}</span>}
                  {clash && <span className="kb-clash t-footnote" title={`Also assigned to: ${clash.map((id) => ACTION_BY_ID.get(id)?.label ?? id).join(', ')}`}><Icon as={AlertTriangle} size={12} /> Conflicts with {clash.map((id) => ACTION_BY_ID.get(id)?.label ?? id).slice(0, 2).join(', ')}</span>}
                </div>
                <div className="srow__ctl kb-keys">
                  {combos.map((c) => (
                    <span key={c} className="kb-chip">
                      <kbd className="kbd">{comboLabel(normalizeCombo(c), isMac)}</kbd>
                      <button type="button" className="kb-chip__x" aria-label={`Remove ${comboLabel(normalizeCombo(c), isMac)} from ${a.label}`} onClick={() => setCombos(a.id, combos.filter((x) => x !== c))}><X size={11} strokeWidth={2.4} /></button>
                    </span>
                  ))}
                  {rec
                    ? <button type="button" className="kb-add is-recording" onClick={() => setRecording(null)} aria-live="polite">Press keys… <span className="tertiary">Esc to cancel</span></button>
                    : <button type="button" className="kb-add" aria-label={`Add a shortcut for ${a.label}`} onClick={() => setRecording(a.id)}><Plus size={13} strokeWidth={2.4} />{combos.length === 0 ? 'Add shortcut' : ''}</button>}
                  {custom && !rec && <button type="button" className="kb-reset" aria-label={`Restore default for ${a.label}`} title="Restore default" onClick={() => setCombos(a.id, [...a.defaults])}><RotateCcw size={13} /></button>}
                </div>
              </div>
            );
          })}
        </Group>
      ))}
      {visible.length === 0 && <p className="secondary settings__lede">No shortcut matches “{filter}”.</p>}
      <p className="t-footnote tertiary settings__lede">{isMac ? '⌘ is Command, ⌥ is Option, ⌃ is Control.' : 'Ctrl is the main modifier. Menu items show the first shortcut for each action.'} Single keys like Space or J only work while the matching player is on screen, and never while you’re typing in a field.</p>
    </>
  );
}
