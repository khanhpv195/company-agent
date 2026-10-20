import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useT } from '../../i18n';
import { useOpenDm } from '../chat/chat.api';
import { useUi } from '../../stores/ui';
import { selectableComputers } from '../computers/computers.logic';
import { usePeople } from '../workspace/workspace.api';
import {
  DEFAULT_MAX_TURNS,
  MAX_NAME,
  toCreateInput,
  validateAgentForm,
  type AgentFormErrors,
  type AgentFormValues,
} from './agent-form.logic';
import { MAX_AGENT_SKILLS, MAX_TITLE } from '@repo/shared';
import { DepartmentSelect } from '../departments/DepartmentSelect';
import { cleanTitle, isTitleValid } from '../departments/departments.logic';
import { useCreateAgent } from './people.api';
import { useSkills } from '../skills/skills.api';
import { atSkillLimit } from '../skills/skills.logic';

export function NewAgentModal() {
  const open = useUi((s) => s.newAgent);
  const close = useUi((s) => s.closeNewAgent);
  if (!open) return null;
  return <NewAgentForm initialComputerId={open.computerId} onClose={close} />;
}

function NewAgentForm({
  initialComputerId,
  onClose,
}: {
  initialComputerId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const people = usePeople();
  const library = useSkills();
  const create = useCreateAgent();
  const openDm = useOpenDm();
  const navigate = useNavigate();
  const [values, setValues] = useState<AgentFormValues>({
    name: '',
    computerId:
      initialComputerId ??
      selectableComputers(people.computers).find((c) => c.status === 'online')?.id ??
      '',
    persona: '',
    workdir: '',
    maxTurns: '',
  });
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<AgentFormErrors>({});
  const set = (patch: Partial<AgentFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => ({
      ...e,
      ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])),
    }));
  };

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (!next.delete(id)) next.add(id);
    setChecked(next);
  };

  const submit = () => {
    if (create.isPending) return;
    const found = validateAgentForm(
      t,
      values,
      people.agents.map((a) => a.name),
      people.computers.map((c) => c.id),
    );
    if (!isTitleValid(title)) found.title = t('departments.titleTooLong', { max: MAX_TITLE });
    setErrors(found);
    if (Object.keys(found).length) return;
    const input = {
      ...toCreateInput(
        values,
        library.filter((s) => checked.has(s.id)).map((s) => s.id),
      ),
      ...(departmentId ? { departmentId } : null),
      ...(cleanTitle(title) ? { title: cleanTitle(title)! } : null),
    };
    create.mutate(input, {
      onSuccess: (agent) => {
        // Open the DM in the background so the agent shows up in Chat right away.
        openDm.mutate(agent.id);
        onClose();
        void navigate({ to: '/people/agents/$agentId', params: { agentId: agent.id } });
      },
    });
  };

  const invalid = (key: keyof AgentFormErrors) =>
    errors[key] ? { borderColor: 'var(--err)' } : undefined;

  return (
    <Modal onClose={onClose} label={t('people.newAgent.title')}>
      <h3>{t('people.newAgent.title')}</h3>
      <p>{t('people.newAgent.lead')}</p>
      <input
        className="field"
        autoFocus
        placeholder={t('people.newAgent.namePlaceholder')}
        aria-label={t('people.agentName')}
        autoComplete="off"
        maxLength={MAX_NAME + 20}
        value={values.name}
        style={invalid('name')}
        onChange={(e) => set({ name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {errors.name && <div className="err-line">{errors.name}</div>}
      <div className="nt-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <label>
          {t('people.computer')}
          <select
            value={values.computerId}
            style={invalid('computerId')}
            onChange={(e) => set({ computerId: e.target.value })}
          >
            <option value="">{t('people.form.chooseComputerOption')}</option>
            {selectableComputers(people.computers).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status === 'offline' ? t('people.offlineSuffix') : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('people.maxTurns')}
          <input
            className="field"
            style={{ height: 36, marginTop: 5, ...invalid('maxTurns') }}
            inputMode="numeric"
            placeholder={String(DEFAULT_MAX_TURNS)}
            aria-label={t('people.maxTurns')}
            value={values.maxTurns}
            onChange={(e) => set({ maxTurns: e.target.value })}
          />
        </label>
      </div>
      {errors.computerId && <div className="err-line">{errors.computerId}</div>}
      {errors.maxTurns && <div className="err-line">{errors.maxTurns}</div>}
      <div className="nt-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label>
          {t('departments.department')}
          <DepartmentSelect
            label={t('departments.department')}
            value={departmentId}
            onChange={setDepartmentId}
          />
        </label>
        <label>
          {t('departments.title')}
          <input
            className="field"
            style={{ height: 36, marginTop: 5, ...invalid('title') }}
            placeholder={t('departments.titlePlaceholder')}
            aria-label={t('departments.title')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((x) => ({ ...x, title: undefined }));
            }}
          />
        </label>
      </div>
      {errors.title && <div className="err-line">{errors.title}</div>}
      <input
        className="field"
        style={{ marginTop: 10 }}
        placeholder={t('people.newAgent.workdirPlaceholder')}
        aria-label={t('people.workdir')}
        autoComplete="off"
        value={values.workdir}
        onChange={(e) => set({ workdir: e.target.value })}
      />
      <textarea
        className="field"
        style={{ height: 84, padding: '10px 14px', marginTop: 8, resize: 'none' }}
        placeholder={t('people.newAgent.personaPlaceholder')}
        aria-label={t('people.persona')}
        value={values.persona}
        onChange={(e) => set({ persona: e.target.value })}
      />
      <div className="nt-chk" style={{ marginBottom: 6 }}>
        {t('people.newAgent.skillsOn', { on: checked.size, max: MAX_AGENT_SKILLS })}
      </div>
      {library.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: 0 }}>
          {t('people.newAgent.noSkills')}
        </p>
      ) : (
        <div className="chips" style={{ maxHeight: 110, overflowY: 'auto' }}>
          {library.map((s) => {
            const on = checked.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                disabled={!on && atSkillLimit(checked.size)}
                title={s.description}
                onClick={() => toggle(s.id)}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}
      {create.error && <div className="err-line">{create.error.message}</div>}
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          {t('people.cancel')}
        </button>
        <button className="btn primary" onClick={submit} disabled={create.isPending}>
          {t('people.newAgent.create')}
        </button>
      </div>
    </Modal>
  );
}
