const KEY = 'agent.auth';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

// localStorage for now; moves to the Tauri store / OS keychain later.
export function getTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    return parsed.accessToken && parsed.refreshToken
      ? { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
      : null;
  } catch {
    return null;
  }
}

export function setTokens(tokens: StoredTokens): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
