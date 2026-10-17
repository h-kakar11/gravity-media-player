import { planDrop } from '@shared/drop';
import { invoke } from '../api';
import { useLibrary } from '../state/library';
import { toast, useUi } from '../state/ui';
import { openMedia } from './actions';

const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Handle files and folders dropped on the window (or chosen with Open File). Media files play
 * right away; new folders are offered to the library in one confirmation; anything that can't be
 * used is reported instead of silently ignored.
 */
export async function handleDrop(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const plan = planDrop(await invoke('library:classifyPaths', paths), useLibrary.getState().roots);

    if (plan.play.length > 0) {
      const items = await invoke('library:ingest', plan.play);
      if (items.length > 0) openMedia(items[0]!, items);
      else toast('error', 'Gravity couldn’t read that file.');
    }

    for (const c of plan.covered) toast('info', `“${nameOf(c.path)}” is already in your library (in “${nameOf(c.root)}”).`);

    if (plan.add.length > 0) {
      const names = plan.add.slice(0, 5).map((p) => `“${nameOf(p)}”`).join(', ') + (plan.add.length > 5 ? ` and ${plan.add.length - 5} more` : '');
      const overlap = plan.overlapping.length > 0 ? ` ${plan.overlapping.length === plan.add.length ? 'It already contains' : 'Some already contain'} a library folder, so items inside may be listed twice.` : '';
      const ok = await useUi.getState().confirm({
        title: `Add ${plan.add.length === 1 ? `“${nameOf(plan.add[0]!)}”` : plural(plan.add.length, 'folder')} to your library?`,
        message: `Gravity will scan ${plan.add.length === 1 ? 'this folder' : names}, keep ${plan.add.length === 1 ? 'it' : 'them'} up to date, and show the contents alongside your other media.${overlap}`,
        confirmLabel: plan.add.length === 1 ? 'Add Folder' : 'Add Folders'
      });
      if (ok) {
        let added = 0;
        for (const p of plan.add) {
          try { if (await invoke('roots:add', p)) added++; } catch (err) { toast('error', (err as Error).message); }
        }
        if (added > 0) toast('success', added === 1 ? `Added “${nameOf(plan.add[0]!)}” — scanning now` : `Added ${plural(added, 'folder')} — scanning now`);
      }
    }

    if (plan.ignored.length > 0 && plan.play.length === 0 && plan.add.length === 0 && plan.covered.length === 0) {
      toast('info', plan.ignored.length === 1 ? `Gravity can’t open “${nameOf(plan.ignored[0]!)}”.` : `Gravity can’t open any of those ${plan.ignored.length} items.`);
    }
  } catch (err) {
    toast('error', (err as Error).message);
  }
}
