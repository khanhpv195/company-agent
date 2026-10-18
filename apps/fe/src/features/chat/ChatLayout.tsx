import { Outlet, useParams, useSearch } from '@tanstack/react-router';
import { ChatPanel } from './ChatPanel';

export function ChatLayout() {
  const { roomId } = useParams({ strict: false });
  const { thread } = useSearch({ strict: false }) as { thread?: string };
  return (
    <>
      <ChatPanel activeId={roomId} activeThread={thread} />
      <Outlet />
    </>
  );
}
