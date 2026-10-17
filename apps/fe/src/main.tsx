import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { setSessionExpiredHandler } from './lib/api-client';
import { clearTokens } from './lib/auth-tokens';
import { createQueryClient } from './lib/query-client';
import { createAppRouter } from './router';
import './stores/theme';
import './styles/app.css';

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

// A final 401 (refresh failed) ends the session: drop tokens + cache and go to the login screen.
const PUBLIC_PATHS = ['/login', '/register'];
setSessionExpiredHandler(() => {
  clearTokens();
  const path = router.state.location.pathname;
  if (PUBLIC_PATHS.includes(path)) return;
  void router.navigate({ to: '/login' }).then(() => queryClient.clear());
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App queryClient={queryClient} router={router} />
    </ErrorBoundary>
  </React.StrictMode>,
);
