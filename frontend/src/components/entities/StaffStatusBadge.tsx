import { useState, useEffect } from 'react';
import { Briefcase } from 'lucide-react';
import clsx from 'clsx';
import { getStaffStatus } from '@/services/api';

/**
 * Бейдж оформления кандидата в штат на карточке. Виден только для оформленных
 * (status === 'transferred'). Тянет статус связанного сотрудника Factorial:
 *   активен  → зелёный «В штате — открыть в Factorial»
 *   уволен   → красный «Уволен — открыть в Factorial»
 */
export default function StaffStatusBadge({
  entityId,
  status,
}: {
  entityId: number;
  status: string;
}) {
  const [isActive, setIsActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== 'transferred') {
      setIsActive(null);
      return;
    }
    let alive = true;
    getStaffStatus(entityId)
      .then((s) => {
        if (alive) setIsActive(s.is_active);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entityId, status]);

  if (status !== 'transferred') return null;

  const dismissed = isActive === false; // до загрузки — оптимистично «В штате»
  const color = dismissed ? '#f87171' : '#4ade80';
  return (
    <a
      href="/factorial/employees"
      className={clsx(
        'inline-flex items-center px-3 py-1.5 text-xs rounded-lg border transition-colors',
        dismissed ? 'bg-red-500/10 border-red-500/20' : 'bg-green-500/10 border-green-500/20',
      )}
    >
      {/* Цвет на дочернем span, а не на <a>: контейнер карточки красит ссылки в
          цвет стадии правилом с !important; явный color ребёнка бьёт унаследованный. */}
      <span style={{ color }} className="inline-flex items-center gap-1.5">
        <Briefcase className="w-3.5 h-3.5" />
        {dismissed ? 'Уволен' : 'В штате'} — открыть в Factorial
      </span>
    </a>
  );
}
