import { ChatThread } from './ChatThread';
import type { ComponentProps } from 'react';

/** Dock shell. The thread also serves the task conversation pane. */
export function ChatWindow(props: Omit<ComponentProps<typeof ChatThread>, 'embedded'>) {
  return <ChatThread {...props} />;
}
