// Prawy panel karty zadania: rozmowa o zadaniu. Właściciel: linia L3.
// STUB kontraktu (docs/karta-v2/SPEC.md): na razie fallback trybu lokalnego.
import { CommentsPanel } from '../../components/CommentsPanel';

export interface TaskConversationPaneProps {
  taskId: string;
}

export function TaskConversationPane({ taskId }: TaskConversationPaneProps) {
  return <CommentsPanel entityType="task" entityId={taskId} />;
}
