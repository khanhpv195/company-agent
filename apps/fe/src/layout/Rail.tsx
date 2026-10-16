import { Link } from '@tanstack/react-router';
import { BrandMark } from '../components/ChannelLogo';
import { Icon, type IconName } from '../components/Icon';
import { useSession } from '../features/workspace/workspace.api';
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
  return (
    <nav className="rail" aria-label="Điều hướng chính">
      <div className="logo drag" data-tauri-drag-region>
        <BrandMark />
      </div>
      <Link to="/chat" className="ri" title="Tin nhắn mới" aria-label="Tin nhắn mới">
        <Icon name="pen" />
      </Link>
      <button
        className="ri"
        title="Tìm kiếm (⌘K)"
        aria-label="Tìm kiếm"
        onClick={() => openPalette(true)}
      >
        <Icon name="search" />
      </button>
      <hr />
      <NavIcon to="/" icon="dash" label="Dashboard" exact />
      <NavIcon to="/tasks" icon="kanban" label="Tasks" />
      <NavIcon to="/chat" icon="chat" label="Chat" />
      <NavIcon to="/people" icon="users" label="People & Agents" />
      <div className="spacer drag" data-tauri-drag-region />
      <NavIcon to="/connections" icon="plug" label="Connections" />
      <NavIcon to="/computers" icon="monitor" label="Computers" />
      <NavIcon to="/settings" icon="sliders" label="Settings" />
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
