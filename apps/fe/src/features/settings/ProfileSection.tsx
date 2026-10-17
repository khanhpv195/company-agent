import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { MemberAvatar } from '../../components/Avatar';
import { useT } from '../../i18n';
import { useSession } from '../workspace/workspace.api';
import { isProfileNameValid, profilePatch, PROFILE_COLORS } from './settings.logic';
import { useLogout, useNotify, useUpdateProfile } from './settings.api';

export function ProfileSection() {
  const t = useT();
  const user = useSession().data?.user;
  const notify = useNotify();
  const logout = useLogout();
  const update = useUpdateProfile();
  // Edits live in a draft; `null` means "untouched", so the form follows the saved profile.
  const [draft, setDraft] = useState<{ name?: string; color?: string | null }>({});
  if (!user) return null;

  const name = draft.name ?? user.name;
  const color = draft.color === undefined ? user.color : draft.color;
  const patch = profilePatch(user, { name, color });
  const valid = isProfileNameValid(name);

  return (
    <div className="set-stack">
      <form
        className="box set-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!patch || !valid) return;
          update.mutate(patch, {
            onSuccess: () => {
              setDraft({});
              notify(t('settings.profile.saved'));
            },
          });
        }}
      >
        <div className="profile-head">
          <MemberAvatar member={{ name: name.trim() || user.name, color }} size={48} />
          <div>
            <div style={{ fontWeight: 600 }}>{name.trim() || user.name}</div>
            <div style={{ color: 'var(--soft)', fontSize: 13 }}>
              {user.email}
              <span className={`verified-badge ${user.emailVerified ? '' : 'no'}`}>
                {user.emailVerified && <Icon name="check" size={12} />}
                {user.emailVerified
                  ? t('settings.profile.verified')
                  : t('settings.profile.unverified')}
              </span>
            </div>
          </div>
        </div>
        <label htmlFor="pf-name">{t('settings.profile.name')}</label>
        <input
          id="pf-name"
          className="field"
          maxLength={60}
          value={name}
          aria-invalid={!valid || undefined}
          aria-describedby={valid ? undefined : 'pf-name-msg'}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        {!valid && (
          <div id="pf-name-msg" className="err-line" role="alert">
            {t('settings.profile.nameInvalid')}
          </div>
        )}
        <label id="pf-color-label" style={{ marginTop: 14 }}>
          {t('settings.profile.color')}
        </label>
        <div className="swatches" role="group" aria-labelledby="pf-color-label">
          <button
            type="button"
            className={`swatch none ${color === null ? 'on' : ''}`}
            title={t('settings.profile.colorDefault')}
            aria-label={t('settings.profile.colorDefault')}
            aria-pressed={color === null}
            onClick={() => setDraft((d) => ({ ...d, color: null }))}
          />
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${color === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={t('settings.profile.colorAria', { color: c })}
              aria-pressed={color === c}
              onClick={() => setDraft((d) => ({ ...d, color: c }))}
            />
          ))}
        </div>
        <div className="set-row">
          <button className="btn primary" disabled={!patch || !valid || update.isPending}>
            {update.isPending ? t('settings.profile.saving') : t('settings.profile.save')}
          </button>
        </div>
      </form>
      <div>
        <button className="btn" onClick={() => void logout()}>
          <Icon name="logout" size={16} /> {t('settings.profile.logout')}
        </button>
      </div>
    </div>
  );
}
