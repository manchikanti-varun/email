// List detail page. Thin: composes the lists feature detail container.
import { ListDetailContainer } from '../features/lists/components/ListDetailContainer';

export function ListDetailPage({ id }: { id: string }) {
  return <ListDetailContainer id={id} />;
}
