import type { Agent, Member } from '@repo/shared';
import { useEffect, useRef, useState } from 'react';
import { AgentArt } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useT, type MessageKey } from '../../i18n';
import {
  applyMention,
  draftStorageKey,
  LONG_PASTE_CHARS,
  mentionQuery,
  readDraft,
  writeDraft,
} from './chat.logic';
import { useChatScope } from './chat-scope';

const KIND_KEY: Record<'agent' | 'member' | 'here', MessageKey> = {
  agent: 'chat.kind.agent',
  member: 'chat.kind.member',
  here: 'chat.composer.here',
};

interface Option {
  name: string;
  kind: 'agent' | 'member' | 'here';
  group: 'room' | 'workspace';
  agent?: Agent;
  member?: Member;
}

export interface SendExtra {
  threadTitle?: string;
  quoteMessageId?: string;
  quote?: import('@repo/shared').MessageQuote | null;
}

export function Composer({
  roomId,
  parentId = null,
  agents,
  members,
  others = [],
  onSend,
  disabledReason,
  placeholder,
  onTyping,
  notice,
  onDismissNotice,
  autoFocus = false,
  allowHere = false,
  allowNewThread = false,
  initialNewThread = false,
  openThreadSignal = 0,
}: {
  roomId?: string;
  parentId?: string | null;
  agents: Agent[];
  members: Member[];
  /** Workspace members who are not in this room. */
  others?: Member[];
  onSend: (text: string, extra?: SendExtra) => void;
  disabledReason?: string | null;
  placeholder?: string;
  onTyping?: () => void;
  notice?: string[];
  onDismissNotice?: () => void;
  autoFocus?: boolean;
  allowHere?: boolean;
  allowNewThread?: boolean;
  initialNewThread?: boolean;
  /** Bumps when the sidebar asks this composer to start a thread. */
  openThreadSignal?: number;
}) {
  const t = useT();
  const scope = useChatScope();
  const storageKey = roomId ? draftStorageKey(roomId, parentId) : null;
  const ref = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => (storageKey ? readDraft(storageKey) : ''));
  const [query, setQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [newThread, setNewThread] = useState(initialNewThread);
  const [seenRequest, setSeenRequest] = useState(openThreadSignal);
  const [title, setTitle] = useState('');
  const [longPaste, setLongPaste] = useState(false);

  if (allowNewThread && openThreadSignal !== seenRequest) {
    setSeenRequest(openThreadSignal);
    if (openThreadSignal > 0) setNewThread(true);
  }

  useEffect(() => {
    if (storageKey) writeDraft(storageKey, text);
  }, [storageKey, text]);

  useEffect(() => {
    const el = ref.current;
    if (el && text) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [text]);

  const roomOptions: Option[] = [
    ...(allowHere
      ? (['here', 'room'] as const).map((name) => ({
          name,
          kind: 'here' as const,
          group: 'room' as const,
        }))
      : []),
    ...agents.map((a) => ({
      name: a.name,
      kind: 'agent' as const,
      group: 'room' as const,
      agent: a,
    })),
    ...members.map((m) => ({
      name: m.name,
      kind: 'member' as const,
      group: 'room' as const,
      member: m,
    })),
  ];
  const workspaceOptions: Option[] = others.map((m) => ({
    name: m.name,
    kind: 'member' as const,
    group: 'workspace' as const,
    member: m,
  }));
  const q = query?.toLowerCase() ?? '';
  const match = (o: Option) => query !== null && o.name.toLowerCase().includes(q);
  const roomHits = query === null ? [] : roomOptions.filter(match);
  const workspaceHits = query === null ? [] : workspaceOptions.filter(match);
  const options = [...roomHits, ...workspaceHits];
  const open = options.length > 0;
  const active = Math.min(sel, Math.max(options.length - 1, 0));

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  const update = (el: HTMLTextAreaElement) => {
    if (el.value) onTyping?.();
    setText(el.value);
    setQuery(mentionQuery(el.value, el.selectionStart));
    setSel(0);
    resize(el);
  };
  const pick = (o: Option) => {
    const el = ref.current!;
    const next = applyMention(el.value, el.selectionStart, o.name);
    setText(next.text);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = next.caret;
    });
  };
  const send = () => {
    const v = text.trim();
    if (!v) return;
    const threadTitle = newThread ? title.trim() : '';
    if (newThread && !threadTitle) {
      titleRef.current?.focus();
      return;
    }
    onSend(v, {
      ...(threadTitle ? { threadTitle } : null),
      ...(scope?.quote ? { quoteMessageId: scope.quote.id, quote: scope.quote } : null),
    });
    setText('');
    setQuery(null);
    setTitle('');
    setNewThread(false);
    scope?.setQuote(null);
    if (ref.current) {
      ref.current.value = '';
      resize(ref.current);
    }
  };

  const groups = (
    [
      { id: 'room' as const, label: t('chat.composer.roomMembers'), items: roomHits },
      {
        id: 'workspace' as const,
        label: t('chat.composer.workspaceMembers'),
        items: workspaceHits,
      },
    ] as const
  ).filter((g) => g.items.length > 0);

  let cursor = 0;

  return (
    <div className="composer-wrap">
      {open && (
        <div className="mention-pop" role="listbox" aria-label={t('chat.mention')}>
          {groups.map((g) => (
            <div key={g.id}>
              <div className="h">{g.label}</div>
              {g.items.map((o) => {
                const i = cursor++;
                return (
                  <div
                    key={o.group + o.kind + o.name}
                    role="option"
                    aria-selected={i === active}
                    className={`opt ${i === active ? 'sel' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(o);
                    }}
                  >
                    {o.agent ? (
                      <div className="av">
                        <AgentArt variant={o.agent.avatar} />
                      </div>
                    ) : (
                      <div
                        className="av human"
                        style={o.member?.color ? { background: o.member.color } : undefined}
                      >
                        {o.kind === 'here' ? '@' : o.name[0]?.toLowerCase()}
                      </div>
                    )}
                    {o.kind === 'here' ? `@${o.name}` : o.name}
                    <small>{t(KIND_KEY[o.kind])}</small>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {!!notice?.length && (
        <div className="notice-line" role="status">
          <span>{notice.join(' ')}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('chat.dismiss')}
            onClick={onDismissNotice}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {longPaste && (
        <div className="notice-line" role="status">
          <span>{t('chat.composer.longPaste')}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('chat.dismiss')}
            onClick={() => setLongPaste(false)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {disabledReason && (
        <div className="err-line" style={{ margin: '0 0 8px' }}>
          {disabledReason}
        </div>
      )}
      {scope?.quote && (
        <div className="quote-chip">
          <span>
            {t('chat.composer.quoting', { name: scope.quote.authorName })}
            {scope.quote.excerpt ? ` — ${scope.quote.excerpt}` : ''}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('chat.composer.clearQuote')}
            onClick={() => scope.setQuote(null)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      <div className="composer">
        {allowNewThread && newThread && (
          <input
            ref={titleRef}
            className="thread-title-field"
            value={title}
            maxLength={120}
            placeholder={t('chat.composer.threadTitle')}
            aria-label={t('chat.composer.threadTitle')}
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                ref.current?.focus();
              }
            }}
          />
        )}
        <textarea
          ref={ref}
          rows={1}
          placeholder={placeholder ?? t('chat.composer.placeholder')}
          autoFocus={autoFocus}
          aria-label={t('chat.composer.label')}
          value={text}
          onChange={(e) => update(e.currentTarget)}
          onClick={(e) =>
            setQuery(mentionQuery(e.currentTarget.value, e.currentTarget.selectionStart))
          }
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (pasted.length > LONG_PASTE_CHARS) {
              e.preventDefault();
              setLongPaste(true);
            }
          }}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((active + 1) % options.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((active - 1 + options.length) % options.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(options[active]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setQuery(null);
                return;
              }
            }
            if (e.key === 'ArrowUp' && !text && scope) {
              e.preventDefault();
              scope.editLast();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="bar">
          <button className="icon-btn" title={t('chat.composer.attachSoon')} disabled>
            <Icon name="plus" />
          </button>
          {allowNewThread && (
            <button
              type="button"
              className={`chip-btn${newThread ? ' on' : ''}`}
              aria-pressed={newThread}
              onClick={() => setNewThread((v) => !v)}
            >
              <Icon name="thread" size={14} />
              {t('chat.composer.newThread')}
            </button>
          )}
          <span className="hint">
            {t('chat.composer.hintPrefix')}
            <code>@</code>
            {t('chat.composer.hintSuffix')}
          </span>
          <span className="sp" />
          <button
            className="icon-btn"
            title={t('chat.send')}
            aria-label={t('chat.send')}
            onClick={send}
          >
            <Icon name="send" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
