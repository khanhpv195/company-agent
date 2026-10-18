import type { Message } from '@repo/shared';
import { AgentAvatar, MemberAvatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { rel, usd } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { usePeople } from '../workspace/workspace.api';
import { useStopAgent, useToggleReaction } from './chat.api';
import { useChatScope } from './chat-scope';
import { agentRunning, workedFor } from './chat.logic';

/** Small avatar of a member or agent id (a deleted agent shows a plain dot). */
export function ParticipantAvatar({ id, size = 20 }: { id: string; size?: number }) {
  const people = usePeople();
  const agent = people.agent(id);
  if (agent) return <AgentAvatar agent={agent} size={size} />;
  const member = people.member(id);
  if (member) return <MemberAvatar member={member} size={size} />;
  return <span className="av human" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** "N replies · last reply 3 min ago" under a root; opens the thread panel. */
export function ThreadSummary({
  message,
  onOpen,
}: {
  message: Message;
  onOpen: (rootId: string) => void;
}) {
  const t = useT();
  const now = useNow();
  const th = message.thread;
  if (!th) return null;
  const count = th.replyCount;
  return (
    <button type="button" className="thread-sum" onClick={() => onOpen(message.id)}>
      <span className="avs">
        {th.participantIds.slice(0, 5).map((id) => (
          <ParticipantAvatar key={id} id={id} size={20} />
        ))}
      </span>
      {th.title && <b className="ttl">{th.title}</b>}
      <span className="cnt">
        {count > 0 ? t('chat.thread.replies', { n: count }) : t('chat.thread.reply')}
      </span>
      {th.lastReplyAt && count > 0 && (
        <span className="last">
          {t('chat.thread.lastReply', { when: rel(th.lastReplyAt, now) })}
        </span>
      )}
    </button>
  );
}

/** Emoji chips under a message; clicking one toggles the caller's reaction. */
export function ReactionsRow({ message, roomId }: { message: Message; roomId: string }) {
  const t = useT();
  const people = usePeople();
  const toggle = useToggleReaction(roomId);
  const list = message.reactions ?? [];
  if (!list.length) return null;
  return (
    <div className="reactions" role="group" aria-label={t('chat.reactions')}>
      {list.map((r) => {
        const names = r.memberIds.map((id) => people.name(id)).join(', ');
        const more = r.count - r.memberIds.length;
        return (
          <button
            key={r.key}
            type="button"
            className={`react${r.mine ? ' mine' : ''}`}
            aria-pressed={!!r.mine}
            title={more > 0 ? `${names} +${more}` : names}
            disabled={toggle.isPending || message.id.startsWith('local-')}
            onClick={() => toggle.mutate({ message, key: r.key })}
          >
            <span aria-hidden="true">{r.key}</span>
            <span className="n">{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Live phase, stop, tool steps and cost of an agent reply. */
export function TurnCard({ message: m, roomId }: { message: Message; roomId: string }) {
  const t = useT();
  const scope = useChatScope();
  const stop = useStopAgent(roomId);
  const as = m.assignment;
  const running = agentRunning(m);
  const steps = as?.toolCalls.length ?? 0;
  const failed = m.phase === 'failed' || m.status === 'failed' || as?.status === 'failed';
  if (!as && !m.phase) return null;

  const phase =
    m.phase === 'queued'
      ? t('chat.phase.queued')
      : m.phase === 'thinking'
        ? t('chat.phase.thinking')
        : m.phase === 'tool'
          ? t('chat.phase.tool', { name: m.activeTool ?? '…' })
          : m.phase === 'writing'
            ? t('chat.phase.writing')
            : m.phase === 'failed' || failed
              ? t('chat.phase.failed')
              : null;

  return (
    <div className={`turn${failed ? ' failed' : ''}`}>
      {(phase || running) && (
        <div className="turn-line">
          {running && <div className="mini-spin" />}
          {phase && <span>{phase}</span>}
          {running && (
            <button
              type="button"
              className="btn sm"
              disabled={stop.isPending}
              onClick={() => stop.mutate(m.id)}
            >
              <Icon name="stop" size={12} /> {t('chat.actions.stop')}
            </button>
          )}
        </div>
      )}
      {steps > 0 && (
        <details className="turn-steps">
          <summary>
            {t('chat.phase.process', { n: steps })}
            {m.workedMs != null && ` · ${t('chat.phase.worked', { time: workedFor(m.workedMs) })}`}
          </summary>
          {as?.toolCalls.map((call) => (
            <div key={call.id} className="turn-step">
              <Icon name={call.name === 'Bash' ? 'terminal' : 'file'} size={14} />
              <span className="nm">{call.name}</span>
              <span className="arg">{call.input}</span>
            </div>
          ))}
        </details>
      )}
      {as?.status === 'completed' && as.costUsd != null && (
        <div className="turn-cost">{t('chat.phase.cost', { cost: usd(as.costUsd) })}</div>
      )}
      {(as?.error || failed) && (
        <div className="err-line">{as?.error || t('chat.phase.failed')}</div>
      )}
      {failed && scope && (
        <button type="button" className="btn sm" onClick={() => scope.retryAgent(m)}>
          {t('chat.phase.retry')}
        </button>
      )}
    </div>
  );
}
