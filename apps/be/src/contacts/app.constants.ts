export const API_PREFIX = 'api';
export const DEFAULT_API_VERSION = '1';
export const SWAGGER_PATH = 'docs';
export const STATIC_SERVE_ROOT = '/static';

export const DEFAULT_CORS_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:1420',
];

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

export const RESPONSE_MESSAGE_KEY = 'app:response_message';
export const RAW_RESPONSE_KEY = 'app:raw_response';
export const IS_PUBLIC_KEY = 'app:is_public';
export const ROLES_KEY = 'app:roles';

export const DEFAULT_SUCCESS_MESSAGE = 'common.SUCCESS';

/** A computer without a heartbeat for this long is marked offline. */
export const HEARTBEAT_TIMEOUT_MS = 15_000;
/** How long a claimed/running assignment stays valid without a heartbeat. */
export const LEASE_MS = 30_000;
export const RECONCILE_INTERVAL_MS = 5_000;
export const SIMULATOR_HEARTBEAT_MS = 3_000;
/** The simulated runner claims offered task runs and advances one running task this often. */
export const SIMULATOR_TASK_TICK_MS = 2_600;
/** The simulated computer reports "connected" only this long after it was created. */
export const SIMULATED_CONNECT_DELAY_MS = 2_600;
export const AGENT_ACTIVITY_LIMIT = 50;

/**
 * Timezone in which the dashboard cuts days ("today", the 14-day chart). One constant for
 * every workspace for now; it becomes a workspace setting when workspaces get a timezone.
 */
export const WORKSPACE_TIMEZONE = 'Asia/Ho_Chi_Minh';
/** Days (oldest first, today last) of the dashboard chart. */
export const DASHBOARD_DAYS = 14;
/** Items of the dashboard activity feed. */
export const DASHBOARD_FEED_LIMIT = 8;
/** Older feed rows are pruned past this many per workspace. */
export const FEED_KEEP = 100;
/** The simulated OAuth round trip of `POST /connections/:id/authorize`. */
export const AUTHORIZE_DELAY_MS = 1500;
