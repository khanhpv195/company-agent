import type { PresenceEntry } from '@repo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  applyMessage,
  applyReactions,
  applyReadState,
  applyThreadUpdated,
  resyncOpenChats,
} from '../features/chat/chat.sync';
import { useSession } from '../features/workspace/workspace.api';
import { scopeKey, useChatStore } from '../stores/chat';
import { useUi } from '../stores/ui';
import { qk } from './query-keys';
import { connectRealtime, onRealtimeResync } from './realtime';

/** Rooms are refetched at most this often while messages stream in. */
const ROOMS_REFETCH_MS = 600;

/** Applies server push events to the TanStack Query cache. */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);
  const me = useSession().data?.user.id;

  useEffect(() => {
    let off = () => {};
    let cancelled = false;
    let roomsTimer: ReturnType<typeof setTimeout> | undefined;
    const refetchRoomsSoon = () => {
      if (roomsTimer) return;
      roomsTimer = setTimeout(() => {
        roomsTimer = undefined;
        void qc.invalidateQueries({ queryKey: qk.rooms });
      }, ROOMS_REFETCH_MS);
    };
    const offResync = onRealtimeResync(() => resyncOpenChats(qc));
    void connectRealtime().then((client) => {
      if (cancelled) return;
      off = client.subscribe((event) => {
        switch (event.type) {
          case 'message.upserted':
            applyMessage(qc, event.message, me);
            refetchRoomsSoon();
            break;
          case 'thread.updated':
            applyThreadUpdated(qc, event);
            break;
          case 'message.reactions_updated':
            applyReactions(qc, event.roomId, event.messageId, event.parentId, event.reactions, me);
            break;
          case 'read.updated':
            applyReadState(qc, event);
            break;
          case 'pins.changed':
            void qc.invalidateQueries({ queryKey: qk.pins });
            break;
          case 'presence.typing':
            useChatStore
              .getState()
              .setTyping(scopeKey(event.roomId, event.parentId), event.memberId, event.name);
            break;
          case 'presence.update':
            qc.setQueryData<PresenceEntry[]>(qk.presence, (old) => {
              if (!old) return old;
              const rest = old.filter((p) => p.memberId !== event.memberId);
              return event.status === 'offline'
                ? rest
                : [...rest, { memberId: event.memberId, status: event.status }];
            });
            break;
          case 'rooms.changed':
            void qc.invalidateQueries({ queryKey: qk.rooms });
            // Deleting a department's room clears departments.room_id.
            void qc.invalidateQueries({ queryKey: qk.departments });
            void qc.invalidateQueries({ queryKey: qk.mentions });
            void qc.invalidateQueries({ queryKey: ['room-members'] });
            break;
          case 'departments.changed':
            void qc.invalidateQueries({ queryKey: qk.departments });
            // Who belongs to which department lives on the member and agent rows.
            void qc.invalidateQueries({ queryKey: qk.members });
            void qc.invalidateQueries({ queryKey: qk.agents });
            void qc.invalidateQueries({ queryKey: qk.invites });
            void qc.invalidateQueries({ queryKey: qk.rooms });
            break;
          case 'tasks.changed':
            void qc.invalidateQueries({ queryKey: qk.tasks });
            void qc.invalidateQueries({ queryKey: qk.runSpans });
            break;
          case 'agents.changed':
            void qc.invalidateQueries({ queryKey: qk.agents });
            // Agent and computer counts drive the plan meters.
            void qc.invalidateQueries({ queryKey: qk.billing });
            break;
          case 'skills.changed':
            void qc.invalidateQueries({ queryKey: qk.skills });
            // Each agent lists the library with its own on/off flags.
            void qc.invalidateQueries({ queryKey: qk.agents });
            break;
          case 'computers.changed':
            void qc.invalidateQueries({ queryKey: qk.computers });
            void qc.invalidateQueries({ queryKey: qk.billing });
            break;
          case 'connections.changed':
            void qc.invalidateQueries({ queryKey: qk.connections });
            break;
          case 'dashboard.changed':
            void qc.invalidateQueries({ queryKey: qk.dashboard });
            break;
          case 'members.changed':
            void qc.invalidateQueries({ queryKey: qk.members });
            void qc.invalidateQueries({ queryKey: qk.invites });
            // The people lists (DMs, mentions) and my own role come from these.
            void qc.invalidateQueries({ queryKey: qk.rooms });
            void qc.invalidateQueries({ queryKey: qk.session });
            // Seats (members plus pending invites) are billed.
            void qc.invalidateQueries({ queryKey: qk.billing });
            break;
          case 'workspace.changed':
            void qc.invalidateQueries({ queryKey: qk.session });
            // Plan and subscription changes arrive as workspace changes.
            void qc.invalidateQueries({ queryKey: qk.billing });
            break;
          case 'notice':
            showToast({ text: event.text, agentId: event.agentId, taskId: event.taskId });
            break;
        }
      });
    });
    return () => {
      cancelled = true;
      clearTimeout(roomsTimer);
      offResync();
      off();
    };
  }, [qc, showToast, me]);
}
