import { FolderPlus, Globe, Keyboard, Lock, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { comboLabel } from '@shared/hotkeys';
import { welcomeDecision } from '@shared/welcome';
import { isMac } from '../api';
import { hotkeyCapture } from '../lib/hotkeys';
import { useLibrary } from '../state/library';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import { addFolderFlow } from '../views/Home';
import { Button } from './ui';
import '../styles/first-run.css';

/** A one-time welcome for an empty library: add folders, learn two shortcuts, see what stays offline. */
export function FirstRunWelcome() {
  const done = useSettings((s) => s.settings.welcome.done);
  const rootsLoaded = useLibrary((s) => s.rootsLoaded);
  const rootCount = useLibrary((s) => s.roots.length);
  const decision = welcomeDecision(done, rootsLoaded, rootCount);
  const finish = () => useSettings.getState().update({ welcome: { done: true } });

  useEffect(() => { if (decision === 'mark-done') finish(); }, [decision]);

  return decision === 'show' ? <Welcome onDone={finish} /> : null;
}

function Welcome({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    hotkeyCapture.active = true;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); } };
    document.addEventListener('keydown', onKey, true);
    return () => { hotkeyCapture.active = false; document.removeEventListener('keydown', onKey, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    await addFolderFlow();
    if (useLibrary.getState().roots.length > 0) onDone();
  };
  const review = () => { onDone(); navigate({ name: 'settings', pane: 'metadata' }); };

  return createPortal(
    <div className="firstrun-backdrop">
      <div className="firstrun" role="dialog" aria-modal="true" aria-labelledby="firstrun-title">
        <div className="firstrun__orb" aria-hidden="true"><Sparkles size={28} strokeWidth={1.6} /></div>
        <h1 id="firstrun-title" className="t-title-1">Welcome to Gravity</h1>
        <p className="firstrun__lead secondary">Your movies, shows, music, comics and books, read in place from the folders you choose.</p>
        <ul className="firstrun__points">
          <li><FolderPlus size={18} /><div><strong>Add your folders</strong><span>Gravity scans them now and keeps up as files change. You can also drop a folder on the window at any time.</span></div></li>
          <li><Keyboard size={18} /><div><strong>Press <kbd className="kbd">{comboLabel('mod+k', isMac)}</kbd> for everything</strong><span>Jump to any page, run a command or search your library from one box.</span></div></li>
          <li><Lock size={18} /><div><strong>Everything stays on this computer</strong><span>Nothing is uploaded, and no lookups go out unless you turn them on.</span></div></li>
          <li><Globe size={18} /><div><strong>Online artwork and details are optional</strong><span>Off by default. <button type="button" className="firstrun__link" onClick={review}>Review the choices</button> whenever you like.</span></div></li>
        </ul>
        <div className="firstrun__actions">
          <Button variant="primary" size="lg" icon={FolderPlus} autoFocus onClick={() => void add()}>Add Library Folder…</Button>
          <Button variant="plain" size="lg" onClick={onDone}>Skip for now</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
