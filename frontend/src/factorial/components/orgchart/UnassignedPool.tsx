import { useState } from 'react';
import type { EmployeeMini, OrgUnitNode } from '@/factorial/api/orgUnits';
import EmployeeChip from './EmployeeChip';

export default function UnassignedPool({
  employees,
  units,
  onMoveEmployee,
}: {
  employees: EmployeeMini[];
  units: OrgUnitNode[];
  onMoveEmployee: (employeeId: number, unitId: number | null) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`rounded-card border border-dashed bg-white p-3 transition-shadow ${over ? 'ring-2 ring-primary border-primary' : 'border-card-border-soft'}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = Number(e.dataTransfer.getData('text/plain'));
        if (id) onMoveEmployee(id, null);
      }}
    >
      <div className="font-semibold text-fx-sm mb-2">Не распределены ({employees.length})</div>
      <div className="space-y-2">
        {employees.length === 0 && <div className="text-fx-xs text-text-muted">Все сотрудники распределены 🎉</div>}
        {employees.map((e) => (
          <EmployeeChip key={e.id} emp={e} units={units} currentUnitId={null} onMove={onMoveEmployee} />
        ))}
      </div>
    </div>
  );
}
