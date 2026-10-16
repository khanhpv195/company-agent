import { useState } from 'react';
import { Icon } from '../../components/Icon';

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <span style={{ color: '#888' }}>$</span>
      <code>{command}</code>
      <button
        title="Copy"
        aria-label="Copy lệnh"
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
