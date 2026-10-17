import type { Computer } from '@repo/shared';
import { useState } from 'react';
import { API_URL } from '../../lib/api-client';
import { useNow } from '../../lib/use-now';
import { MANAGER_ONLY_HINT } from '../people/agent-form.logic';
import { useCanManage } from '../people/people.api';
import { CopyCommand } from './CopyCommand';
import { useCreatePairingCode } from './computers.api';
import {
  formatCountdown,
  pairingCommand,
  secondsLeft,
  serverOrigin,
  type PairingCode,
} from './computers.logic';

const hint = { color: 'var(--muted)', fontSize: 13, margin: '8px 0' } as const;

interface PairingPanelProps {
  /** Newly paired computer, from `useComputerArrivals` in the parent. */
  arrived: Computer | undefined;
  /** Parent resets its baseline so the next pairing is detected as new. */
  onAgain: () => void;
}

/** Owner/admin creates a pairing code and copies the `agent connect` command. */
export function PairingPanel({ arrived, onAgain }: PairingPanelProps) {
  const canManage = useCanManage();
  const now = useNow();
  const create = useCreatePairingCode();
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const left = pairing ? secondsLeft(pairing.expiresAt, now) : 0;
  const expired = !!pairing && left === 0;

  const generate = () => {
    onAgain();
    create.mutate(undefined, { onSuccess: setPairing });
  };

  const requestButton = (label: string) => (
    <button className="btn primary" disabled={!canManage || create.isPending} onClick={generate}>
      {label}
    </button>
  );

  return (
    <div className="pair">
      {arrived ? (
        <div className="status" aria-live="polite">
          <span className="dot on" />
          <div>
            <b>Đã kết nối {arrived.name}</b>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              {arrived.os} · CLI {arrived.cliVersion}
            </div>
          </div>
        </div>
      ) : null}

      {!arrived && !pairing && (
        <div>
          {requestButton('Tạo mã kết nối')}
          {!canManage && <p style={hint}>{MANAGER_ONLY_HINT}</p>}
        </div>
      )}

      {!arrived && pairing && expired && (
        <div>
          <p>Mã đã hết hạn. Tạo mã mới để kết nối.</p>
          {requestButton('Tạo mã mới')}
        </div>
      )}

      {!arrived && pairing && !expired && (
        <>
          <div className="pair-code" aria-live="polite">
            <code style={{ fontSize: 22, letterSpacing: 2 }}>{pairing.code}</code>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              Hết hạn sau {formatCountdown(left)}
            </span>
          </div>
          <CopyCommand command={pairingCommand(serverOrigin(API_URL), pairing.code)} />
          <p style={hint}>
            Cần cài và đăng nhập Claude Code trên máy đó (<code>claude login</code>) hoặc đặt{' '}
            <code>ANTHROPIC_API_KEY</code>.
          </p>
          <div className="status">
            <div className="spinner" />
            <span>Đang chờ máy kết nối…</span>
          </div>
        </>
      )}

      {arrived && canManage && (
        <div style={{ marginTop: 12 }}>{requestButton('Kết nối máy khác')}</div>
      )}

      {create.error && <div className="err-line">{create.error.message}</div>}
    </div>
  );
}
