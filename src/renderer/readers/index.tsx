import { useReader } from '../state/reader';
import { ComicReader } from './ComicReader';
import { EpubReader } from './EpubReader';
import { ImageViewer } from './ImageViewer';

/** Full-window reader overlay, chosen by the kind of the opened item. */
export function ReaderHost() {
  const item = useReader((s) => s.item);
  const context = useReader((s) => s.context);
  if (!item) return null;
  return (
    <div className="reader-host" role="dialog" aria-label={`Reading ${item.title}`}>
      {item.kind === 'comic' && <ComicReader key={item.id} item={item} />}
      {item.kind === 'book' && <EpubReader key={item.id} item={item} />}
      {item.kind === 'image' && <ImageViewer key="images" item={item} context={context} />}
    </div>
  );
}
