import type { Session } from '@repo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { LoginHero } from './LoginHero';

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('khanhpv@holatech.tech');
  const login = useMutation({
    mutationFn: () => api.post<Session>('/auth/login', { email }),
    onSuccess: async (session) => {
      qc.setQueryData(qk.session, session);
      await navigate({ to: session.onboarded ? '/' : '/onboarding' });
    },
  });
  const name = email.split('@')[0] || 'bạn';

  return (
    <div className="app">
      <section className="screen login">
        <LoginHero />
        <div className="login-side drag" data-tauri-drag-region>
          <div className="login-box">
            <h1>
              Welcome back,
              <br />
              {name}.
            </h1>
            <button className="notyou" onClick={() => setEmail('')}>
              Not you?
            </button>
            <div className="card">
              <form
                className="card-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  login.mutate();
                }}
              >
                <div className="sso">
                  <button
                    type="button"
                    title="Apple"
                    aria-label="Đăng nhập với Apple"
                    onClick={() => login.mutate()}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#111"
                        d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.4-1-2.4-4.1zM14 5.2c.7-.8 1.2-2 1-3.2-1 0-2.2.7-3 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.3-.6 3-1.4z"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title="Google"
                    aria-label="Đăng nhập với Google"
                    onClick={() => login.mutate()}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9c-.3 1.4-1 2.5-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.7 3.3-8z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8C3.9 20.6 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.8 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V7H2.1C1.4 8.5 1 10.2 1 12s.4 3.5 1.1 5l3.7-2.8z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.4c1.6 0 3.1.6 4.2 1.6l3.2-3.2C17.5 2 15 1 12 1 7.7 1 3.9 3.4 2.1 7l3.7 2.8C6.7 7.2 9.1 5.4 12 5.4z"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title="Microsoft"
                    aria-label="Đăng nhập với Microsoft"
                    onClick={() => login.mutate()}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#F25022" d="M1 1h10v10H1z" />
                      <path fill="#7FBA00" d="M13 1h10v10H13z" />
                      <path fill="#00A4EF" d="M1 13h10v10H1z" />
                      <path fill="#FFB900" d="M13 13h10v10H13z" />
                    </svg>
                  </button>
                </div>
                <div className="or">or</div>
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  className="field"
                  type="email"
                  placeholder="Enter your email address"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {login.error && (
                  <div className="err-line">
                    {login.error instanceof ApiError ? login.error.message : 'Không đăng nhập được'}
                  </div>
                )}
                <button className="btn-olive" disabled={login.isPending}>
                  Continue&nbsp;&nbsp;›
                </button>
              </form>
              <div className="card-foot">
                Don&apos;t have an account? <a href="#/login">Sign up</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
