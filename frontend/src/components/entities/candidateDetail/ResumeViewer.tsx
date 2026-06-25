// ================================================================
// ResumeViewer — общий просмотрщик резюме (вкладки + распарсенный hh-вид +
// PDF + сканы). Вынесен из AllCandidatesPage.ResumeTab, чтобы воронка и
// «Все кандидаты» показывали резюме ОДИНАКОВО (1-в-1, см. эталон photo 4),
// без двух разных реализаций. Чистая выборка источников — в model.buildResumeSources.
//
// Принимает KanbanCard; сам грузит файлы кандидата (getEntityFiles) и сам
// рисует верхнюю полосу вкладок «Резюме» (по одной на источник). Когда резюме
// нет — рендерит компактную заглушку (внешние страницы дают свой контекст).
// ================================================================
import { memo, useEffect, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Maximize2,
  Printer,
  Type,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import toast from "react-hot-toast";
import type { KanbanCard } from "@/services/api/candidates";
import {
  downloadEntityFile,
  getEntityFiles,
  type EntityFile,
} from "@/services/api/entities";
import { buildResumeSources, type ResumeSource, type ResumeDemoData } from "./model";

// ── Локальные форматтеры (копия из AllCandidatesPage — общий util вынесем позже) ──

function getInitials(name: string): string {
  const p = (name || "").trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return (p[0]?.[0] || "?").toUpperCase();
}

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleString("ru", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatResumeSaved(dateStr: string): string {
  const date = new Date(dateStr);
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} в ${hours}:${minutes}`;
}

function formatPhoneDisplay(phone?: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const match = digits.match(/^7(\d{3})(\d{3})(\d{4})$/);
  if (match) return `+7 ${match[1]} ${match[2]} ${match[3]}`;
  return phone;
}

// Загружает файлы кандидата и вычисляет список источников резюме (через
// чистый model.buildResumeSources) + preview-URL для картинок.
function useResumeSources(card: KanbanCard, refreshKey?: number): {
  files: EntityFile[];
  sources: ResumeSource[];
  loading: boolean;
  previewUrls: Record<number, string>;
} {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    setLoading(true);
    getEntityFiles(card.id)
      .then((data) => {
        setFiles(data);
        data
          .filter((f) => f.mime_type?.startsWith("image/"))
          .forEach(async (f) => {
            try {
              const blob = await downloadEntityFile(card.id, f.id);
              setPreviewUrls((prev) => ({ ...prev, [f.id]: URL.createObjectURL(blob) }));
            } catch {
              /* ignore */
            }
          });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [card.id, refreshKey]);

  const sources: ResumeSource[] = buildResumeSources(
    files,
    card.extra_data as Record<string, unknown> | undefined,
  );

  return { files, sources, loading, previewUrls };
}

/**
 * Общий просмотрщик резюме. Сам рисует полосу вкладок (по одной на источник) и
 * контент выбранного источника. Контент-рендер — verbatim из AllCandidatesPage.ResumeTab.
 */
const ResumeViewer = memo(function ResumeViewer({ card }: { card: KanbanCard }) {
  const { files, sources, loading, previewUrls } = useResumeSources(card);
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentResumeIndex, setCurrentResumeIndex] = useState(0);

  const resumeFiles = files.filter((f) => f.file_type === "resume");
  const pdfFile = resumeFiles.find((f) => f.mime_type === "application/pdf");
  const pdfFiles = resumeFiles
    .filter((f) => f.mime_type === "application/pdf")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const currentPdf = pdfFiles[0] || pdfFile;
  const imageFiles = resumeFiles.filter((f) => f.mime_type?.startsWith("image/"));
  const resumeDemo = card.extra_data?.resume_demo as ResumeDemoData | undefined;
  const resumeDemos = (
    Array.isArray(card.extra_data?.resume_demos)
      ? (card.extra_data.resume_demos as ResumeDemoData[])
      : resumeDemo
        ? [resumeDemo]
        : []
  ).filter(Boolean);
  const resumeCarouselLength = resumeDemos.length > 0 ? 3 : imageFiles.length || 1;
  const hasPreviousResume = currentResumeIndex > 0;
  const hasNextResume = currentResumeIndex < resumeCarouselLength - 1;

  useEffect(() => {
    setActiveIndex(0);
    setCurrentResumeIndex(0);
  }, [card.id]);

  useEffect(() => {
    setCurrentResumeIndex((index) => Math.min(index, Math.max(0, resumeCarouselLength - 1)));
  }, [resumeCarouselLength]);

  const handleDownload = async (file: EntityFile) => {
    try {
      const blob = await downloadEntityFile(card.id, file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.file_name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "file_content_lost") {
        toast.error("Файл утерян на сервере. Перезагрузите резюме кандидата.", { duration: 6000 });
      } else {
        toast.error("Не удалось скачать файл");
      }
    }
  };

  const handlePrint = () => {
    if (imageFiles.length > 0) {
      const urls = imageFiles.map((f) => previewUrls[f.id]).filter(Boolean);
      if (urls.length === 0) {
        toast.error("Загрузка...");
        return;
      }
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<html><body style="margin:0">${urls.map((u) => `<img src="${u}" style="width:100%;page-break-after:always"/>`).join("")}</body></html>`,
        );
        w.document.close();
        w.onload = () => w.print();
      }
    } else if (pdfFile) {
      handleDownload(pdfFile);
    } else {
      toast("Нет исходного файла для печати");
    }
  };

  const handleShowText = () => toast("Текст резюме уже показан");
  const handleDemoDownload = () => {
    if (pdfFile) {
      handleDownload(pdfFile);
      return;
    }
    toast("Нет исходного файла для скачивания");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--hf-dark-500)]" />
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="w-12 h-12 text-[var(--hf-dark-600)] mb-3" />
        <p className="text-sm text-[var(--hf-dark-400)]">Нет загруженных резюме</p>
      </div>
    );
  }

  const safeSourceIndex = Math.min(activeIndex, Math.max(0, sources.length - 1));
  const selectedSource = sources[safeSourceIndex];

  let parsedContent: ReactNode = null;
  if (resumeDemos.length > 0) {
    const currentDemo = resumeDemos[0];
    const currentResumePage = currentResumeIndex + 1;
    const savedAt = currentDemo.saved_at || card.created_at;
    const vacancyTitle = currentDemo.vacancy_title || card.vacancy_name || card.position || "Вакансия";
    const desiredTitle = currentDemo.title || card.position || "Кандидат";
    const salary = currentDemo.salary || card.salary || "";
    const birthDate = card.extra_data?.birth_date as string | undefined;
    const candidateDetails = [card.age, birthDate ? `родился(лась) ${birthDate}` : ""]
      .filter(Boolean)
      .join(", ");
    const contactLines = [
      formatPhoneDisplay(card.phone),
      card.email,
      card.telegram_username ? `telegram: @${card.telegram_username.replace(/^@/, "")}` : "",
    ].filter(Boolean);
    const profileLines = [
      card.city ? `Проживает: ${card.city}` : "",
      card.source ? `Источник: ${card.source}` : "",
    ].filter(Boolean);
    const resumeSections = currentDemo.sections || [];
    const renderResumeSection = (
      section: { title: string; lines: string[] },
      index: number,
      className = index === 0 ? "mt-[40px]" : "mt-[34px]",
    ) => (
      <section key={`${section.title}-${index}`} className={className}>
        <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
          {section.title}
        </h4>
        <div className="mt-[10px] space-y-[4px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
          {(section.lines || []).map((line, lineIndex) => (
            <p key={`${section.title}-${lineIndex}`}>{line}</p>
          ))}
        </div>
      </section>
    );

    parsedContent = (
      <div className="pt-[var(--hf-space-xxl)] max-w-[1180px]">
        <div className="overflow-hidden rounded-[16px] border border-[color:var(--hf-black-alpha-10)] bg-[var(--hf-white)] hf-dark-disabled:bg-[var(--hf-white-alpha-04)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)]">
          <div className="rounded-t-[16px] bg-[var(--hf-main-50)] px-[var(--hf-space-xxl)] pt-[var(--hf-space-xxl)] pb-[27px] hf-dark-disabled:bg-[var(--hf-white-alpha-03)]">
            <p className="mb-[20px] text-[length:var(--hf-fs-xxs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-main-900)] hf-dark-disabled:text-[color:var(--hf-white-alpha-45)]">
              Сохранено {formatResumeSaved(savedAt)}
            </p>
            <div className="flex items-center gap-[var(--hf-space-s)]">
              <button type="button" onClick={handleShowText} className="hf-resume-action-btn">
                <Type className="hf-resume-action-icon" />
                <span className="hf-resume-action-label">Показать текст</span>
              </button>
              <button type="button" onClick={handlePrint} className="hf-resume-action-btn">
                <Printer className="hf-resume-action-icon" />
                <span className="hf-resume-action-label">Распечатать</span>
              </button>
              <button type="button" onClick={handleDemoDownload} className="hf-resume-action-btn">
                <Download className="hf-resume-action-icon" />
                <span className="hf-resume-action-label">Скачать</span>
              </button>
            </div>
          </div>

          <div className="relative bg-transparent px-[100px] pt-[36px] pb-[58px] hf-dark-disabled:bg-[var(--hf-white-alpha-02)]">
            <button
              type="button"
              aria-label="Предыдущее резюме"
              onClick={() => setCurrentResumeIndex((index) => Math.max(0, index - 1))}
              disabled={!hasPreviousResume}
              className={clsx(
                "absolute left-[36px] top-[52%] flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-full bg-[var(--hf-white-alpha-90)] shadow-[0_1px_2px_var(--hf-alpha-150)] transition-colors",
                hasPreviousResume
                  ? "text-[var(--hf-ui-resume-arrow)] hover:bg-[var(--hf-white)] hover:text-[var(--hf-main-900)] active:bg-[var(--hf-main-200)]"
                  : "cursor-default text-[var(--hf-ui-resume-arrow-off)] opacity-70",
              )}
            >
              <ChevronLeft className="h-[20px] w-[20px]" />
            </button>
            <button
              type="button"
              aria-label="Следующее резюме"
              onClick={() => setCurrentResumeIndex((index) => Math.min(resumeCarouselLength - 1, index + 1))}
              disabled={!hasNextResume}
              className={clsx(
                "absolute right-[36px] top-[52%] flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-full bg-[var(--hf-white-alpha-90)] shadow-[0_1px_2px_var(--hf-alpha-150)] transition-colors",
                hasNextResume
                  ? "text-[var(--hf-ui-resume-arrow)] hover:bg-[var(--hf-white)] hover:text-[var(--hf-main-900)] active:bg-[var(--hf-main-200)]"
                  : "cursor-default text-[var(--hf-ui-resume-arrow-off)] opacity-70",
              )}
            >
              <ChevronRight className="h-[20px] w-[20px]" />
            </button>
            <button
              type="button"
              aria-label="Развернуть"
              className="absolute right-[52px] top-[42px] rounded-[6px] p-[4px] text-[var(--hf-ui-expand-icon)] transition-colors hover:bg-[var(--hf-black-alpha-04)] hover:text-[var(--hf-main-900)] active:bg-[var(--hf-black-alpha-07)]"
            >
              <Maximize2 className="h-[21px] w-[21px]" />
            </button>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentResumePage}
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="mx-auto min-h-[880px] w-full max-w-[980px] bg-[var(--hf-white)] text-[var(--hf-main-900)] shadow-[0_12px_30px_var(--hf-alpha-200)]"
              >
                <div className="flex h-[66px] items-center justify-between bg-[var(--hf-ui-divider)] px-[66px] text-[length:var(--hf-fs-xs)] leading-[var(--hf-lh-secondary)] text-[var(--hf-ui-resume-text)]">
                  <div>
                    <div>Отклик на вакансию: «{vacancyTitle}»</div>
                    <div className="mt-[4px] text-[length:var(--hf-fs-2xs)] text-[var(--hf-ui-resume-muted)]">
                      {formatResumeSaved(savedAt)}
                    </div>
                  </div>
                  <span className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[var(--hf-red-600)] text-[length:var(--hf-fs-xs)] font-bold text-[var(--hf-white)]">
                    hh
                  </span>
                </div>

                <div className="px-[66px] pb-[64px] pt-[34px]">
                  {currentResumePage === 1 ? (
                    <>
                      <div className="flex gap-[var(--hf-space-xxl)]">
                        {card.photo_url ? (
                          <img
                            src={card.photo_url}
                            alt=""
                            className="mt-[2px] h-[92px] w-[92px] flex-shrink-0 rounded-[2px] object-cover"
                          />
                        ) : (
                          <div className="mt-[2px] flex h-[92px] w-[92px] flex-shrink-0 items-center justify-center rounded-[2px] bg-[var(--hf-ui-avatar-dark)] text-[24px] font-semibold text-[var(--hf-ui-text-avatar-blue)]">
                            {getInitials(card.name)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="text-[40px] font-bold leading-[46px] tracking-normal">{card.name}</h3>
                          <p className="mt-[2px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)] text-[var(--hf-ui-resume-secondary)]">
                            {candidateDetails}
                          </p>
                          <div className="mt-[16px] space-y-[1px] text-[length:var(--hf-fs-s)] leading-[21px]">
                            {contactLines.map((line) => (
                              <p key={line}>{line}</p>
                            ))}
                          </div>
                          <div className="mt-[18px] space-y-[1px] text-[length:var(--hf-fs-s)] leading-[21px]">
                            {profileLines.map((line) => (
                              <p key={line}>{line}</p>
                            ))}
                          </div>
                        </div>
                      </div>

                      <section className="mt-[42px]">
                        <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
                          Желаемая должность и зарплата
                        </h4>
                        <div className="mt-[8px] flex items-start justify-between gap-[var(--hf-space-xxl)]">
                          <div className="text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
                            <p className="text-[20px] font-bold leading-[26px]">{desiredTitle}</p>
                            <p className="mt-[6px]">Специализации:</p>
                            <p className="pl-[30px]">— Тестировщик</p>
                            <p className="mt-[6px]">Тип занятости: полная занятость</p>
                            <p>Формат работы: на месте работодателя</p>
                            <p>Желательное время в пути до работы: не имеет значения</p>
                          </div>
                          <div className="flex-shrink-0 pt-[2px] text-right">
                            {salary ? (
                              <>
                                <span className="text-[24px] font-bold leading-[30px]">{salary}</span>
                                <span className="ml-[4px] text-[length:var(--hf-fs-xxs)] leading-[18px]">на руки</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </section>

                      {resumeSections.slice(0, 2).map((section, index) => renderResumeSection(section, index))}
                    </>
                  ) : currentResumePage === 2 ? (
                    <>
                      {resumeSections
                        .slice(2)
                        .map((section, index) => renderResumeSection(section, index + 2, index === 0 ? "" : "mt-[34px]"))}
                    </>
                  ) : (
                    <>
                      <section>
                        <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
                          Данные резюме
                        </h4>
                        <div className="mt-[16px] space-y-[8px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
                          <p>{card.name}</p>
                          {card.position ? <p>{card.position}</p> : null}
                          {card.company ? <p>{card.company}</p> : null}
                          {card.source ? <p>Источник: {card.source}</p> : null}
                        </div>
                      </section>
                      <section className="mt-[42px]">
                        <h4 className="border-b border-[var(--hf-ui-line)] pb-[2px] text-[length:var(--hf-fs-m)] font-normal leading-[var(--hf-lh-primary)] text-[var(--hf-ui-resume-muted)]">
                          Резюме обновлено {formatResumeSaved(savedAt)}
                        </h4>
                        <div className="mt-[18px] text-[length:var(--hf-fs-s)] leading-[var(--hf-lh-field)]">
                          <p>{card.name} • Резюме обновлено {formatResumeSaved(savedAt)}</p>
                        </div>
                      </section>
                    </>
                  )}
                  <div className="mt-[36px] text-right text-[length:var(--hf-fs-2xs)] leading-[18px] text-[var(--hf-ui-resume-muted)]">
                    Страница {currentResumePage}/{resumeCarouselLength}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  }

  const buildFileContent = (pdf: EntityFile | undefined) => (
    <div className="py-hf-l max-w-[1180px]">
      <p className="text-hf-3xs text-[var(--hf-main-600)] hf-dark-disabled:text-[color:var(--hf-white-alpha-40)] mb-hf-m">
        Сохранено {formatDateFull(resumeFiles[0]?.created_at || card.created_at)}
      </p>
      <div className="flex items-center gap-hf-s mb-hf-l">
        {card.source_url && (
          <button
            onClick={() => window.open(card.source_url!, "_blank")}
            className="inline-flex items-center gap-1.5 h-[30px] px-hf-m border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)] rounded-hf-s text-hf-3xs text-[var(--hf-main-700)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
          >
            <Eye className="w-3.5 h-3.5" /> Открыть источник
          </button>
        )}
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 h-[30px] px-hf-m border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)] rounded-hf-s text-hf-3xs text-[var(--hf-main-700)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
        >
          <Printer className="w-3.5 h-3.5" /> Распечатать
        </button>
        {pdf && (
          <button
            onClick={() => handleDownload(pdf)}
            className="inline-flex items-center gap-1.5 h-[30px] px-hf-m border border-[color:var(--hf-main-200)] hf-dark-disabled:border-[color:var(--hf-white-alpha-08)] rounded-hf-s text-hf-3xs text-[var(--hf-main-700)] hf-dark-disabled:text-[color:var(--hf-white-alpha-55)] hover:text-[var(--hf-main-900)] hf-dark-disabled:hover:text-[var(--hf-white)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Скачать PDF
          </button>
        )}
      </div>
      {imageFiles.length > 0 && !pdf ? (
        <div className="space-y-3">
          {imageFiles.map((f) => (
            <div
              key={f.id}
              className="bg-[var(--hf-white-alpha-02)] border border-[color:var(--hf-white-alpha-06)] rounded-lg overflow-hidden"
            >
              {previewUrls[f.id] ? (
                <img src={previewUrls[f.id]} alt={f.file_name} className="w-full" />
              ) : (
                <div className="p-8 text-center text-[var(--hf-dark-500)] text-sm">Загрузка...</div>
              )}
            </div>
          ))}
        </div>
      ) : pdf ? (
        <div className="space-y-2">
          <iframe
            key={pdf.id}
            src={`/api/entities/${card.id}/files/${pdf.id}/download#toolbar=0&navpanes=0`}
            title={pdf.file_name}
            className="w-full min-h-[760px] rounded-lg border border-[color:var(--hf-white-alpha-06)] bg-white"
          />
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-[var(--hf-dark-500)]">
            <span className="truncate">
              {pdf.file_name} · {(pdf.file_size / 1024).toFixed(0)} КБ
              {pdf.created_at ? ` · загружено ${formatDateFull(pdf.created_at)}` : ""}
            </span>
            <button
              onClick={() => handleDownload(pdf)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--hf-accent-bg-20)] text-[var(--hf-accent)] rounded-lg hover:bg-[var(--hf-accent-bg-30)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Скачать
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-[var(--hf-white-alpha-02)] border border-[color:var(--hf-white-alpha-06)] rounded-lg p-8 text-center text-[var(--hf-dark-500)] text-sm">
          {resumeFiles.map((f) => (
            <p key={f.id}>{f.file_name}</p>
          ))}
        </div>
      )}
    </div>
  );

  let selectedContent: ReactNode;
  if (selectedSource?.kind === "parsed") {
    selectedContent = parsedContent;
  } else if (selectedSource?.kind === "pdf") {
    selectedContent = buildFileContent(selectedSource.file);
  } else if (selectedSource?.kind === "images") {
    selectedContent = buildFileContent(undefined);
  } else {
    selectedContent = buildFileContent(currentPdf);
  }

  return (
    <div className="flex flex-col">
      {/* Полоса вкладок: по одной «Резюме» на источник (как эталон photo 4). */}
      <div className="flex flex-wrap gap-1 border-b border-[color:var(--hf-white-alpha-06)] px-5">
        {sources.map((s, i) => (
          <button
            key={`${s.kind}-${i}`}
            type="button"
            onClick={() => setActiveIndex(i)}
            className={clsx(
              "px-3 py-2.5 text-sm border-b-2 transition-colors flex items-center gap-1.5",
              i === safeSourceIndex
                ? "border-[var(--hf-accent)] text-[var(--hf-dark-100)]"
                : "border-transparent text-[var(--hf-dark-400)] hover:text-[var(--hf-dark-200)]",
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            Резюме
          </button>
        ))}
      </div>
      <div className="px-5">{selectedContent}</div>
    </div>
  );
});

export default ResumeViewer;
