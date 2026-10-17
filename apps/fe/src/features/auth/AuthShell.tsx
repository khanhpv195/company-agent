import type { ReactNode } from 'react';
import { LoginHero } from './LoginHero';

/** The login-card layout (hero on the left, centered card on the right) for the account screens. */
export function AuthShell({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="app">
      <section className="screen login">
        <LoginHero />
        <div className="login-side drag" data-tauri-drag-region>
          <div className="login-box">
            <h1>{title}</h1>
            <div className="card">
              <div className="card-body">
                {lead && <p className="auth-lead">{lead}</p>}
                {children}
              </div>
              {footer && <div className="card-foot">{footer}</div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
