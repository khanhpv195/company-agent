import type { Agent, Member } from '@repo/shared';
import { useRef, useState } from 'react';
import { AgentArt } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { applyMention, mentionQuery } from './chat.logic';

interface Option {
  name: string;
  kind: 'agent' | 'member';
  agent?: Agent;
  member?: Member;
}

export function Composer({
  agents,
  members,
  onSend,
  disabledReason,
}: {
  agents: Agent[];
  members: Member[];
  onSend: (text: string) => void;
  disabledReason?: string | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);

  const options: Option[] =
    query === null
      ? []
      : [
          ...agents.map((a) => ({ name: a.name, kind: 'agent' as const, agent: a })),
          ...members.map((m) => ({ name: m.name, kind: 'member' as const, member: m })),
        ].filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));
  const open = options.length > 0;
  const active = Math.min(sel, options.length - 1);

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  const update = (el: HTMLTextAreaElement) => {
    setText(el.value);
    setQuery(mentionQuery(el.value, el.selectionStart));
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
    onSend(v);
    setText('');
    setQuery(null);
    if (ref.current) {
      ref.current.value = '';
      resize(ref.current);
    }
  };

  return (
    <div className="composer-wrap">
      {open && (
        <div className="mention-pop" role="listbox" aria-label="Mention">
          <div className="h">Mention</div>
          {options.map((o, i) => (
            <div
              key={o.kind + o.name}
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
                  {o.name[0].toLowerCase()}
                </div>
              )}
              {o.name}
              <small>{o.kind}</small>
            </div>
          ))}
        </div>
      )}
      {disabledReason && (
        <div className="err-line" style={{ margin: '0 0 8px' }}>
          {disabledReason}
        </div>
      )}
      <div className="composer">
        <textarea
          ref={ref}
          rows={1}
          placeholder="Message…"
          aria-label="Tin nhắn"
          value={text}
          onChange={(e) => update(e.currentTarget)}
          onClick={(e) =>
            setQuery(mentionQuery(e.currentTarget.value, e.currentTarget.selectionStart))
          }
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown')
                return (e.preventDefault(), setSel((active + 1) % options.length));
              if (e.key === 'ArrowUp')
                return (e.preventDefault(), setSel((active - 1 + options.length) % options.length));
              if (e.key === 'Enter' || e.key === 'Tab')
                return (e.preventDefault(), pick(options[active]));
              if (e.key === 'Escape') return setQuery(null);
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="bar">
          <button className="icon-btn" title="Đính kèm (sắp có)" disabled>
            <Icon name="plus" />
          </button>
          <span className="hint">
            Gõ <code>@</code> để gọi agent · Enter để gửi
          </span>
          <span className="sp" />
          <button className="icon-btn" title="Gửi" aria-label="Gửi" onClick={send}>
            <Icon name="send" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
