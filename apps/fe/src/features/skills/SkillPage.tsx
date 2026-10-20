import { MAX_SKILL_CONTENT, MAX_SKILL_DESCRIPTION, MAX_SKILL_NAME, type Skill } from '@repo/shared';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/error-message';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { useSession, usePeople } from '../workspace/workspace.api';
import {
  useApproveSkill,
  useDeleteSkill,
  useRestoreSkill,
  useSkillsQuery,
  useSkillVersions,
  useUpdateSkill,
} from './skills.api';
import {
  canApproveSkill,
  canEditSkill,
  inUseAgents,
  isSkillDirty,
  needsApproval,
  normalizeSkillName,
  validateSkillForm,
  type SkillFormErrors,
  type SkillFormValues,
} from './skills.logic';

const route = getRouteApi('/_app/skills/$skillId');

/** A failed save/restore; a 400 `skills.TOO_LARGE` also names the agents it would overflow. */
function SaveError({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const agents =
    error instanceof ApiError && error.status === 400 ? inUseAgents(error.body?.meta?.details) : [];
  return (
    <div className="err-line" role="alert">
      {errorMessage(error, t, 'skills.saveFailed')}
      {agents.length > 0 && (
        <>
          {' '}
          {t('skills.tooLargeAgents')}
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {agents.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function SkillPage() {
  const t = useT();
  const { skillId } = route.useParams();
  const query = useSkillsQuery();
  const skill = query.data?.find((s) => s.id === skillId);
  if (!skill)
    return (
      <div className="page">
        <Link to="/skills" className="link">
          ← {t('skills.back')}
        </Link>
        <div className="loading" style={{ marginTop: 40 }}>
          {query.isPending ? t('people.loading') : t('skills.notFound')}
        </div>
      </div>
    );
  return <SkillDetail key={skill.id} skill={skill} />;
}

interface Draft extends SkillFormValues {
  /** The skill version the draft started from. */
  base: number;
}

function SkillDetail({ skill }: { skill: Skill }) {
  const t = useT();
  const now = useNow();
  const people = usePeople();
  const me = useSession().data?.user;
  const canEdit = canEditSkill(skill, me);
  const update = useUpdateSkill(skill.id);
  const approve = useApproveSkill(skill.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<SkillFormErrors>({});
  const [preview, setPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Untouched, the form follows the saved skill (also after a remote change).
  const values: SkillFormValues = draft ?? skill;
  const dirty = !!draft && isSkillDirty(skill, draft);
  const stale = !!draft && draft.base !== skill.version;
  const set = (patch: Partial<SkillFormValues>) => {
    setDraft({
      name: values.name,
      description: values.description,
      content: values.content,
      base: draft?.base ?? skill.version,
      ...patch,
    });
    setErrors((e) => ({
      ...e,
      ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])),
    }));
  };

  const save = () => {
    if (!draft || update.isPending) return;
    const found = validateSkillForm(t, draft);
    if (draft.content.length > MAX_SKILL_CONTENT)
      found.content = t('skills.form.contentTooLong', { max: MAX_SKILL_CONTENT });
    setErrors(found);
    if (Object.keys(found).length) return;
    update.mutate(
      {
        name: normalizeSkillName(draft.name),
        description: draft.description.trim(),
        content: draft.content,
      },
      { onSuccess: () => setDraft(null) },
    );
  };

  const invalid = (key: keyof SkillFormValues) =>
    errors[key] ? { borderColor: 'var(--err)' } : undefined;

  return (
    <div className="page skill-page">
      <Link to="/skills" className="link">
        ← {t('skills.back')}
      </Link>
      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h2>{skill.name}</h2>
          <div className="skill-meta">
            <code className="skill-slug">{skill.slug}</code>
            <span>v{skill.version}</span>
            <span>
              {t('skills.createdBy', {
                name: skill.createdById ? people.name(skill.createdById) : '—',
              })}
            </span>
            <span>{t('skills.updatedAt', { when: rel(skill.updatedAt, now) })}</span>
          </div>
        </div>
        {canEdit && (
          <button className="btn" onClick={() => setDeleting(true)}>
            {t('skills.delete')}
          </button>
        )}
      </div>

      {!canEdit && <div className="banner blk">{t('skills.readOnly')}</div>}
      {needsApproval(skill) && (
        <div className="banner err" style={{ marginBottom: 12 }} role="status">
          <span className="sp">
            {t('skills.needsApproval', {
              name: skill.updatedById ? people.name(skill.updatedById) : '—',
            })}
            {approve.error && <> {errorMessage(approve.error, t, 'skills.saveFailed')}</>}
          </span>
          {canApproveSkill(me) && (
            <button
              className="btn sm"
              type="button"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              {t('skills.approve')}
            </button>
          )}
        </div>
      )}
      {stale && (
        <div className="banner err" style={{ marginBottom: 12 }}>
          <span className="sp">{t('skills.stale')}</span>
          <button className="btn sm" type="button" onClick={() => setDraft(null)}>
            {t('skills.loadLatest')}
          </button>
        </div>
      )}

      <div className="skill-form">
        <label>
          {t('skills.name')}
          <input
            className="field"
            style={{ height: 38, marginTop: 5, ...invalid('name') }}
            value={values.name}
            maxLength={MAX_SKILL_NAME + 20}
            readOnly={!canEdit}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        {errors.name && (
          <div className="err-line" role="alert">
            {errors.name}
          </div>
        )}
        <label>
          {t('skills.slug')}
          <input
            className="field"
            style={{ height: 38, marginTop: 5 }}
            value={skill.slug}
            readOnly
            title={t('skills.slugLocked')}
          />
        </label>
        <label>
          {t('skills.description')}
          <textarea
            className="field"
            style={{
              height: 64,
              padding: '10px 14px',
              marginTop: 5,
              resize: 'vertical',
              ...invalid('description'),
            }}
            value={values.description}
            maxLength={MAX_SKILL_DESCRIPTION + 50}
            readOnly={!canEdit}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        {errors.description && (
          <div className="err-line" role="alert">
            {errors.description}
          </div>
        )}
        <div className="skill-editor-head">
          <span>{t('skills.content')}</span>
          <span className="skill-count" data-over={values.content.length > MAX_SKILL_CONTENT}>
            {values.content.length.toLocaleString()} / {MAX_SKILL_CONTENT.toLocaleString()}
          </span>
          {canEdit && (
            <div className="seg">
              <button
                type="button"
                className={!preview ? 'on' : ''}
                aria-pressed={!preview}
                onClick={() => setPreview(false)}
              >
                {t('skills.edit')}
              </button>
              <button
                type="button"
                className={preview ? 'on' : ''}
                aria-pressed={preview}
                onClick={() => setPreview(true)}
              >
                {t('skills.preview')}
              </button>
            </div>
          )}
        </div>
        {canEdit && !preview ? (
          <textarea
            className="field skill-code"
            style={{ height: 380, padding: '12px 14px', resize: 'vertical', ...invalid('content') }}
            aria-label={t('skills.content')}
            value={values.content}
            spellCheck={false}
            onChange={(e) => set({ content: e.target.value })}
          />
        ) : (
          <div className="skill-preview">
            <Markdown text={values.content} headings />
          </div>
        )}
        {errors.content && (
          <div className="err-line" role="alert">
            {errors.content}
          </div>
        )}
        <SaveError error={update.error} />
        {canEdit && (
          <div className="skill-actions">
            <button
              className="btn primary"
              type="button"
              disabled={!dirty || update.isPending}
              onClick={save}
            >
              {stale ? t('skills.overwrite', { version: skill.version }) : t('people.save')}
            </button>
            {stale && (
              <button className="btn" type="button" onClick={() => setDraft(null)}>
                {t('skills.loadLatest')}
              </button>
            )}
            <button
              className="btn"
              type="button"
              disabled={!draft}
              onClick={() => {
                setDraft(null);
                setErrors({});
                update.reset();
              }}
            >
              {t('people.discardChanges')}
            </button>
          </div>
        )}
      </div>

      <div className="grid2" style={{ marginTop: 28 }}>
        <div className="box">
          <h4>{t('skills.usedBy')}</h4>
          {skill.agentIds.length === 0 ? (
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{t('skills.usedByNone')}</span>
          ) : (
            <div className="chips">
              {skill.agentIds.map((id) => (
                <Link
                  key={id}
                  to="/people/agents/$agentId"
                  params={{ agentId: id }}
                  className="chip on"
                >
                  {people.name(id)}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <Versions
        skill={skill}
        canEdit={canEdit}
        dirty={dirty}
        onRestored={() => {
          setDraft(null);
          setErrors({});
          update.reset();
        }}
      />
      {deleting && <DeleteSkillModal skill={skill} onClose={() => setDeleting(false)} />}
    </div>
  );
}

function Versions({
  skill,
  canEdit,
  dirty,
  onRestored,
}: {
  skill: Skill;
  canEdit: boolean;
  dirty: boolean;
  onRestored: () => void;
}) {
  const t = useT();
  const now = useNow();
  const people = usePeople();
  const versions = useSkillVersions(skill.id);
  const restore = useRestoreSkill(skill.id);
  const [viewing, setViewing] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const closeConfirm = () => {
    setConfirm(null);
    restore.reset();
  };
  return (
    <section style={{ marginTop: 28 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>{t('skills.history')}</h3>
      {versions.isPending ? (
        <div style={{ color: 'var(--muted)' }}>{t('people.loading')}</div>
      ) : (
        <ul className="skill-versions">
          {(versions.data ?? []).map((v) => {
            const current = v.version === skill.version;
            return (
              <li key={v.version}>
                <div className="skill-version-row">
                  <b>v{v.version}</b>
                  {current && (
                    <span className="pill ok" style={{ marginLeft: 0 }}>
                      {t('skills.current')}
                    </span>
                  )}
                  <span style={{ color: 'var(--soft)' }}>{v.name}</span>
                  <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>
                    {v.editedById ? people.name(v.editedById) : '—'} · {rel(v.createdAt, now)}
                  </span>
                  <button
                    className="btn sm"
                    type="button"
                    onClick={() => setViewing(viewing === v.version ? null : v.version)}
                  >
                    {viewing === v.version ? t('skills.hide') : t('skills.view')}
                  </button>
                  {canEdit && !current && (
                    <button className="btn sm" type="button" onClick={() => setConfirm(v.version)}>
                      {t('skills.restore')}
                    </button>
                  )}
                </div>
                {viewing === v.version && (
                  <div className="skill-preview" style={{ marginTop: 8 }}>
                    <Markdown text={v.content} headings />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirm !== null && (
        <Modal onClose={closeConfirm} label={t('skills.restore')}>
          <h3>{t('skills.restoreTitle', { version: confirm })}</h3>
          <p>{t('skills.restoreBody', { version: confirm, next: skill.version + 1 })}</p>
          {dirty && <p>{t('skills.restoreDirty')}</p>}
          <SaveError error={restore.error} />
          <div className="wz-foot">
            <button className="btn" type="button" onClick={closeConfirm}>
              {t('people.cancel')}
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate(
                  { version: confirm },
                  {
                    onSuccess: () => {
                      closeConfirm();
                      onRestored();
                    },
                  },
                )
              }
            >
              {t('skills.restore')}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function DeleteSkillModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const remove = useDeleteSkill();
  const inUse =
    remove.error instanceof ApiError && remove.error.status === 409
      ? inUseAgents(remove.error.body?.meta?.details)
      : [];
  return (
    <Modal onClose={onClose} label={t('skills.delete')}>
      <h3>{t('skills.deleteTitle', { name: skill.name })}</h3>
      <p>{t('skills.deleteBody')}</p>
      {inUse.length > 0 ? (
        <div className="err-line" role="alert">
          {t('skills.inUse')}
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {inUse.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ) : (
        remove.error && (
          <div className="err-line" role="alert">
            {errorMessage(remove.error, t, 'skills.saveFailed')}
          </div>
        )
      )}
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          {t('people.cancel')}
        </button>
        <button
          className="btn primary"
          style={{ background: 'var(--err)', borderColor: 'var(--err)' }}
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(skill.id, {
              onSuccess: () => {
                onClose();
                void navigate({ to: '/skills' });
              },
            })
          }
        >
          {t('skills.delete')}
        </button>
      </div>
    </Modal>
  );
}
