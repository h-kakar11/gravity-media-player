import { RotateCcw, RotateCw, Star, type LucideIcon } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Lucide icon with a stroke weight that matches 13 pt body text. */
export function Icon({ as: Cmp, size = 16, strokeWidth = 1.85, className, style, fill }: { as: LucideIcon; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties; fill?: string }) {
  // Only override lucide's default fill="none" when a fill is explicitly requested (undefined would turn icons solid black).
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} style={style} aria-hidden="true" {...(fill ? { fill } : {})} />;
}

export function Button({
  children, onClick, variant = 'secondary', icon, disabled, title, className = '', size = 'md', type = 'button', autoFocus
}: {
  children?: ReactNode; onClick?: (e: React.MouseEvent) => void; variant?: 'primary' | 'secondary' | 'plain' | 'danger' | 'glass'; icon?: LucideIcon;
  disabled?: boolean; title?: string; className?: string; size?: 'sm' | 'md' | 'lg'; type?: 'button' | 'submit'; autoFocus?: boolean;
}) {
  return (
    <button type={type} className={`btn btn--${variant} btn--${size} ${className}`} onClick={onClick} disabled={disabled} title={title} autoFocus={autoFocus}>
      {icon && <Icon as={icon} size={size === 'lg' ? 18 : 15} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  icon, label, onClick, active, disabled, size = 16, className = '', badge, pressed, glyph
}: {
  icon: LucideIcon; label: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; disabled?: boolean; size?: number; className?: string; badge?: string | number; pressed?: boolean;
  /** Replaces the icon with custom artwork (e.g. a skip arrow carrying its number of seconds). */
  glyph?: ReactNode;
}) {
  return (
    <button type="button" className={`icon-btn ${active ? 'is-active' : ''} ${className}`} onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={pressed ?? (active === undefined ? undefined : active)}>
      {glyph ?? <Icon as={icon} size={size} />}
      {badge != null && <span className="icon-btn__badge">{badge}</span>}
    </button>
  );
}

/** Segmented control with a sliding selection thumb. */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T; options: { value: T; label?: string; icon?: LucideIcon; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className={`seg seg--${size}`} role="radiogroup" aria-label={label} ref={ref}>
      {thumb && <span className="seg__thumb" style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="seg__opt" onClick={() => onChange(o.value)} title={o.title ?? o.label} aria-label={o.label ?? o.title}>
          {o.icon && <Icon as={o.icon} size={14} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

/** Circular skip arrow with the number of seconds inside, like the ±10 s buttons in Apple's players. */
export function SkipGlyph({ dir, seconds, size = 24 }: { dir: 'back' | 'forward'; seconds: number; size?: number }) {
  const Arrow = dir === 'back' ? RotateCcw : RotateCw;
  return (
    <span className="skip-glyph" style={{ width: size, height: size }} aria-hidden="true">
      <Arrow size={size} strokeWidth={1.7} />
      <span className="skip-glyph__num" style={{ fontSize: Math.round(size * (seconds >= 100 ? 0.3 : 0.38)) }}>{seconds}</span>
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch__knob" />
    </button>
  );
}

export function Slider({
  value, min, max, step = 1, onChange, label, className = '', format, ticks, onCommit
}: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; className?: string; format?: (v: number) => string; ticks?: number[]; onCommit?: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const id = useId();
  return (
    <div className={`slider-wrap ${className}`}>
      <input
        id={id} type="range" className="slider" min={min} max={max} step={step} value={value} aria-label={label}
        aria-valuetext={format ? format(value) : undefined}
        style={{ '--p': `${Math.min(100, Math.max(0, pct))}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      {ticks && (
        <div className="slider__ticks" aria-hidden="true">
          {ticks.map((t) => <span key={t} style={{ left: `${((t - min) / (max - min)) * 100}%` }} />)}
        </div>
      )}
    </div>
  );
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`progress ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__fill" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

export function Rating({ value, onChange, size = 16 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="rating" role={onChange ? 'radiogroup' : 'img'} aria-label={`Rating: ${value} of 5`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (hover || value) >= n;
        return (
          <button key={n} type="button" className={`rating__star ${on ? 'is-on' : ''}`} disabled={!onChange} aria-label={`${n} star${n > 1 ? 's' : ''}`} onMouseEnter={() => onChange && setHover(n)} onClick={() => onChange?.(n === value ? 0 : n)}>
            <Star size={size} strokeWidth={1.8} fill={on ? 'currentColor' : 'none'} />
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon, title, message, children }: { icon: LucideIcon; title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon"><Icon as={icon} size={30} strokeWidth={1.5} /></div>
      <h2 className="t-title-3">{title}</h2>
      {message && <p className="secondary empty__msg">{message}</p>}
      {children && <div className="empty__actions">{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
