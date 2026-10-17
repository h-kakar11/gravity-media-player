import { Switch } from '../../components/ui';
import { useUi } from '../../state/ui';
import { Group, Row, useS } from './parts';

/** Skip intro / credits: automatic skipping, and the shows whose markers have been saved. */
export function SkipSettings() {
  const { s, update } = useS();
  const skip = s.skip;
  const shows = Object.entries(skip.markers).filter(([, m]) => m.intro || m.credits).map(([k]) => k).sort();
  const forget = async (show: string) => {
    if (!(await useUi.getState().confirm({ title: `Forget skip markers for “${show}”?`, message: 'The Skip Intro and Skip Credits buttons stop appearing for it unless the files have chapters.', confirmLabel: 'Forget' }))) return;
    update({ skip: { markers: { [show]: {} } } });
  };
  return (
    <Group title="Skip intro & credits" footer="The Skip button appears when a file has a chapter called Intro, Opening, Credits or Ending, or where you marked them for that show. Mark them from the command palette (Ctrl/Cmd+K) while an episode plays.">
      <Row label="Skip intros automatically"><Switch label="Skip intros automatically" checked={skip.autoIntro} onChange={(v) => update({ skip: { autoIntro: v } })} /></Row>
      <Row label="Skip credits automatically" hint="Moves on to the next episode when the credits begin."><Switch label="Skip credits automatically" checked={skip.autoCredits} onChange={(v) => update({ skip: { autoCredits: v } })} /></Row>
      {shows.map((show) => (
        <Row key={show} label={show} hint="Skip markers saved">
          <button type="button" className="btn btn--glass btn--sm" onClick={() => void forget(show)}>Forget</button>
        </Row>
      ))}
    </Group>
  );
}
