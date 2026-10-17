import type { Message } from '@repo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useUi } from '../stores/ui';
import { qk } from './query-keys';
import { connectRealtime } from './realtime';

/** Applies server push events to the TanStack Query cache. */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);

  useEffect(() => {
    let off = () => {};
    let cancelled = false;
    void connectRealtime().then((client) => {
      if (cancelled) return;
      off = client.subscribe((event) => {
        switch (event.type) {
          case 'message.upserted': {
            const m = event.message;
            qc.setQueryData<Message[]>(qk.messages(m.chatId), (old) => {
              if (!old) return old;
              const i = old.findIndex((x) => x.id === m.id);
              if (i < 0) return [...old, m];
              const next = old.slice();
              next[i] = m;
              return next;
            });
            break;
          }
          case 'rooms.changed':
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
      off();
    };
  }, [qc, showToast]);
}
