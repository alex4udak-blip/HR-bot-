import { AlertTriangle } from "lucide-react";
import type { KanbanCard } from "@/services/api/candidates";
import type { TextTwinMeta } from "@/services/api/entities";

/**
 * Grey informational badge: "resume text nearly matches another candidate's".
 * Purely a hint for the recruiter to check manually — no action buttons.
 *
 * INDEPENDENT of ShadowDuplicateBanner / hidden_duplicate_id: a candidate can
 * have `extra_data.text_twin` set by the backend's resume_text_twin detector
 * without any identity-match `hidden_duplicate_id`. ShadowDuplicateBanner
 * early-returns null in that case (`if (!hiddenId || resolved) return null`),
 * so this badge is rendered as a SIBLING at the same call sites, not inside
 * that component, to make sure it still shows.
 */
interface TextTwinBadgeProps {
  card: Pick<KanbanCard, "extra_data">;
}

export default function TextTwinBadge({ card }: TextTwinBadgeProps) {
  const twin = (card.extra_data?.text_twin ?? null) as TextTwinMeta | null;
  if (!twin) return null;

  const pct = Math.round((twin.similarity ?? 0) * 100);

  return (
    <div className="flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-4 py-2 mb-4 text-sm text-gray-700">
      <AlertTriangle className="w-4 h-4 shrink-0 text-gray-500" />
      <span>
        Текст резюме совпадает с другим кандидатом ({pct}%) — проверьте вручную.
      </span>
    </div>
  );
}
