import { FolderSearch, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatBytes } from '@shared/format';
import { HEALTH_CATEGORY_LABELS, type HealthCategory, type HealthFile, type HealthFinding, type HealthReport } from '@shared/health';
import { invoke } from '../../api';
import { Button, IconButton, Spinner, Switch } from '../../components/ui';
import { useLibrary } from '../../state/library';
import { toast, useUi } from '../../state/ui';
import { Group, Row } from './parts';
import '../../styles/health.css';

const CATEGORIES: HealthCategory[] = ['duplicates', 'missing', 'files'];
const EMPTY: Record<HealthCategory, string> = {
  duplicates: 'No duplicate movies or episodes found.',
  missing: 'No missing episodes found.',
  files: 'Every file could be found and read.'
};

export function HealthPane() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkFiles, setCheckFiles] = useState(true);

  const scan = async () => {
    setBusy(true);
    try { setReport(await invoke('health:scan', { checkFiles })); }
    catch (err) { toast('error', (err as Error).message); }
    setBusy(false);
  };

  const trash = async (finding: HealthFinding, file: HealthFile) => {
    const keep = finding.files.find((f) => f.best);
    const ok = await useUi.getState().confirm({
      title: `Move “${file.fileName}” to the Trash?`,
      message: `${file.path}\n${formatBytes(file.size)}${keep && keep.id !== file.id ? `\n\nGravity would keep “${keep.fileName}”.` : ''}\n\nThe file goes to your system Trash, so you can restore it from there.`,
      confirmLabel: 'Move to Trash',
      destructive: true
    });
    if (!ok) return;
    try {
      await invoke('shell:trash', file.id);
      useLibrary.setState((x) => ({ revision: x.revision + 1 }));
      toast('success', `Moved “${file.fileName}” to the Trash`);
      await scan();
    } catch (err) { toast('error', (err as Error).message); }
  };

  const reveal = (file: HealthFile) => void invoke('shell:reveal', file.id).catch((err: Error) => toast('error', err.message));
  const s = report?.summary;

  return (
    <>
      <Group title="Library Health" footer="A read-only check of your library. Gravity never changes or deletes anything on its own — you can reveal a file in its folder, or move a duplicate to the Trash after confirming.">
        <Row label="Check my library" hint="Finds duplicates and lower-quality copies, gaps in your episodes, and files that are empty, damaged or missing.">
          <Button variant="primary" onClick={() => void scan()} disabled={busy}>{busy ? <><Spinner size={13} /> Checking…</> : report ? 'Check Again' : 'Check Library'}</Button>
        </Row>
        <Row label="Check files on disk" hint="Opens each file to make sure it exists and can be read. Turn off for a quick check that only uses what Gravity already knows.">
          <Switch label="Check files on disk" checked={checkFiles} onChange={setCheckFiles} />
        </Row>
      </Group>

      {report && s && (
        <Group title={`Results · ${new Date(report.generatedAt).toLocaleTimeString()}`}>
          <div className="health-summary">
            <Stat n={s.duplicateGroups} label="duplicate groups" />
            <Stat n={s.lowerQualityCopies} label="lower-quality copies" />
            <Stat text={formatBytes(s.reclaimableBytes)} label="could be reclaimed" />
            <Stat n={s.missingEpisodes} label="missing episodes" />
            <Stat n={s.problemFiles} label="problem files" />
          </div>
          {report.warnings.map((w) => <div key={w} className="health-warn" role="status">{w}</div>)}
        </Group>
      )}

      {report && CATEGORIES.map((cat) => {
        const items = report.findings.filter((f) => f.category === cat);
        return (
          <Group key={cat} title={`${HEALTH_CATEGORY_LABELS[cat]}${items.length ? ` · ${items.length}` : ''}`}>
            {items.length === 0 && <Row label={EMPTY[cat]} />}
            {items.map((f) => <Finding key={f.id} finding={f} onReveal={reveal} onTrash={(file) => void trash(f, file)} />)}
          </Group>
        );
      })}
    </>
  );
}

function Stat({ n, text, label }: { n?: number; text?: string; label: string }) {
  return <div className="health-stat"><b>{text ?? (n ?? 0).toLocaleString()}</b><span className="secondary t-footnote">{label}</span></div>;
}

function Finding({ finding, onReveal, onTrash }: { finding: HealthFinding; onReveal: (f: HealthFile) => void; onTrash: (f: HealthFile) => void }) {
  const canTrash = finding.category === 'duplicates';
  return (
    <div className="finding">
      <div className="finding__head">
        <span className={`finding__sev finding__sev--${finding.severity}`} aria-hidden="true" />
        <span className="finding__title truncate">{finding.title}</span>
      </div>
      <p className="finding__why secondary t-callout">{finding.explanation}</p>
      {finding.files.length > 0 && (
        <div className="hfiles">
          {finding.files.map((file) => (
            <div key={file.id} className={`hfile ${file.best ? 'hfile--best' : ''}`}>
              <div className="hfile__text">
                <span className="hfile__name truncate">{file.fileName}</span>
                <span className="hfile__path truncate secondary t-footnote" title={file.path}>{file.path}</span>
                <span className="secondary t-footnote">{[file.quality, file.size ? formatBytes(file.size) : ''].filter(Boolean).join(' · ')}</span>
                {file.reasons.length > 0 && <span className="hfile__reasons t-footnote">{file.reasons.join(' · ')}</span>}
              </div>
              {file.best && <span className="hfile__tag">Best</span>}
              <div className="hfile__actions">
                <IconButton icon={FolderSearch} label={file.exists ? `Reveal ${file.fileName} in folder` : 'File is missing'} disabled={!file.exists} onClick={() => onReveal(file)} />
                {canTrash && file.exists && <IconButton icon={Trash2} label={`Move ${file.fileName} to Trash`} onClick={() => onTrash(file)} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
