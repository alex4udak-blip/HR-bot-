import UserAvatar from '@/factorial/components/UserAvatar';
import type { EmployeeMini, OrgUnitNode } from '@/factorial/api/orgUnits';

export default function EmployeeChip({
  emp,
  units,
  currentUnitId,
  onMove,
}: {
  emp: EmployeeMini;
  units: OrgUnitNode[];
  currentUnitId: number | null;
  onMove: (employeeId: number, unitId: number | null) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(emp.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="flex items-center gap-2 bg-white border border-card-border-soft rounded-fx-lg px-2.5 py-1.5 cursor-grab active:cursor-grabbing"
    >
      <UserAvatar fullName={emp.user_name || '—'} size="sm" singleLetter />
      <div className="min-w-0">
        <div className="text-fx-sm font-medium truncate">{emp.user_name || '—'}</div>
        {emp.position && <div className="text-fx-xs text-text-muted truncate">{emp.position}</div>}
      </div>
      <select
        className="ml-auto text-fx-xs border border-border rounded px-1 py-0.5 bg-white"
        value={currentUnitId ?? ''}
        onChange={(e) => onMove(emp.id, e.target.value ? Number(e.target.value) : null)}
        onClick={(e) => e.stopPropagation()}
        title="Переместить"
      >
        <option value="">Не распределён</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    </div>
  );
}
