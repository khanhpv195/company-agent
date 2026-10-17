import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../i18n';
import { errorReport } from './error-report';

/** Full-screen friendly crash page: used by the root ErrorBoundary and the router. */
export function ErrorScreen({ error }: { error: unknown }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(errorReport(error))
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  return (
    <div className="app">
      <section className="screen status-screen" role="alert">
        <div className="status-box">
          <h1>{t('errors.title')}</h1>
          <p>{t('errors.body')}</p>
          <div className="status-actions">
            <button className="btn-olive" onClick={() => window.location.reload()}>
              {t('errors.reload')}
            </button>
            <button className="btn" onClick={copy}>
              {copied ? t('errors.copied') : t('errors.copyDetails')}
            </button>
          </div>
          <pre className="status-detail">{errorReport(error)}</pre>
        </div>
      </section>
    </div>
  );
}

export function NotFoundScreen() {
  const t = useT();
  return (
    <div className="app">
      <section className="screen status-screen">
        <div className="status-box">
          <h1>{t('errors.notFoundTitle')}</h1>
          <p>{t('errors.notFoundBody')}</p>
          <div className="status-actions">
            <Link to="/" className="btn-olive">
              {t('errors.goHome')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
