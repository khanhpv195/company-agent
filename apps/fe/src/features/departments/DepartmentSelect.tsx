import { useT } from '../../i18n';
import { useDepartments } from './departments.api';

/** Department picker; the empty value is "No department". */
export function DepartmentSelect({
  id,
  value,
  onChange,
  disabled,
  className = 'field',
  label,
}: {
  id?: string;
  value: string | null;
  onChange: (departmentId: string | null) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const { list } = useDepartments();
  return (
    <select
      id={id}
      className={className}
      aria-label={label}
      disabled={disabled}
      value={list.some((d) => d.id === value) ? (value ?? '') : ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{t('departments.none')}</option>
      {list.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}
