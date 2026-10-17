import type { AuthResult, RegisterInput } from '@repo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api-client';
import { setTokens } from '../../lib/auth-tokens';
import { qk } from '../../lib/query-keys';
import { LoginHero } from './LoginHero';

export function RegisterPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const register = useMutation({
    mutationFn: (input: RegisterInput) => api.post<AuthResult>('/auth/register', input),
    onSuccess: async (result) => {
      // A previous account's cached data must not leak into the new session.
      qc.clear();
      setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      qc.setQueryData(qk.session, result.session);
      await navigate({ to: result.session.onboarded ? '/' : '/onboarding' });
    },
  });
  const tooShort = password.length > 0 && password.length < 8;

  return (
    <div className="app">
      <section className="screen login">
        <LoginHero />
        <div className="login-side drag" data-tauri-drag-region>
          <div className="login-box">
            <h1>
              Create your
              <br />
              account.
            </h1>
            <div className="card">
              <form
                className="card-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  register.mutate({
                    name: name.trim(),
                    email: email.trim(),
                    password,
                    ...(workspaceName.trim() ? { workspaceName: workspaceName.trim() } : {}),
                  });
                }}
              >
                <label htmlFor="reg-name">Name</label>
                <input
                  id="reg-name"
                  className="field"
                  placeholder="Your name"
                  autoComplete="name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <label htmlFor="reg-email">Email address</label>
                <input
                  id="reg-email"
                  className="field"
                  type="email"
                  placeholder="Enter your email address"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <label htmlFor="reg-password">Password</label>
                <input
                  id="reg-password"
                  className="field"
                  type="password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {tooShort && <div className="err-line">Password must be at least 8 characters</div>}
                <label htmlFor="reg-workspace">Workspace name (optional)</label>
                <input
                  id="reg-workspace"
                  className="field"
                  placeholder={name.trim() ? `${name.trim()} workspace` : 'My workspace'}
                  maxLength={80}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
                {register.error && (
                  <div className="err-line">
                    {register.error instanceof ApiError
                      ? register.error.message
                      : 'Không tạo được tài khoản'}
                  </div>
                )}
                <button className="btn-olive" disabled={register.isPending}>
                  Create account&nbsp;&nbsp;›
                </button>
              </form>
              <div className="card-foot">
                Already have an account? <Link to="/login">Log in</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
