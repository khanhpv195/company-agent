import type { QueryClient } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { ApiError } from './lib/api-client';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { InvitePage } from './features/auth/InvitePage';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage';
import { OnboardingPage } from './features/auth/OnboardingPage';
import { ChatLayout } from './features/chat/ChatLayout';
import { ChatEmpty, RoomView } from './features/chat/RoomView';
import { ComputersPage } from './features/computers/ComputersPage';
import { ConnectionsPage } from './features/connections/ConnectionsPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { AgentPage } from './features/people/AgentPage';
import { MemberPage } from './features/people/MemberPage';
import { PeopleLayout } from './features/people/PeopleLayout';
import { SkillPage } from './features/skills/SkillPage';
import { SkillsPage } from './features/skills/SkillsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TasksPage, type TasksView } from './features/tasks/TasksPage';
import { agentsQuery, sessionQuery } from './features/workspace/workspace.api';
import { AppShell } from './layout/AppShell';
import { ErrorScreen, NotFoundScreen } from './components/ErrorScreens';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });

const session = (qc: QueryClient) => qc.ensureQueryData(sessionQuery).catch(() => null);

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});

const tokenSearch = (s: Record<string, unknown>): { token?: string } => ({
  token: typeof s.token === 'string' && s.token ? s.token : undefined,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: tokenSearch,
  component: ResetPasswordPage,
});

/** Public: an invitee has no account yet. */
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite',
  validateSearch: tokenSearch,
  component: InvitePage,
});

/** Public: the emailed link has to work signed in or out. */
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  validateSearch: tokenSearch,
  component: VerifyEmailPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: async ({ context }) => {
    if (!(await session(context.queryClient))) throw redirect({ to: '/login' });
  },
  component: OnboardingPage,
});

/** Everything behind login + onboarding. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  beforeLoad: async ({ context }) => {
    const s = await session(context.queryClient);
    if (!s) throw redirect({ to: '/login' });
    if (!s.onboarded) throw redirect({ to: '/onboarding' });
  },
  component: AppShell,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: DashboardPage,
});

const VIEWS: TasksView[] = ['board', 'list', 'agents'];
const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks',
  validateSearch: (s: Record<string, unknown>): { view?: TasksView; task?: string } => ({
    view: VIEWS.includes(s.view as TasksView) ? (s.view as TasksView) : undefined,
    task: typeof s.task === 'string' ? s.task : undefined,
  }),
  component: TasksPage,
});

const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/chat',
  component: ChatLayout,
});
const chatIndexRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '/',
  component: ChatEmpty,
});
export interface ChatSearch {
  /** Root message id of the thread shown in the side panel. */
  thread?: string;
  /** Message to scroll to and highlight. */
  message?: string;
}
const chatRoomRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '$roomId',
  validateSearch: (s: Record<string, unknown>): ChatSearch => ({
    thread: typeof s.thread === 'string' && s.thread ? s.thread : undefined,
    message: typeof s.message === 'string' && s.message ? s.message : undefined,
  }),
  component: RoomView,
});

const peopleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people',
  component: PeopleLayout,
});
const peopleIndexRoute = createRoute({
  getParentRoute: () => peopleRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    // fetchQuery (not ensureQueryData) so a stale cache cannot pick an agent that no longer exists.
    const agents = await context.queryClient
      .fetchQuery({ ...agentsQuery, staleTime: 5_000 })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) throw error;
        return [];
      });
    const first = agents[0];
    if (!first) throw redirect({ to: '/computers' });
    throw redirect({ to: '/people/agents/$agentId', params: { agentId: first.id } });
  },
});
const agentRoute = createRoute({
  getParentRoute: () => peopleRoute,
  path: 'agents/$agentId',
  validateSearch: (s: Record<string, unknown>): { tab?: 'Persona' | 'Skills' | 'Activity' } => ({
    tab: ['Persona', 'Skills', 'Activity'].includes(s.tab as string)
      ? (s.tab as 'Persona')
      : undefined,
  }),
  component: AgentPage,
});
const memberRoute = createRoute({
  getParentRoute: () => peopleRoute,
  path: 'members/$memberId',
  component: MemberPage,
});

const skillsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/skills',
  component: SkillsPage,
});
const skillRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/skills/$skillId',
  component: SkillPage,
});

const computersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/computers',
  validateSearch: (s: Record<string, unknown>): { focus?: string } => ({
    focus: typeof s.focus === 'string' ? s.focus : undefined,
  }),
  component: ComputersPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, '') === '/settings')
      throw redirect({ to: '/settings/$section', params: { section: 'profile' } });
  },
});
const settingsSectionRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '$section',
  validateSearch: (s: Record<string, unknown>): { checkout?: 'success' | 'cancel' } => ({
    checkout: s.checkout === 'success' || s.checkout === 'cancel' ? s.checkout : undefined,
  }),
  component: SettingsPage,
});

const connectionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/connections',
  component: ConnectionsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  inviteRoute,
  verifyEmailRoute,
  onboardingRoute,
  appRoute.addChildren([
    dashboardRoute,
    tasksRoute,
    chatRoute.addChildren([chatIndexRoute, chatRoomRoute]),
    peopleRoute.addChildren([peopleIndexRoute, agentRoute, memberRoute]),
    skillsRoute,
    skillRoute,
    computersRoute,
    settingsRoute.addChildren([settingsSectionRoute]),
    connectionsRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    // Hash URLs work the same under Vite and the packaged Tauri app.
    history: createHashHistory(),
    context: { queryClient },
    defaultPreload: 'intent',
    defaultErrorComponent: ({ error }) => <ErrorScreen error={error} />,
    defaultNotFoundComponent: NotFoundScreen,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
