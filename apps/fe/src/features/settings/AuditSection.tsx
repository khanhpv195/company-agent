import { formatDateTime, useT } from '../../i18n';
import { ApiError } from '../../lib/api-client';
import { usePeople } from '../workspace/workspace.api';
import { useAuditEvents } from './settings.api';
import { auditActionLabel, auditTarget } from './settings.logic';

export function AuditSection() {
  const t = useT();
  const q = useAuditEvents();
  const people = usePeople();
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];

  if (q.isPending) return <div className="set-empty">{t('settings.audit.loading')}</div>;
  if (q.isError)
    return (
      <div className="err-line" role="alert">
        {q.error instanceof ApiError ? q.error.message : t('settings.audit.failed')}
      </div>
    );
  if (!events.length) return <div className="set-empty">{t('settings.audit.empty')}</div>;

  // Member and agent targets show the current name from the lists; anything else (or a
  // removed member/agent) falls back to the name in the event meta or a short id.
  const targetName = (e: (typeof events)[number]) => {
    if (e.targetId && e.targetType === 'member') {
      const m = people.member(e.targetId);
      if (m) return m.name;
    }
    if (e.targetId && e.targetType === 'agent') {
      const a = people.agent(e.targetId);
      if (a) return a.name;
    }
    return auditTarget(e);
  };

  return (
    <>
      <table className="audit-table">
        <thead>
          <tr>
            <th>{t('settings.audit.when')}</th>
            <th>{t('settings.audit.actor')}</th>
            <th>{t('settings.audit.action')}</th>
            <th>{t('settings.audit.target')}</th>
            <th>{t('settings.audit.ip')}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const label = auditActionLabel(e.action, t);
            return (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.at)}</td>
                <td>
                  {e.actor?.name ?? (
                    <span style={{ color: 'var(--muted)' }}>{t('settings.audit.system')}</span>
                  )}
                </td>
                <td title={e.action}>{label}</td>
                <td>{targetName(e)}</td>
                <td style={{ color: 'var(--muted)' }}>{e.ip ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {q.hasNextPage && (
        <div className="audit-more">
          <button
            className="btn"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? t('settings.audit.loading') : t('settings.audit.loadMore')}
          </button>
        </div>
      )}
    </>
  );
}
