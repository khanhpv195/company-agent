import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { AgentAvatar } from '../../components/Avatar';
import { DemoBadge } from '../../components/DemoBadge';
import { useT } from '../../i18n';
import { usePeople } from '../workspace/workspace.api';
import { agentsWithoutDm } from './chat.logic';
import { useOpenDm, useRooms } from './chat.api';

/**
 * Live agents that have no DM yet. Picking one opens the DM and navigates to it.
 * `focusTick` changes move focus to the first choice (used by the "+" button).
 */
export function StartDmList({ focusTick = 0 }: { focusTick?: number }) {
  const t = useT();
  const people = usePeople();
  const rooms = useRooms();
  const navigate = useNavigate();
  const openDm = useOpenDm();
  const ref = useRef<HTMLDivElement>(null);
  const candidates = agentsWithoutDm(people.agents, rooms);

  useEffect(() => {
    if (focusTick) ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [focusTick]);

  const start = (agentId: string) =>
    openDm.mutate(agentId, {
      onSuccess: ({ chatId }) => void navigate({ to: '/chat/$chatId', params: { chatId } }),
    });

  if (!candidates.length) return <div className="empty-line">{t('chat.noAgentsToChat')}</div>;

  return (
    <div ref={ref}>
      {candidates.map((a) => (
        <button
          key={a.id}
          type="button"
          className="item start-dm"
          disabled={openDm.isPending}
          onClick={() => start(a.id)}
        >
          <AgentAvatar agent={a} />
          <div className="meta">
            <div className="row">
              <span className="name">
                {a.name}
                {a.simulated && <DemoBadge />}
              </span>
            </div>
            <div className="prev">{t('chat.startConversation')}</div>
          </div>
        </button>
      ))}
      {openDm.error && <div className="err-line">{openDm.error.message}</div>}
    </div>
  );
}
