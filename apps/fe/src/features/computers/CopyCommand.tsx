import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';

export function CopyCommand({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <span style={{ color: '#888' }}>$</span>
      <code>{command}</code>
      <button
        title={t('computers.copy')}
        aria-label={t('computers.copyCommand')}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(command)
            .then(() => setCopied(true))
            .catch(() => setCopied(true))
        }
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </div>
  );
}
