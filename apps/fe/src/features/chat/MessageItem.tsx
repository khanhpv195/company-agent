import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { DemoBadge } from '../../components/DemoBadge';
import { AgentAvatar, MemberAvatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Markdown } from '../../components/Markdown';
import { formatDateTime } from '../../i18n';
import { hhmm } from '../../lib/format';
import { useT } from '../../i18n';
import type { LocalMessage } from '../../stores/chat';
import { useComputers, usePeople } from '../workspace/workspace.api';
import { useSendDraft } from './chat.api';
import { useChatScope } from './chat-scope';
import { MessageActions } from './MessageActions';
import { ReactionsRow, ThreadSummary, TurnCard } from './MessageParts';

const CHANNEL: Record<string, { name: string; color: string }> = {
  zalo: { name: 'Zalo', color: '#0068ff' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  gmail: { name: 'Google', color: '#ea4335' },
};

export interface MessageItemProps {
  message: LocalMessage;
  roomId: string;
  /** DM room: own messages align right, the other side keeps the avatar and name. */
  dm?: boolean;
  /** Session member id, used to tell own messages apart in a DM. */
  me?: string;
  /** Same author within 5 minutes as the previous message: avatar, name and time show once. */
  grouped?: boolean;
  /** Shown inside the thread panel: no thread summary, no "reply in thread". */
  inThread?: boolean;
  highlighted?: boolean;
  onOpenThread?: (rootId: string) => void;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
  /** Extension point for the hover action bar (C4: reactions picker, quote, more menu). */
  actions?: ReactNode;
}

export function MessageItem({
  message: m,
  roomId,
  dm = false,
  me,
  grouped = false,
  inThread = false,
  highlighted = false,
  onOpenThread,
  onRetry,
  onDiscard,
  actions,
}: MessageItemProps) {
  const t = useT();
  const scope = useChatScope();
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
  const time = hhmm(Date.parse(m.createdAt));
  const fullDate = formatDateTime(m.createdAt);
  const canThread = !!onOpenThread && !inThread && !m.deleted && !m.local;
  const editing = scope?.editingId === m.id;

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
      data-mid={m.id}
      className={`msg ${agent ? 'agent' : 'human'}${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}${m.local === 'sending' ? ' sending' : ''}${highlighted ? ' hl' : ''}`}
    >
      {!mine &&
        (grouped ? (
          <span className="av-ghost">
            <time className="hover-time" dateTime={m.createdAt} title={fullDate}>
              {time}
            </time>
          </span>
        ) : (
          avatar
        ))}
      <div className="msg-body">
        {!mine && !grouped && (
          <div className="who">
            {name}
            {agent && <span className="spark">✳</span>}
            <time className="t" dateTime={m.createdAt} title={fullDate}>
              {time}
            </time>
          </div>
        )}
        {m.quote && (
          <blockquote className="msg-quote">
            <b>{m.quote.authorName}</b>
            <span>{m.quote.excerpt || t('chat.deleted')}</span>
          </blockquote>
        )}
        {!m.deleted && (m.phase || as) && <TurnCard message={m} roomId={roomId} />}
        {m.deleted ? (
          <div className="msg-deleted">{t('chat.deleted')}</div>
        ) : editing && scope ? (
          <EditBox
            initial={m.markdown}
            error={scope.editError}
            onCancel={scope.cancelEdit}
            onSave={(text) => void scope.saveEdit(m.id, text)}
          />
        ) : (
          (m.markdown || !as) && (
            <div className="bubble">
              <Markdown text={m.markdown}>{streaming && <span className="caret" />}</Markdown>
            </div>
          )
        )}
        {!m.deleted && (m.editedAt || m.status === 'stopped') && (
          <div className="msg-flags">
            {m.editedAt && <span title={formatDateTime(m.editedAt)}>{t('chat.edited')}</span>}
            {m.status === 'stopped' && <span className="stopped">{t('chat.stopped')}</span>}
          </div>
        )}
        {m.local === 'failed' && (
          <div className="send-failed" role="alert">
            <span>{m.localError || t('chat.sendFailed')}</span>
            <button
              type="button"
              className="btn sm"
              onClick={() => m.clientMessageId && onRetry?.(m.clientMessageId)}
            >
              {t('chat.retry')}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => m.clientMessageId && onDiscard?.(m.clientMessageId)}
            >
              {t('chat.discard')}
            </button>
          </div>
        )}
        {mine && !m.local && (
          <time className="msg-time" dateTime={m.createdAt} title={fullDate}>
            {time}
          </time>
        )}
        {!m.deleted && !m.local && <ReactionsRow message={m} roomId={roomId} />}
        {canThread && m.thread && <ThreadSummary message={m} onOpen={onOpenThread} />}
        {agent?.simulated && !streaming && m.markdown && !m.deleted && (
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
      {!m.local && !m.deleted && (
        <>
          <MessageActions message={m} canThread={canThread} onOpenThread={onOpenThread} />
          {actions}
        </>
      )}
    </div>
  );
}

function EditBox({
  initial,
  error,
  onCancel,
  onSave,
}: {
  initial: string;
  error?: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  return (
    <form
      className="msg-edit"
      onSubmit={(e) => {
        e.preventDefault();
        const next = text.trim();
        if (next && next !== initial) onSave(next);
        else onCancel();
      }}
    >
      <textarea
        value={text}
        autoFocus
        aria-label={t('chat.actions.edit')}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {error && <div className="err-line">{error}</div>}
      <div className="msg-edit-bar">
        <button type="button" className="btn sm" onClick={onCancel}>
          {t('chat.actions.cancel')}
        </button>
        <button type="submit" className="btn sm primary">
          {t('chat.actions.save')}
        </button>
      </div>
    </form>
  );
}
