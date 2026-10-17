import { useT } from '../i18n';

/** Marks simulated (demo) computers and agents. */
export function DemoBadge({ className = '' }: { className?: string }) {
  const t = useT();
  return <span className={`demo-badge ${className}`.trim()}>{t('billing.demo')}</span>;
}
