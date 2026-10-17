import { ArrowDownUp, Columns3, Filter, LayoutGrid, List } from 'lucide-react';
import { useRef } from 'react';
import { SORT_LABELS } from '@shared/ipc';
import type { ViewMode } from '@shared/settings';
import type { SortKey } from '@shared/types';
import { useSettings } from '../state/settings';
import { useUi, type MenuEntry } from '../state/ui';
import { ToolbarRight } from './Toolbar';
import { IconButton, Segmented } from './ui';

export interface ViewState {
  mode: ViewMode;
  sort: { key: SortKey; desc: boolean };
  setMode: (m: ViewMode) => void;
  setSort: (key: SortKey, desc?: boolean) => void;
}

/** Persisted per-section view mode and sort order. */
export function useViewState(viewKey: string, defaults: { mode: ViewMode; sort: SortKey; desc?: boolean }): ViewState {
  const stored = useSettings((s) => s.settings.view);
  const update = useSettings((s) => s.update);
  const mode = stored.mode[viewKey] ?? defaults.mode;
  const sort = stored.sort[viewKey] ?? { key: defaults.sort, desc: defaults.desc ?? false };
  return {
    mode,
    sort,
    setMode: (m) => update({ view: { mode: { [viewKey]: m } } }),
    setSort: (key, desc) => update({ view: { sort: { [viewKey]: { key, desc: desc ?? (key === sort.key ? !sort.desc : defaultDesc(key)) } } } })
  };
}

const defaultDesc = (k: SortKey) => k === 'added' || k === 'played' || k === 'year' || k === 'rating' || k === 'progress';

export function openAnchoredMenu(el: HTMLElement, entries: MenuEntry[]): void {
  const r = el.getBoundingClientRect();
  useUi.getState().openMenu(r.left, r.bottom + 6, entries);
}

export interface FilterGroup {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}

export function ViewControls({
  state, modes = ['grid', 'list'], sorts, filters, activeFilters = 0, extra
}: {
  state: ViewState; modes?: ViewMode[]; sorts?: SortKey[]; filters?: FilterGroup[]; activeFilters?: number; extra?: React.ReactNode;
}) {
  const sortRef = useRef<HTMLSpanElement>(null);
  const filterRef = useRef<HTMLSpanElement>(null);
  const icons = { grid: LayoutGrid, list: List, columns: Columns3 } as const;
  const labels = { grid: 'as Grid', list: 'as List', columns: 'as Columns' } as const;
  return (
    <ToolbarRight>
      {extra}
      {filters && filters.length > 0 && (
        <span ref={filterRef}>
          <IconButton
            icon={Filter} label="Filter" active={activeFilters > 0} badge={activeFilters > 0 ? activeFilters : undefined}
            onClick={() => {
              const entries: MenuEntry[] = [];
              filters.forEach((g, gi) => {
                if (gi > 0) entries.push({ separator: true });
                entries.push({ label: g.label, disabled: true });
                for (const o of g.options) entries.push({ label: o.label, checked: g.value === o.value, run: () => g.onChange(o.value) });
              });
              openAnchoredMenu(filterRef.current!, entries);
            }}
          />
        </span>
      )}
      {sorts && (
        <span ref={sortRef}>
          <IconButton
            icon={ArrowDownUp} label={`Sort: ${SORT_LABELS[state.sort.key]}`}
            onClick={() =>
              openAnchoredMenu(sortRef.current!, [
                ...sorts.map<MenuEntry>((k) => ({ label: SORT_LABELS[k], checked: state.sort.key === k, run: () => state.setSort(k, k === state.sort.key ? state.sort.desc : undefined) })),
                { separator: true },
                { label: 'Ascending', checked: !state.sort.desc, run: () => state.setSort(state.sort.key, false) },
                { label: 'Descending', checked: state.sort.desc, run: () => state.setSort(state.sort.key, true) }
              ])
            }
          />
        </span>
      )}
      {modes.length > 1 && (
        <Segmented<ViewMode> label="View mode" size="sm" value={state.mode} onChange={state.setMode} options={modes.map((m) => ({ value: m, icon: icons[m], title: `View ${labels[m]}` }))} />
      )}
    </ToolbarRight>
  );
}
