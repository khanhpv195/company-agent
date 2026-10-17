import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { API_URL, MOCK } from '../../lib/api-client';
import { parseUserAgent } from './settings.logic';

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Real app version: from the Tauri runtime when packaged, else the build-time package.json value. */
async function readVersion(): Promise<string> {
  if (inTauri()) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch {
      /* fall through to the build version */
    }
  }
  return __APP_VERSION__;
}

export function DesktopSection() {
  const t = useT();
  const [version, setVersion] = useState(__APP_VERSION__);
  useEffect(() => {
    let alive = true;
    void readVersion().then((v) => alive && setVersion(v));
    return () => {
      alive = false;
    };
  }, []);
  const os = parseUserAgent(typeof navigator === 'undefined' ? null : navigator.userAgent).os;

  return (
    <div className="box set-box">
      <dl className="kv">
        <dt>{t('settings.desktop.version')}</dt>
        <dd>{version}</dd>
        <dt>{t('settings.desktop.runtime')}</dt>
        <dd>
          {inTauri() ? t('settings.desktop.runtimeDesktop') : t('settings.desktop.runtimeBrowser')}
        </dd>
        <dt>{t('settings.desktop.platform')}</dt>
        <dd>{os ?? t('settings.desktop.unknown')}</dd>
        <dt>{t('settings.desktop.server')}</dt>
        <dd>{MOCK ? t('settings.desktop.mock') : <code>{API_URL}</code>}</dd>
      </dl>
    </div>
  );
}
