import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useUi } from '../../stores/ui';
import { selectableComputers } from '../computers/computers.logic';
import { usePeople } from '../workspace/workspace.api';
import {
  DEFAULT_MAX_TURNS,
  MAX_NAME,
  skillFlags,
  toCreateInput,
  validateAgentForm,
  type AgentFormErrors,
  type AgentFormValues,
} from './agent-form.logic';
import { useCreateAgent, useSkillCatalog } from './people.api';

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
  const people = usePeople();
  const catalog = useSkillCatalog();
  const create = useCreateAgent();
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
  const [skills, setSkills] = useState<Set<string> | null>(null);
  const [errors, setErrors] = useState<AgentFormErrors>({});
  const set = (patch: Partial<AgentFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => ({
      ...e,
      ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])),
    }));
  };

  // Until the user touches a skill, the catalog's own defaults apply.
  const checked = skills ?? new Set((catalog ?? []).filter((s) => s.enabled).map((s) => s.id));
  const toggle = (id: string) => {
    const next = new Set(checked);
    if (!next.delete(id)) next.add(id);
    setSkills(next);
  };

  const submit = () => {
    if (create.isPending) return;
    const found = validateAgentForm(
      values,
      people.agents.map((a) => a.name),
      people.computers.map((c) => c.id),
    );
    setErrors(found);
    if (Object.keys(found).length) return;
    const input = toCreateInput(
      values,
      skills && catalog ? skillFlags(catalog, skills) : undefined,
    );
    create.mutate(input, {
      onSuccess: (agent) => {
        onClose();
        void navigate({ to: '/people/agents/$agentId', params: { agentId: agent.id } });
      },
    });
  };

  const invalid = (key: keyof AgentFormErrors) =>
    errors[key] ? { borderColor: 'var(--err)' } : undefined;

  return (
    <Modal onClose={onClose} label="Thêm agent">
      <h3>Thêm agent</h3>
      <p>Agent chạy Claude Code trên một computer đã kết nối.</p>
      <input
        className="field"
        autoFocus
        placeholder="Tên agent, ví dụ: Ops Bot"
        aria-label="Tên agent"
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
          Computer
          <select
            value={values.computerId}
            style={invalid('computerId')}
            onChange={(e) => set({ computerId: e.target.value })}
          >
            <option value="">Chọn computer…</option>
            {selectableComputers(people.computers).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status === 'offline' ? ' (offline)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max turns
          <input
            className="field"
            style={{ height: 36, marginTop: 5, ...invalid('maxTurns') }}
            inputMode="numeric"
            placeholder={String(DEFAULT_MAX_TURNS)}
            aria-label="Max turns"
            value={values.maxTurns}
            onChange={(e) => set({ maxTurns: e.target.value })}
          />
        </label>
      </div>
      {errors.computerId && <div className="err-line">{errors.computerId}</div>}
      {errors.maxTurns && <div className="err-line">{errors.maxTurns}</div>}
      <input
        className="field"
        style={{ marginTop: 10 }}
        placeholder="Workdir (mặc định ~/.agent/agents/<tên>)"
        aria-label="Workdir"
        autoComplete="off"
        value={values.workdir}
        onChange={(e) => set({ workdir: e.target.value })}
      />
      <textarea
        className="field"
        style={{ height: 84, padding: '10px 14px', marginTop: 8, resize: 'none' }}
        placeholder="Persona (để trống để dùng persona mặc định)"
        aria-label="Persona"
        value={values.persona}
        onChange={(e) => set({ persona: e.target.value })}
      />
      <div className="nt-chk" style={{ marginBottom: 6 }}>
        Skills ({checked.size}/{catalog?.length ?? 0} đang bật)
      </div>
      <div className="chips" style={{ maxHeight: 110, overflowY: 'auto' }}>
        {(catalog ?? []).map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip ${checked.has(s.id) ? 'on' : ''}`}
            aria-pressed={checked.has(s.id)}
            onClick={() => toggle(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
      {create.error && <div className="err-line">{create.error.message}</div>}
      <div className="wz-foot">
        <button className="btn" onClick={onClose}>
          Huỷ
        </button>
        <button className="btn primary" onClick={submit} disabled={create.isPending}>
          Tạo agent
        </button>
      </div>
    </Modal>
  );
}
