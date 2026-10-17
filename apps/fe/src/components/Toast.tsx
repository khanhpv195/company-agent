import { useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { usePeople } from '../features/workspace/workspace.api';
import { useUi } from '../stores/ui';
import { AgentAvatar } from './Avatar';
import { Inline } from './Markdown';

export function Toast() {
  const toast = useUi((s) => s.toast);
  const hide = useUi((s) => s.hideToast);
  const people = usePeople();
  const navigate = useNavigate();
  const t = useT();
  const agent = people.agent(toast?.agentId);
  return (
    <div
      className={`toast ${toast ? 'on' : ''} ${toast?.tone === 'error' ? 'err' : ''}`}
      role="status"
      aria-live="polite"
    >
      {toast && (
        <>
          {agent && <AgentAvatar agent={agent} />}
          <span>
            <Inline text={toast.text} />
          </span>
          {toast.action && (
            <button
              className="lnk"
              onClick={() => {
                hide();
                void navigate({ to: toast.action?.to });
              }}
            >
              {toast.action.label}
            </button>
          )}
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
              {t('common.view')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
