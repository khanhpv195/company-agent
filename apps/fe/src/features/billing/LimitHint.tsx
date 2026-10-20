import { Link } from '@tanstack/react-router';
import { useT } from '../../i18n';
import { useSession } from '../workspace/workspace.api';
import type { LimitGuard } from './billing.api';

/** Visible hint beside a limit-disabled "add" button. Owners and admins get an upgrade link. */
export function LimitHint({ guard }: { guard: LimitGuard }) {
  const t = useT();
  const role = useSession().data?.user.role;
  // `blocked` is never set when the server runs without plan limits, so no plan UI shows.
  if (!guard.blocked) return null;
  const canUpgrade = role === 'owner' || role === 'admin';
  return (
    <span className="limit-hint">
      {t('billing.limitReached')}
      {canUpgrade && (
        <Link to="/settings/$section" params={{ section: 'billing' }}>
          {t('billing.upgrade')}
        </Link>
      )}
    </span>
  );
}
