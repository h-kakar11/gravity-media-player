import { stat } from 'node:fs/promises';
import type { DroppedPath } from '@shared/drop';

/** Look at each dropped path on disk. Unreadable or vanished paths come back as "missing". */
export async function classifyPaths(paths: string[]): Promise<DroppedPath[]> {
  return Promise.all(paths.map(async (path): Promise<DroppedPath> => {
    try {
      const st = await stat(path);
      return { path, kind: st.isDirectory() ? 'folder' : st.isFile() ? 'file' : 'missing' };
    } catch {
      return { path, kind: 'missing' };
    }
  }));
}
