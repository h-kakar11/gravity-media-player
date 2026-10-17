import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Makes sure the sample library exists (generated once, cached in .e2e/) and that a display is available. */
export default function setup(): void {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    throw new Error('The end-to-end tests launch Electron and need a display. Run them with: xvfb-run -a npm run test:e2e');
  }
  for (const f of ['dist/main/index.cjs', 'dist/renderer/index.html']) {
    if (!existsSync(resolve(f))) throw new Error(`${f} is missing — run "npm run build" first (npm run test:e2e does this for you).`);
  }
  const media = resolve('.e2e/media-src');
  if (!existsSync(resolve(media, 'Movies'))) {
    execFileSync(process.execPath, [resolve('scripts/make-sample-media.mjs'), media], { stdio: 'inherit' });
  }
  process.env.GRAVITY_E2E_MEDIA = media;
}
