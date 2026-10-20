import {
  MAX_SKILL_CONTENT,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  SKILL_TEMPLATES,
  type SkillTemplate,
} from '@repo/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/error-message';
import { rel } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { usePeople } from '../workspace/workspace.api';
import { useCreateSkill, useSkillsQuery, type CreateSkillBody } from './skills.api';
import {
  filterSkills,
  slugifySkill,
  SLUG_PATTERN,
  validateSkillForm,
  type SkillFormErrors,
} from './skills.logic';

export function SkillsPage() {
  const t = useT();
  const people = usePeople();
  const now = useNow();
  const query = useSkillsQuery();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const skills = filterSkills(query.data ?? [], search);
  const agentName = (id: string) => people.agent(id)?.name ?? id;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>{t('skills.title')}</h2>
          <p className="lead">{t('skills.lead')}</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />
          {t('skills.new')}
        </button>
      </div>
      <input
        className="field"
        style={{ maxWidth: 360, height: 38, marginBottom: 16 }}
        type="search"
        placeholder={t('skills.search')}
        aria-label={t('skills.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {query.isPending ? (
        <div className="loading">{t('people.loading')}</div>
      ) : query.isError ? (
        <div className="err-line">{errorMessage(query.error, t, 'skills.loadFailed')}</div>
      ) : skills.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          {query.data?.length ? t('skills.noMatch') : t('skills.empty')}
        </p>
      ) : (
        <table className="skill-table">
          <thead>
            <tr>
              <th>{t('skills.col.name')}</th>
              <th>{t('skills.col.createdBy')}</th>
              <th>{t('skills.col.version')}</th>
              <th>{t('skills.col.agents')}</th>
              <th>{t('skills.col.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to="/skills/$skillId" params={{ skillId: s.id }} className="skill-name">
                    {s.name}
                  </Link>
                  <code className="skill-slug">{s.slug}</code>
                  <div className="skill-desc">{s.description}</div>
                </td>
                <td>{s.createdById ? people.name(s.createdById) : '—'}</td>
                <td>v{s.version}</td>
                <td>
                  {s.agentIds.length === 0 ? (
                    <span style={{ color: 'var(--muted)' }}>—</span>
                  ) : (
                    <span title={s.agentIds.map(agentName).join(', ')}>
                      {t('skills.agentCount', { n: s.agentIds.length })}
                    </span>
                  )}
                </td>
                <td style={{ color: 'var(--muted)' }}>{rel(s.updatedAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && <NewSkillModal onClose={() => setCreating(false)} />}
    </div>
  );
}

type Mode = 'blank' | 'template';

function NewSkillModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateSkill();
  const [mode, setMode] = useState<Mode>('blank');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState<SkillTemplate | null>(null);
  const [errors, setErrors] = useState<SkillFormErrors & { slug?: string; template?: string }>({});

  const submit = () => {
    if (create.isPending) return;
    let input: CreateSkillBody;
    if (mode === 'template') {
      if (!template) {
        setErrors({ template: t('skills.form.templateRequired') });
        return;
      }
      // The server fills the name, description and content from the template.
      input = { templateId: template.id };
    } else {
      const found: typeof errors = validateSkillForm(t, { name, description, content });
      if (content.length > MAX_SKILL_CONTENT)
        found.content = t('skills.form.contentTooLong', { max: MAX_SKILL_CONTENT });
      if (slug && !SLUG_PATTERN.test(slug)) found.slug = t('skills.form.slugInvalid');
      setErrors(found);
      if (Object.keys(found).length) return;
      input = {
        name: name.trim(),
        description: description.trim(),
        content,
        ...(slug ? { slug } : null),
      };
    }
    create.mutate(input, {
      onSuccess: (skill) => {
        onClose();
        void navigate({ to: '/skills/$skillId', params: { skillId: skill.id } });
      },
    });
  };

  const bad = (key: keyof typeof errors) =>
    errors[key] ? { borderColor: 'var(--err)' } : undefined;

  return (
    <Modal onClose={onClose} label={t('skills.new')}>
      <h3>{t('skills.new')}</h3>
      <p>{t('skills.newLead')}</p>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === 'blank' ? 'on' : ''} onClick={() => setMode('blank')}>
          {t('skills.blank')}
        </button>
        <button className={mode === 'template' ? 'on' : ''} onClick={() => setMode('template')}>
          {t('skills.fromTemplate')}
        </button>
      </div>
      {mode === 'blank' ? (
        <>
          <input
            className="field"
            autoFocus
            placeholder={t('skills.namePlaceholder')}
            aria-label={t('skills.name')}
            maxLength={MAX_SKILL_NAME + 20}
            value={name}
            style={bad('name')}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <div className="err-line">{errors.name}</div>}
          <input
            className="field"
            style={{ marginTop: 8, ...bad('slug') }}
            placeholder={t('skills.slugPlaceholder', { slug: slugifySkill(name) || 'ten-skill' })}
            aria-label={t('skills.slug')}
            autoComplete="off"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          {errors.slug && <div className="err-line">{errors.slug}</div>}
          <textarea
            className="field"
            style={{
              height: 64,
              padding: '10px 14px',
              marginTop: 8,
              resize: 'none',
              ...bad('description'),
            }}
            placeholder={t('skills.descriptionPlaceholder')}
            aria-label={t('skills.description')}
            maxLength={MAX_SKILL_DESCRIPTION + 50}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {errors.description && <div className="err-line">{errors.description}</div>}
          <textarea
            className="field skill-code"
            style={{
              height: 150,
              padding: '10px 14px',
              marginTop: 8,
              resize: 'none',
              ...bad('content'),
            }}
            placeholder={t('skills.contentPlaceholder')}
            aria-label={t('skills.content')}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {errors.content && <div className="err-line">{errors.content}</div>}
        </>
      ) : (
        <>
          <div className="skill-templates" role="listbox" aria-label={t('skills.fromTemplate')}>
            {SKILL_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                role="option"
                aria-selected={template?.id === tpl.id}
                className={`skill-tpl ${template?.id === tpl.id ? 'on' : ''}`}
                onClick={() => {
                  setTemplate(tpl);
                  setErrors({});
                }}
              >
                <b>{tpl.name}</b>
                <span>{tpl.description}</span>
              </button>
            ))}
          </div>
          {errors.template && <div className="err-line">{errors.template}</div>}
        </>
      )}
      {create.error && (
        <div className="err-line">{errorMessage(create.error, t, 'skills.saveFailed')}</div>
      )}
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          {t('people.cancel')}
        </button>
        <button className="btn primary" onClick={submit} disabled={create.isPending}>
          {t('skills.create')}
        </button>
      </div>
    </Modal>
  );
}
