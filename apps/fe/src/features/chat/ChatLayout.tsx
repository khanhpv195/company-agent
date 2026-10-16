import { Outlet, useParams } from '@tanstack/react-router';
import { ChatPanel } from './ChatPanel';

export function ChatLayout() {
  const { chatId } = useParams({ strict: false });
  return (
    <>
      <ChatPanel activeId={chatId} />
      <Outlet />
    </>
  );
}
