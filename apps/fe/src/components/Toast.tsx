import { useNavigate } from '@tanstack/react-router';
import { usePeople } from '../features/workspace/workspace.api';
import { useUi } from '../stores/ui';
import { AgentAvatar } from './Avatar';
import { Inline } from './Markdown';

export function Toast() {
  const toast = useUi((s) => s.toast);
  const hide = useUi((s) => s.hideToast);
  const people = usePeople();
  const navigate = useNavigate();
  const agent = people.agent(toast?.agentId);
  return (
    <div className={`toast ${toast ? 'on' : ''}`} role="status" aria-live="polite">
      {toast && (
        <>
          {agent && <AgentAvatar agent={agent} />}
          <span>
            <Inline text={toast.text} />
          </span>
          {toast.taskId && (
            <button
              className="lnk"
              onClick={() => {
                hide();
                void navigate({
                  to: '/tasks',
                  search: (s) => ({ ...s, task: toast.taskId ?? undefined }),
                });
              }}
            >
              Xem
            </button>
          )}
        </>
      )}
    </div>
  );
}
