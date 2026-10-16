import type { Message } from '@repo/shared';
import { AgentAvatar, MemberAvatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Markdown } from '../../components/Markdown';
import { usePeople } from '../workspace/workspace.api';
import { useSendDraft } from './chat.api';

const CHANNEL: Record<string, { name: string; color: string }> = {
  zalo: { name: 'Zalo', color: '#0068ff' },
  facebook: { name: 'Facebook', color: '#1877f2' },
  gmail: { name: 'Google', color: '#ea4335' },
};

export function MessageItem({ message: m }: { message: Message }) {
  const people = usePeople();
  const sendDraft = useSendDraft();
  const a = m.author;
  const agent = a.kind === 'agent' ? people.agent(a.id) : undefined;
  const member = a.kind === 'human' ? people.member(a.id) : undefined;
  const as = m.assignment;
  const streaming = m.status === 'streaming';

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
        {a.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>qua {ch?.name}</span>
      </>
    );
  } else if (agent) {
    avatar = <AgentAvatar agent={agent} />;
    name = agent.name;
  } else {
    avatar = member ? <MemberAvatar member={member} /> : <span className="av human">?</span>;
    name = member?.name ?? 'Unknown';
  }

  return (
    <div className={`msg ${agent ? 'agent' : 'human'}`}>
      {avatar}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="who">
          {name}
          {agent && <span className="spark">✳</span>}
        </div>
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
            <span>assignment</span>
            <span className="st">{as.status}</span>
            {as.status === 'completed' && (
              <span style={{ color: 'var(--muted)' }}>
                · {as.toolCalls.length} tool calls · {as.turns} turns
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
        {m.draft &&
          (m.draft.state === 'pending' ? (
            <div className="draft">
              <Icon name="clock" size={13} /> Nháp chờ duyệt
              <button
                className="btn sm primary"
                disabled={sendDraft.isPending}
                onClick={() => sendDraft.mutate(m.id)}
              >
                Gửi
              </button>
              <button className="btn sm">Sửa</button>
            </div>
          ) : (
            <div className="draft sent">✓ Đã gửi qua {CHANNEL[m.draft.connectionId]?.name}</div>
          ))}
      </div>
    </div>
  );
}
