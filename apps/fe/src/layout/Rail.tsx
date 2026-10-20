import { Link } from '@tanstack/react-router';
import { BrandMark } from '../components/ChannelLogo';
import { Icon, type IconName } from '../components/Icon';
import { useSession } from '../features/workspace/workspace.api';
import { useT } from '../i18n';
import { useUi } from '../stores/ui';

function NavIcon({
  to,
  icon,
  label,
  exact,
}: {
  to: string;
  icon: IconName;
  label: string;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      className="ri"
      title={label}
      aria-label={label}
      activeProps={{ className: 'ri on' }}
      activeOptions={{ exact: !!exact, includeSearch: false }}
    >
      <Icon name={icon} />
    </Link>
  );
}

export function Rail() {
  const session = useSession().data;
  const openPalette = useUi((s) => s.setPaletteOpen);
  const t = useT();
  return (
    <nav className="rail" aria-label={t('rail.aria')}>
      <div className="logo drag" data-tauri-drag-region>
        <BrandMark />
      </div>
      <Link
        to="/chat"
        className="ri"
        title={t('rail.newMessage')}
        aria-label={t('rail.newMessage')}
      >
        <Icon name="pen" />
      </Link>
      <button
        className="ri"
        title={t('rail.searchTip')}
        aria-label={t('rail.search')}
        onClick={() => openPalette(true)}
      >
        <Icon name="search" />
      </button>
      <hr />
      <NavIcon to="/" icon="dash" label={t('rail.dashboard')} exact />
      <NavIcon to="/tasks" icon="kanban" label={t('rail.tasks')} />
      <NavIcon to="/chat" icon="chat" label={t('rail.chat')} />
      <NavIcon to="/people" icon="users" label={t('rail.people')} />
      <NavIcon to="/skills" icon="sparkles" label={t('rail.skills')} />
      <div className="spacer drag" data-tauri-drag-region />
      <NavIcon to="/connections" icon="plug" label={t('rail.connections')} />
      <NavIcon to="/computers" icon="monitor" label={t('rail.computers')} />
      <NavIcon to="/settings" icon="sliders" label={t('rail.settings')} />
      <Link
        to="/settings/$section"
        params={{ section: 'profile' }}
        className="me"
        title={session?.user.name}
      >
        {session?.user.name[0].toLowerCase() ?? '·'}
      </Link>
    </nav>
  );
}
