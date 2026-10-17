import { Link } from '@tanstack/react-router';
import { DemoBadge } from '../../components/DemoBadge';
import type { Message } from '@repo/shared';
import { AgentAvatar, MemberAvatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Markdown } from '../../components/Markdown';
import { hhmm, usd } from '../../lib/format';
import { useT, type MessageKey } from '../../i18n';
import { useComputers, usePeople } from '../workspace/workspace.api';
import { useSendDraft } from './chat.api';

const CHANNEL: Record<string, { name: string; color: string }> = {
  zalo: { name: 'Zalo', color: '#0068ff' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  gmail: { name: 'Google', color: '#ea4335' },
};

type AssignmentStatus = NonNullable<Message['assignment']>['status'];
const ASSIGNMENT_STATUS: Record<AssignmentStatus, MessageKey> = {
  pending: 'chat.assignmentStatus.pending',
  offered: 'chat.assignmentStatus.offered',
  claimed: 'chat.assignmentStatus.claimed',
  running: 'chat.assignmentStatus.running',
  completed: 'chat.assignmentStatus.completed',
  failed: 'chat.assignmentStatus.failed',
  expired: 'chat.assignmentStatus.expired',
  cancelled: 'chat.assignmentStatus.cancelled',
};

interface MessageItemProps {
  message: Message;
  /** DM room: own messages align right, the other side keeps the avatar and name. */
  dm?: boolean;
  /** Session member id, used to tell own messages apart in a DM. */
  me?: string;
  /** Same author as the previous message in a DM: the avatar and name are shown once. */
  grouped?: boolean;
}

export function MessageItem({ message: m, dm = false, me, grouped = false }: MessageItemProps) {
  const t = useT();
  const people = usePeople();
  const computers = useComputers();
  const sendDraft = useSendDraft();
  const a = m.author;
  const agent = a.kind === 'agent' ? people.agent(a.id) : undefined;
  const member = a.kind === 'human' ? people.member(a.id) : undefined;
  const as = m.assignment;
  const streaming = m.status === 'streaming';
  const hasRealComputer = computers.some((c) => !c.simulated && !c.revokedAt);
  const mine = dm && a.kind === 'human' && a.id === me;

  let avatar;
  let name;
  if (a.kind === 'external') {
    const ch = CHANNEL[a.connectionId];
    avatar = (
      <span className="av" style={{ background: ch?.color }}>
        {a.name[0]}
      </span>
    );
    name = (
      <>
        {a.name}{' '}
        <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
          {t('chat.via', { channel: ch?.name ?? '' })}
        </span>
      </>
    );
  } else if (agent) {
    avatar = <AgentAvatar agent={agent} />;
    name = agent.name;
  } else {
    avatar = member ? <MemberAvatar member={member} /> : <span className="av human">?</span>;
    name = member?.name ?? t('chat.unknown');
  }

  return (
    <div
      className={`msg ${agent ? 'agent' : 'human'}${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}
    >
      {!mine && (grouped ? <span className="av-ghost" aria-hidden="true" /> : avatar)}
      <div className="msg-body">
        {!mine && !grouped && (
          <div className="who">
            {name}
            {agent && <span className="spark">✳</span>}
          </div>
        )}
        {as && (
          <div
            className={`assign ${as.status === 'completed' ? 'completed' : as.status === 'failed' || as.status === 'expired' ? 'failed' : ''}`}
          >
            {as.status === 'completed' ? (
              <span style={{ color: 'var(--ok)', display: 'flex' }}>
                <Icon name="check" size={13} />
              </span>
            ) : as.status === 'failed' || as.status === 'expired' ? (
              <span style={{ color: 'var(--err)', display: 'flex' }}>
                <Icon name="x" size={13} />
              </span>
            ) : (
              <div className="mini-spin" />
            )}
            <span>{t('chat.assignment')}</span>
            <span className="st">{t(ASSIGNMENT_STATUS[as.status])}</span>
            {as.status === 'completed' && (
              <span style={{ color: 'var(--muted)' }}>
                {t('chat.assignmentStats', { calls: as.toolCalls.length, turns: as.turns })}
                {as.costUsd != null && ` · ${usd(as.costUsd)}`}
              </span>
            )}
          </div>
        )}
        {as?.toolCalls.map((call) => (
          <details key={call.id} className="tool">
            <summary>
              <Icon name={call.name === 'Bash' ? 'terminal' : 'file'} size={15} />
              <span className="nm">{call.name}</span>
              <span className="arg">{call.input}</span>
              <span className="r">
                {call.status === 'running' ? (
                  <div className="mini-spin" />
                ) : (
                  <span
                    style={{
                      color: call.status === 'ok' ? 'var(--ok)' : 'var(--err)',
                      display: 'flex',
                    }}
                  >
                    <Icon name={call.status === 'ok' ? 'check' : 'x'} size={14} />
                  </span>
                )}
              </span>
            </summary>
            {call.output && <pre>{call.output}</pre>}
          </details>
        ))}
        {as?.error && <div className="err-line">{as.error}</div>}
        {(m.markdown || !as) && (
          <div className="bubble">
            <Markdown text={m.markdown}>{streaming && <span className="caret" />}</Markdown>
          </div>
        )}
        {mine && (
          <time className="msg-time" dateTime={m.createdAt}>
            {hhmm(Date.parse(m.createdAt))}
          </time>
        )}
        {agent?.simulated && !streaming && m.markdown && (
          <div className="demo-cta">
            <DemoBadge />
            {!hasRealComputer && (
              <Link to="/computers" className="btn sm">
                {t('billing.connectComputer')}
              </Link>
            )}
          </div>
        )}
        {m.draft &&
          (m.draft.state === 'pending' ? (
            <div className="draft">
              <Icon name="clock" size={13} /> {t('chat.draft.pending')}
              <button
                className="btn sm primary"
                disabled={sendDraft.isPending}
                onClick={() => sendDraft.mutate(m.id)}
              >
                {t('chat.draft.send')}
              </button>
              <button className="btn sm">{t('chat.draft.edit')}</button>
            </div>
          ) : (
            <div className="draft sent">
              ✓ {t('chat.draft.sent', { channel: CHANNEL[m.draft.connectionId]?.name ?? '' })}
            </div>
          ))}
      </div>
    </div>
  );
}
