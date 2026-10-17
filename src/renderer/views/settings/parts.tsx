import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Slider } from '../../components/ui';
import { useSettings } from '../../state/settings';

/** Convenience for panes: current settings plus the optimistic updater. */
export function useS() {
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return { s, update };
}

/** An inset group, like macOS System Settings: a caption above, rows inside, an optional footnote below. */
export function Group({ title, footer, children, action }: { title?: string; footer?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="sgroup">
      {(title || action) && <header className="sgroup__head"><h2 className="t-caps">{title}</h2>{action}</header>}
      <div className="sgroup__box">{children}</div>
      {footer && <p className="sgroup__foot t-footnote secondary">{footer}</p>}
    </section>
  );
}

export function Row({ label, hint, children, stack, id }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean; id?: string }) {
  return (
    <div className={`srow ${stack ? 'srow--stack' : ''}`} id={id}>
      <div className="srow__text">
        <div className="srow__label">{label}</div>
        {hint && <div className="srow__hint t-footnote secondary">{hint}</div>}
      </div>
      {children != null && <div className="srow__ctl">{children}</div>}
    </div>
  );
}

/** Native select (so it gets the platform's menu, keyboard and screen-reader behaviour) with Gravity styling. */
export function Select<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  const numeric = typeof value === 'number';
  return (
    <span className="select">
      <select
        className="field" aria-label={label} value={String(value)}
        onChange={(e) => onChange((numeric ? Number(e.target.value) : e.target.value) as T)}
      >
        {options.map((o) => <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}</option>)}
      </select>
      <ChevronsUpDown size={13} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

export function SliderControl({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format: (v: number) => string }) {
  return (
    <div className="sslider">
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} label={label} format={format} />
      <span className="sslider__val tabular secondary">{format(value)}</span>
    </div>
  );
}

/** Text field that commits on blur / Enter, so typing never fires a settings write per keystroke. */
export function CommitText({ value, onCommit, placeholder, label, area, mono, width, secret }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string; area?: boolean; mono?: boolean; width?: number | string; secret?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  const common = {
    className: `field ${area ? 'field--area' : ''} ${mono ? 'mono' : ''}`, value: draft, placeholder, 'aria-label': label,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value), onBlur: commit, style: width ? { width } : undefined
  };
  return area
    ? <textarea {...common} rows={5} spellCheck={false} />
    : <input {...common} type={secret ? 'password' : 'text'} autoComplete={secret ? 'off' : undefined} spellCheck={false} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur(); } }} />;
}

export function Stepper({ value, min, max, step = 1, onChange, label, unit, zeroLabel }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; unit?: string; zeroLabel?: string }) {
  const id = useId();
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="stepper" role="group" aria-labelledby={id}>
      <span id={id} className="sr-only">{label}</span>
      <button type="button" className="stepper__btn" aria-label={`Decrease ${label}`} onClick={() => set(value - step)} disabled={value <= min}>−</button>
      <span className="stepper__val tabular">{value === 0 && zeroLabel ? zeroLabel : `${value}${unit ?? ''}`}</span>
      <button type="button" className="stepper__btn" aria-label={`Increase ${label}`} onClick={() => set(value + step)} disabled={value >= max}>+</button>
    </div>
  );
}

/** Move `item` within `list` by `delta` positions (clamped), returning a new array. */
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const j = index + delta;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}
