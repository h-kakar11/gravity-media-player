import { PageHeader } from '../components/layout';
export function SettingsView({ pane }: { pane?: string }) { return <PageHeader title={`Settings ${pane ?? ''}`} />; }
