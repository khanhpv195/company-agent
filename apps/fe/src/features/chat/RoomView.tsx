import type { Agent, Member, Room } from '@repo/shared';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { useChatStore, scopeKey } from '../../stores/chat';
import { useMembers, usePeople, useSession } from '../workspace/workspace.api';
import {
  useReadCursor,
  useRoomMembers,
  useRooms,
  useRoomsQuery,
  useRoomTimeline,
  useSendMessage,
  useTypingPing,
} from './chat.api';
import { flattenTimeline, mergeOutbox } from './chat.cache';
import { resolveLegacyChatId } from './chat.logic';
import { maxSeq } from './chat.timeline';
import { outboxToMessage } from './chat.sync';
import { ChatScope } from './ChatScope';
import { Composer } from './Composer';
import { RoomHeader } from './RoomHeader';
import { StartDmList } from './StartDmList';
import { ThreadPanel } from './ThreadPanel';
import { Timeline } from './Timeline';
import { TypingLine } from './TypingLine';

const route = getRouteApi('/_app/chat/$roomId');

/** `/chat/<id>`: a room, or (old links) the root of one of its threads. */
export function RoomView() {
  const { roomId } = route.useParams();
  return <RoomResolver key={roomId} roomId={roomId} />;
}

function RoomResolver({ roomId }: { roomId: string }) {
  const t = useT();
  const search = route.useSearch();
  const navigate = useNavigate();
  const roomsQuery = useRoomsQuery();
  const rooms = roomsQuery.data;
  const room = rooms?.find((r) => r.id === roomId);
  const legacy = rooms && !room ? resolveLegacyChatId(rooms, roomId) : null;
  const [openedAt] = useState(() => Date.now());
  // The list is fresh once it was fetched after this view opened.
  const fresh = roomsQuery.dataUpdatedAt >= openedAt && !roomsQuery.isFetching;

  useEffect(() => {
    if (legacy)
      void navigate({
        to: '/chat/$roomId',
        params: { roomId: legacy.roomId },
        search: { thread: legacy.thread, message: search.message },
        replace: true,
      });
    else if (rooms && !room && !fresh && !roomsQuery.isFetching) {
      // The list may predate a room that was just created: ask once more before giving up.
      void roomsQuery.refetch();
    }
  }, [legacy, rooms, room, fresh, roomsQuery, navigate, search.message]);

  if (!room || legacy)
    return (
      <main className="main">
        <div className="loading">
          {rooms && !legacy && fresh ? t('chat.notFound') : t('chat.loading')}
        </div>
      </main>
    );
  return <RoomBody key={room.id} room={room} thread={search.thread} message={search.message} />;
}

