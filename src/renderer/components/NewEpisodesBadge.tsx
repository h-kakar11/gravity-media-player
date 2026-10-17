import '../styles/watch.css';
import { useNewEpisodes } from '../state/watch';

/** The "3 new" pill on a show's card; renders nothing when there is nothing new. */
export function NewEpisodesBadge({ seriesKey }: { seriesKey: string }) {
  const n = useNewEpisodes(seriesKey);
  return n > 0 ? <span className="pill pill--new">{n} new</span> : null;
}
