import { Users, UserRound } from 'lucide-react';

// Полоса над списком воронки: чьих кандидатов показываем (20.10.2026).
//
// Раньше это была галочка «Только мои». Во включённом виде (по умолчанию в
// своей воронке) было непонятно, что кандидаты коллег просто скрыты: Влада
// добавляла кандидатов в общую с Марией воронку, а Мария их «не видела».
// Владелец: «у всех, кроме суперадминов, показываются только те кандидаты,
// которые они взяли в работу; пусть будет кнопка «Показать всех», и чтобы было
// понятно, что он покажет кандидатов и других рекрутёров».
//
// Логика выбора (кому что по умолчанию, когда сбрасывается) — прежняя,
// useFunnelCandidates; здесь только вид.

export type FunnelScopeMode = 'own' | 'foreign' | 'self' | 'not-working';

export function funnelScopeMode(p: {
  isSelfContext: boolean;
  isForeignContext: boolean;
  worksOnFunnel: boolean;
}): FunnelScopeMode {
  if (p.isSelfContext) return 'self';
  if (!p.worksOnFunnel) return 'not-working';
  return p.isForeignContext ? 'foreign' : 'own';
}

const chip =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
const idle =
  'border-[color:var(--hf-main-300)] bg-[var(--hf-white)] text-[var(--hf-main-900)] hover:border-[color:var(--hf-accent)] hover:text-[color:var(--hf-accent)]';
const active =
  'border-[color:var(--hf-accent)] text-[color:var(--hf-accent)] bg-[var(--hf-main-50)]';
const note = 'text-xs text-[var(--hf-main-600)]';

export function FunnelScopeToggle({
  mode,
  onlyMine,
  setOnlyMine,
}: {
  mode: FunnelScopeMode;
  onlyMine: boolean;
  setOnlyMine: (value: boolean) => void;
}) {
  if (mode === 'self') {
    return (
      <span className={note}>
        <UserRound className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        Ваша воронка из «Мои вакансии» — показаны только ваши кандидаты
      </span>
    );
  }
  if (mode === 'not-working') {
    return (
      <span className={note}>
        <Users className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        Воронка не у вас в работе — показаны кандидаты всех рекрутёров
      </span>
    );
  }
  if (mode === 'foreign') {
    // Воронка коллеги (выбран в сайдбаре): видны его кандидаты, можно оставить своих.
    return (
      <button
        type="button"
        onClick={() => setOnlyMine(!onlyMine)}
        aria-pressed={onlyMine}
        className={`${chip} ${onlyMine ? active : idle}`}
        title="Оставить в этой воронке только кандидатов, которых добавили вы. Сбросится, когда уйдёте из воронки."
      >
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        Только мои
      </button>
    );
  }
  // Своя воронка.
  return onlyMine ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={note}>Показаны только ваши кандидаты</span>
      <button
        type="button"
        onClick={() => setOnlyMine(false)}
        className={`${chip} ${idle}`}
        title="Покажет и кандидатов, которых в эту воронку добавили другие рекрутёры. Сбросится, когда уйдёте из воронки."
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Показать всех кандидатов — и других рекрутёров
      </button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={`${chip} ${active}`}>
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Показаны кандидаты всех рекрутёров
      </span>
      <button
        type="button"
        onClick={() => setOnlyMine(true)}
        className={`${chip} ${idle}`}
      >
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        Только мои
      </button>
    </div>
  );
}
