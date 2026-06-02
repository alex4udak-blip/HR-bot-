import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
import type { OrgUnitNode } from '@/factorial/api/orgUnits';
import EmployeeChip from './EmployeeChip';

const UNIT_MIME = 'application/x-org-unit';

export default function OrgUnitCard({
  unit,
  allUnits,
  childrenNodes,
  onAddChild,
  onRename,
  onDelete,
  onMoveEmployee,
  onReparentUnit,
}: {
  unit: OrgUnitNode;
  allUnits: OrgUnitNode[];
  childrenNodes: ReactNode;
  onAddChild: (parentId: number) => void;
  onRename: (unit: OrgUnitNode) => void;
  onDelete: (unit: OrgUnitNode) => void;
  onMoveEmployee: (employeeId: number, unitId: number | null) => void;
  onReparentUnit: (unitId: number, newParentId: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [over, setOver] = useState(false);
  return (
    <div className="mb-2">
      <div
        className={`rounded-card border bg-card-translucent shadow-card overflow-hidden transition-shadow ${over ? 'ring-2 ring-primary border-primary' : 'border-card-border-soft'}`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const draggedUnit = e.dataTransfer.getData(UNIT_MIME);
          if (draggedUnit) {
            if (Number(draggedUnit) !== unit.id) onReparentUnit(Number(draggedUnit), unit.id);
            return;
          }
          const id = Number(e.dataTransfer.getData('text/plain'));
          if (id) onMoveEmployee(id, unit.id);
        }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 border-b border-card-border-soft"
          style={{ borderLeft: `4px solid ${unit.color || '#94A3B8'}` }}
        >
          <button onClick={() => setOpen((o) => !o)} className="text-text-muted hover:text-text-primary">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <span
            draggable
            onDragStart={(e) => { e.dataTransfer.setData(UNIT_MIME, String(unit.id)); e.dataTransfer.effectAllowed = 'move'; }}
            className="flex items-center gap-1 font-semibold text-fx-sm cursor-grab active:cursor-grabbing"
            title="Перетащите, чтобы переместить отдел"
          >
            <GripVertical className="w-3.5 h-3.5 text-text-muted" />
            {unit.name}
          </span>
          <span className="text-fx-xs text-text-muted">({unit.employees.length})</span>
          <div className="ml-auto flex items-center gap-1">
            <button title="Под-отдел" onClick={() => onAddChild(unit.id)} className="p-1 rounded hover:bg-sidebar-hover">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button title="Переименовать" onClick={() => onRename(unit)} className="p-1 rounded hover:bg-sidebar-hover">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button title="Удалить" onClick={() => onDelete(unit)} className="p-1 rounded hover:bg-sidebar-hover text-rose-600">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {open && (
          <div className="p-3 space-y-2">
            {unit.employees.length === 0 && <div className="text-fx-xs text-text-muted">Перетащите сюда сотрудника</div>}
            {unit.employees.map((e) => (
              <EmployeeChip key={e.id} emp={e} units={allUnits} currentUnitId={unit.id} onMove={onMoveEmployee} />
            ))}
          </div>
        )}
      </div>
      {open && <div className="ml-6 mt-2 border-l border-card-border-soft pl-4">{childrenNodes}</div>}
    </div>
  );
}
