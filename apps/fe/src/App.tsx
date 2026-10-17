import { useEffect, useRef } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useLocale } from './i18n';
import type { createAppRouter } from './router';

/** Remounts the tree on a language switch so texts built outside hooks (formatters) refresh too. */
export function App({
  queryClient,
  router,
}: {
  queryClient: QueryClient;
  router: ReturnType<typeof createAppRouter>;
}) {
  const locale = useLocale();
  const previous = useRef(locale);
  useEffect(() => {
    if (previous.current === locale) return;
    previous.current = locale;
    // Server-localized messages are cached per language: refetch them.
    void queryClient.invalidateQueries();
  }, [locale, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider key={locale} router={router} />
    </QueryClientProvider>
  );
}
