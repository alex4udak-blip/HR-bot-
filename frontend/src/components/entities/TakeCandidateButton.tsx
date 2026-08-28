import { useState, useEffect, useRef } from "react";
import { Grab, Loader2, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { getErrorDetail } from "@/utils";
import {
  getAllVacancies,
  getAssignableUsers,
  takeApplication,
  type AssignableUser,
} from "@/services/api/vacancies";
import type { Vacancy } from "@/types";
import { isVacancyParticipant } from "@/utils/vacancy";
import { useAuthStore } from "@/stores/authStore";

/**
 * «Забрать» кандидата: выбрать ВОРОНКУ и РЕКРУТЁРА, кому отдать. Идемпотентно —
 * если кандидата в воронке нет, создаём заявку на выбранного; если есть, меняем
 * владельца (чип «HR: Имя»). «Кому отдать» — любой любому.
 *
 * Кнопку показываем ТОЛЬКО если кандидат уже есть хотя бы в одной воронке
 * (это забота вызывающего — рендерить компонент лишь при inFunnel).
 */
export default function TakeCandidateButton({
  entityId,
  onDone,
}: {
  entityId: number;
  // Передаём выбранную воронку и рекрутёра — вызывающему это нужно, чтобы после
  // смены владельца показать кандидата под НОВЫМ владельцем (иначе он выпадает
  // из текущего фильтра рекрутёра и выглядит «удалённым»).
  onDone?: (result: { vacancyId: number; recruiterId: number }) => void;
}) {
  const { user } = useAuthStore();
  const isHrAdmin =
    user?.role === "superadmin" ||
    user?.org_role === "owner" ||
    user?.org_role === "admin";

  const [open, setOpen] = useState(false);
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [recruiters, setRecruiters] = useState<AssignableUser[]>([]);
  const [vacancyId, setVacancyId] = useState<number | "">("");
  const [recruiterId, setRecruiterId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getAllVacancies({ status: "open" })
      .then((vs) => {
        if (cancelled) return;
        // Не-админ — только воронки, где он участник (иначе бэкенд вернёт 403).
        // Админ — все открытые. Клоны-источники НЕ прячем: «Трафик» и подобные
        // общие воронки должны быть доступны для «Забрать».
        const scoped =
          isHrAdmin || !user
            ? vs
            : vs.filter((v) => isVacancyParticipant(v, user.id));
        setVacancies(scoped);
      })
      .catch(() => toast.error("Не удалось загрузить воронки"));
    getAssignableUsers()
      .then((us) => {
        if (!cancelled) setRecruiters(us);
      })
      .catch(() => { /* некритично */ });
    // По умолчанию — «я».
    setRecruiterId(user?.id ?? "");
    return () => {
      cancelled = true;
    };
  }, [open, isHrAdmin, user]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const submit = async () => {
    if (!vacancyId || !recruiterId) {
      toast.error("Выберите воронку и рекрутёра");
      return;
    }
    setSaving(true);
    try {
      await takeApplication(Number(vacancyId), {
        entity_id: entityId,
        recruiter_id: Number(recruiterId),
      });
      const vt = vacancies.find((v) => v.id === vacancyId)?.title || "воронку";
      const rn =
        recruiters.find((r) => r.id === recruiterId)?.name || "рекрутёра";
      toast.success(`Забрали в «${vt}» → ${rn}`);
      setOpen(false);
      onDone?.({ vacancyId: Number(vacancyId), recruiterId: Number(recruiterId) });
    } catch (e) {
      toast.error(getErrorDetail(e, "Не удалось забрать"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="hf-profile-action-btn disabled:opacity-50"
        title="Забрать кандидата в воронку на выбранного рекрутёра"
      >
        {saving ? (
          <Loader2 className="hf-profile-action-icon animate-spin" />
        ) : (
          <Grab className="hf-profile-action-icon" />
        )}
        Забрать
      </button>
      {open && (
        <div className="hf-profile-vacancy-menu absolute top-full left-0 mt-1 w-72 z-50 p-3">
          <div className="text-[13px] font-semibold text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)] mb-2">
            Забрать кандидата
          </div>

          <label className="block text-[11px] text-[var(--hf-main-500)] mb-1">
            В какую воронку
          </label>
          <div className="relative mb-3">
            <select
              value={vacancyId}
              onChange={(e) => setVacancyId(Number(e.target.value) || "")}
              className="w-full appearance-none text-sm rounded-hf-s border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-bg-dark)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)] pl-2 pr-7 py-2"
            >
              <option value="">Выберите…</option>
              {vacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--hf-main-500)]" />
          </div>

          <label className="block text-[11px] text-[var(--hf-main-500)] mb-1">
            Кому отдать
          </label>
          <div className="relative mb-3">
            <select
              value={recruiterId}
              onChange={(e) => setRecruiterId(Number(e.target.value) || "")}
              className="w-full appearance-none text-sm rounded-hf-s border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-10)] bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-bg-dark)] text-[var(--hf-main-900)] hf-dark-disabled:text-[var(--hf-white)] pl-2 pr-7 py-2"
            >
              <option value="">Выберите…</option>
              {recruiters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.id === user?.id ? " (я)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--hf-main-500)]" />
          </div>

          <button
            onClick={submit}
            disabled={saving || !vacancyId || !recruiterId}
            className="w-full text-sm font-semibold rounded-hf-s py-2 text-white disabled:opacity-50"
            style={{ background: "var(--hf-status-green)" }}
          >
            {saving ? "Забираю…" : "Забрать"}
          </button>
        </div>
      )}
    </div>
  );
}
