import { getRouteApi, Link, Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useT, type MessageKey } from '../../i18n';
import { useBilling } from '../billing/billing.api';
import { BillingSection } from '../billing/BillingSection';
import { useSession } from '../workspace/workspace.api';
import { AppearanceSection } from './AppearanceSection';
import { AuditSection } from './AuditSection';
import { DesktopSection } from './DesktopSection';
import { MembersSection } from './MembersSection';
import { ProfileSection } from './ProfileSection';
import { SecuritySection } from './SecuritySection';
import { TeamSection } from './TeamSection';
import { WorkspaceSection } from './WorkspaceSection';
import { sectionsFor, type SettingsGroup } from './settings.logic';

const route = getRouteApi('/_app/settings/$section');

const GROUPS: SettingsGroup[] = ['account', 'workspace', 'app'];

/** Section id -> screen. Team/workspace and billing plug their screens in here. */
const BODIES: Record<string, () => ReactNode> = {
  profile: () => <ProfileSection />,
  security: () => <SecuritySection />,
  appearance: () => <AppearanceSection />,
  workspace: () => <WorkspaceSection />,
  members: () => <MembersSection />,
  team: () => <TeamSection />,
  billing: () => <BillingSection />,
  audit: () => <AuditSection />,
  desktop: () => <DesktopSection />,
};

const LEADS: Partial<Record<string, MessageKey>> = {
  workspace: 'settings.workspace.lead',
  members: 'settings.members.lead',
  team: 'settings.team.lead',
  audit: 'settings.audit.lead',
};

export function SettingsPage() {
  const t = useT();
  const { section } = route.useParams();
  const session = useSession().data;
  const billing = useBilling();
  if (!session) return null;
  // Wait for the summary before deciding on /settings/billing (e.g. the return from Stripe).
  if (section === 'billing' && billing.isPending) return null;
  const allowed = sectionsFor(session.user.role, billing.data?.limitsEnabled === true);
  const current = allowed.find((s) => s.id === section);
  const body = current ? BODIES[current.id] : undefined;
  // Hand-typed or stale URLs (e.g. a member opening /settings/audit) land on the profile.
  if (!current || !body)
    return <Navigate to="/settings/$section" params={{ section: 'profile' }} replace />;
  const lead = LEADS[current.id];

  return (
    <>
      <aside className="panel" aria-label={t('settings.aria')}>
        <div className="panel-head drag" data-tauri-drag-region>
          <h3>{t('settings.title')}</h3>
        </div>
        <div className="panel-body">
          {GROUPS.map((group) => {
            const items = allowed.filter((s) => s.group === group);
            if (!items.length) return null;
            return (
              <div key={group} role="group" aria-label={t(`settings.groups.${group}`)}>
                <div className="set-group">{t(`settings.groups.${group}`)}</div>
                {items.map((s) => (
                  <Link
                    key={s.id}
                    to="/settings/$section"
                    params={{ section: s.id }}
                    className={`item ${section === s.id ? 'on' : ''}`}
                    style={{ alignItems: 'center' }}
                  >
                    <div className="meta">
                      <span className="name" style={{ fontWeight: 500 }}>
                        {t(`settings.sections.${s.id as 'profile'}`)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </aside>
      <main className="main">
        <div className="page">
          <h2>{t(`settings.sections.${current.id as 'profile'}`)}</h2>
          {lead && <p className="lead">{t(lead)}</p>}
          {body()}
        </div>
      </main>
    </>
  );
}