function RoomBody({
  room,
  thread,
  message,
}: {
  room: Room;
  thread: string | undefined;
  message: string | undefined;
}) {
  const t = useT();
  const navigate = useNavigate();
  const people = usePeople();
  const allMembers = useMembers();
  const me = useSession().data?.user.id;
  const threadRequest = useChatStore((s) => s.threadRequest);
  const timeline = useRoomTimeline(room.id);
  const membersQuery = useRoomMembers(room.id);
  const outbox = useChatStore((s) => s.outbox);
  const notice = useChatStore((s) => s.notices[scopeKey(room.id)]);
  const sender = useSendMessage();
  const ping = useTypingPing(room.id);
  // The read cursor as it was when the room opened (the "new messages" divider stays put).
  const [openRead] = useState(() => room.lastReadSeq ?? 0);

  useEffect(() => useChatStore.getState().touchRoom(room.id), [room.id]);

  const server = useMemo(() => flattenTimeline(timeline.data), [timeline.data]);
  const messages = useMemo(
    () => mergeOutbox(server, outbox, room.id, null, outboxToMessage),
    [server, outbox, room.id],
  );
  useReadCursor({
    roomId: room.id,
    seq: maxSeq(server),
    current: room.lastReadSeq ?? 0,
    enabled: timeline.isSuccess,
  });

  const isDm = room.kind === 'dm';
  const dmAgent = isDm ? people.agent(room.agentId) : undefined;
  const offline =
    dmAgent && dmAgent.status === 'offline' ? t('chat.agentOffline', { name: dmAgent.name }) : null;

  // Who the mention picker offers: the room's members (a DM: just the agent).
  const mentionable = useMemo((): { agents: Agent[]; members: Member[] } => {
    if (isDm) return { agents: dmAgent ? [dmAgent] : [], members: [] };
    const data = membersQuery.data;
    if (!data) return { agents: [], members: [] };
    return {
      agents: data.agents.flatMap((a) => people.agent(a.agentId) ?? []),
      members: data.members
        .filter((m) => m.memberId !== me)
        .flatMap((m) => people.member(m.memberId) ?? []),
    };
  }, [isDm, dmAgent, membersQuery.data, people, me]);

  const openThread = (rootId: string) =>
    void navigate({
      to: '/chat/$roomId',
      params: { roomId: room.id },
      search: { thread: rootId },
    });
  const closeThread = () =>
    void navigate({ to: '/chat/$roomId', params: { roomId: room.id }, search: {} });

  // A link to a reply names its thread; the main timeline only chases root messages.
  const mainTarget = thread && message !== thread ? undefined : message;
  const threadTarget = thread ? message : undefined;

  const others = allMembers.filter(
    (m) => m.id !== me && !mentionable.members.some((x) => x.id === m.id),
  );

  return (
    <main className={`main room-main${thread ? ' with-thread' : ''}`}>
      <RoomHeader room={room} dmAgent={dmAgent} />
      <div className="room-split">
        <ChatScope roomId={room.id} myRoomRole={room.myRole} messages={messages}>
          <div className={`room-col${isDm ? ' room-dm' : ''}`}>
            {timeline.isError ? (
              <div className="loading">{t('chat.loadFailed')}</div>
            ) : (
              <Timeline
                label={isDm ? (dmAgent?.name ?? room.name) : `#${room.name}`}
                roomId={room.id}
                dm={isDm}
                me={me}
                messages={messages}
                hasMore={timeline.hasNextPage}
                loadingMore={timeline.isFetchingNextPage}
                onLoadMore={() => void timeline.fetchNextPage()}
                lastReadAtOpen={timeline.isSuccess ? openRead : null}
                targetId={mainTarget}
                onOpenThread={openThread}
                onRetry={(cid) => void sender.retry(cid)}
                onDiscard={sender.discard}
                empty={
                  timeline.isSuccess && (
                    <div className="empty-line" style={{ padding: '40px 70px' }}>
                      {t('chat.emptyPrefix')}
                      <code>@</code>
                      {t('chat.emptySuffix')}
                    </div>
                  )
                }
              />
            )}
            <TypingLine roomId={room.id} />
            <Composer
              key={room.id}
              roomId={room.id}
              agents={mentionable.agents}
              members={mentionable.members}
              others={isDm ? [] : others}
              allowHere={!isDm}
              allowNewThread={!isDm}
              openThreadSignal={threadRequest}
              disabledReason={offline}
              placeholder={
                isDm
                  ? t('chat.composer.messageTo', { name: dmAgent?.name ?? room.name })
                  : t('chat.composer.messageIn', { name: room.name })
              }
              notice={notice}
              onDismissNotice={() => useChatStore.getState().setNotice(scopeKey(room.id), [])}
              onTyping={ping}
              onSend={(markdown, extra) =>
                void sender.send({ roomId: room.id, markdown, ...extra })
              }
            />
          </div>
        </ChatScope>
        {thread && (
          <ThreadPanel
            key={thread}
            room={room}
            rootId={thread}
            agents={mentionable.agents}
            members={mentionable.members}
            targetId={threadTarget}
            onClose={closeThread}
          />
        )}
      </div>
    </main>
  );
}

export function ChatEmpty() {
  const t = useT();
  const rooms = useRooms();
  if (!rooms.length)
    return (
      <main className="main">
        <div
          className="empty-state"
          style={{ alignContent: 'center', width: 360, margin: '0 auto' }}
        >
          <p style={{ color: 'var(--muted)', margin: '0 0 12px', textAlign: 'center' }}>
            {t('chat.emptyHint')}
          </p>
          <div style={{ width: '100%' }}>
            <StartDmList />
          </div>
        </div>
      </main>
    );
  return (
    <main className="main">
      <div className="empty-state">
        <svg width="220" height="200" viewBox="0 0 220 200" aria-hidden="true">
          <defs>
            <radialGradient id="v" cx=".5" cy=".5" r=".5">
              <stop offset=".7" stopColor="#000" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <mask id="m">
              <rect width="220" height="200" fill="url(#v)" />
            </mask>
          </defs>
          <g mask="url(#m)">
            <rect width="220" height="200" fill="#e7ecf1" />
            <path d="M0 95 L50 70 L90 88 L140 62 L220 90 V110 H0Z" fill="#b8c2d3" />
            <rect y="105" width="220" height="40" fill="#cdd9e3" />
            <rect y="104" width="220" height="3" fill="#f5efd9" opacity=".8" />
            <rect y="140" width="220" height="60" fill="#efe7d8" />
            <rect y="128" width="70" height="20" fill="#f4efe6" />
            <g stroke="#8a5a34" strokeWidth="4" strokeLinecap="round" fill="none">
              <path d="M120 95 V160 M150 95 V170 M120 130 H150 M118 132 L112 172 M152 130 L156 176" />
              <path d="M120 102 H150 M120 112 H150" strokeWidth="3" />
            </g>
          </g>
        </svg>
      </div>
    </main>
  );
}
