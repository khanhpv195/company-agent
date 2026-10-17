import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { setSessionExpiredHandler } from './lib/api-client';
import { clearTokens } from './lib/auth-tokens';
import { createAppRouter } from './router';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
  },
});
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
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
