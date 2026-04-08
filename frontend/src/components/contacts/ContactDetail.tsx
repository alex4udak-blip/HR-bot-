import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase,
  ArrowRightLeft,
  User,
  Plus,
  X,
  FileText,
  Loader2,
  Clock,
  ChevronRight,
  StickyNote,
  Check,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { EntityWithRelations } from '@/types';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { EntityStatus } from '@/types';
import { formatSalary, formatDate } from '@/utils';
import AddToVacancyModal from '../entities/AddToVacancyModal';
import EntityVacancies from '../entities/EntityVacancies';
import EntityFiles from '../entities/EntityFiles';
import DuplicateWarning from '../entities/DuplicateWarning';
import RedFlagsPanel from '../entities/RedFlagsPanel';
import PrometheusDetailedReview from '../contacts/PrometheusDetailedReview';
import { EmptyCalls } from '@/components/ui';
import * as api from '@/services/api';
import { useEntityStore } from '@/stores/entityStore';
import { useAuthStore } from '@/stores/authStore';
import { FeatureGatedButton } from '@/components/auth/FeatureGate';

// ---- Inline Tag Editor ----
function TagEditor({ entityId, tags, onUpdated }: { entityId: number; tags: string[]; onUpdated: () => void }) {
  const [adding, setAdding] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  const persist = async (newTags: string[]) => {
    setSaving(true);
    try {
      await api.updateEntity(entityId, { tags: newTags });
      onUpdated();
    } catch {
      toast.error('Ошибка обновления тегов');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (index: number) => {
    const next = tags.filter((_, i) => i !== index);
    persist(next);
  };

  const handleAdd = () => {
    const value = inputValue.trim();
    if (!value) return;
    if (tags.includes(value)) {
      toast.error('Тег уже существует');
      return;
    }
    persist([...tags, value]);
    setInputValue('');
    setAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
    if (e.key === 'Escape') { setAdding(false); setInputValue(''); }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-4">
      {tags.map((tag, i) => (
        <span key={i} className="group flex items-center gap-1 px-2 py-0.5 bg-white/[0.06] text-white/50 text-[11px] rounded-md">
          {tag}
          <button
            onClick={() => handleRemove(i)}
            disabled={saving}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white/70 disabled:opacity-30"
            title="Удалить тег"
          >
            <X size={10} />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (!inputValue.trim()) { setAdding(false); } }}
            placeholder="тег..."
            className="w-24 px-1.5 py-0.5 bg-white/[0.06] border border-white/10 rounded-md text-[11px] text-white placeholder-white/30 outline-none focus:border-cyan-500/50"
            disabled={saving}
          />
          <button
            onClick={handleAdd}
            disabled={saving || !inputValue.trim()}
            className="px-1.5 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] rounded-md disabled:opacity-40 transition-colors"
          >
            OK
          </button>
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={saving}
          className="flex items-center gap-0.5 px-2 py-0.5 bg-white/[0.04] hover:bg-white/[0.08] text-white/30 hover:text-white/50 text-[11px] rounded-md transition-colors border border-dashed border-white/10"
        >
          <Plus size={10} /> тег
        </button>
      )}

      {saving && <Loader2 size={12} className="animate-spin text-white/30 ml-1" />}
    </div>
  );
}

interface ContactDetailProps {
  entity: EntityWithRelations;
  showAIInOverview?: boolean;
}

// Statuses for the "Сменить этап" dropdown
const CANDIDATE_STATUSES: EntityStatus[] = [
  'new', 'screening', 'practice', 'tech_practice', 'is_interview', 'offer', 'hired', 'rejected', 'withdrawn'
];

export default function ContactDetail({ entity }: ContactDetailProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'calls' | 'vacancies' | 'files' | 'red_flags' | 'prometheus' | 'history'>(entity.type === 'candidate' ? 'vacancies' : 'files');

  // State
  const [vacanciesKey, setVacanciesKey] = useState(0);
  const [showAddToVacancyModal, setShowAddToVacancyModal] = useState(false);
  const [resumeImages, setResumeImages] = useState<{ id: number; url: string; name: string }[]>([]);
  const [resumeImagesLoading, setResumeImagesLoading] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);


  const { fetchEntity } = useEntityStore();
  const { isAdmin } = useAuthStore();

  // Entity-level notes (stored in extra_data.notes)
  const [notes, setNotes] = useState(() => String(entity.extra_data?.notes || ''));
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync notes when entity changes externally
  useEffect(() => {
    setNotes(String(entity.extra_data?.notes || ''));
  }, [entity.id, entity.extra_data?.notes]);

  const saveNotes = useCallback(async (value: string) => {
    const currentNotes = String(entity.extra_data?.notes || '');
    if (value === currentNotes) return;
    setNotesSaving(true);
    try {
      await api.updateEntity(entity.id, {
        extra_data: { ...(entity.extra_data || {}), notes: value },
      });
      setNotesSaved(true);
      fetchEntity(entity.id);
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
      notesTimerRef.current = setTimeout(() => setNotesSaved(false), 2000);
    } catch {
      toast.error('Ошибка сохранения заметки');
    } finally {
      setNotesSaving(false);
    }
  }, [entity.id, entity.extra_data, fetchEntity]);

  // Load photo from entity files
  useEffect(() => {
    let mounted = true;
    const loadPhoto = async () => {
      const files = entity.files || [];
      const photoFile = files.find(f =>
        (f.file_type === 'portfolio' || f.file_type === 'other') &&
        f.mime_type?.startsWith('image/') &&
        !f.file_name.toLowerCase().includes('резюме') &&
        !f.file_name.toLowerCase().includes('resume') &&
        !f.file_name.toLowerCase().includes('cv')
      ) || files.find(f =>
        f.mime_type?.startsWith('image/') &&
        (f.file_name.toLowerCase().includes('фото') ||
         f.file_name.toLowerCase().includes('photo') ||
         f.file_name.toLowerCase().includes('avatar'))
      );
      if (photoFile) {
        try {
          const blob = await api.downloadEntityFile(entity.id, photoFile.id);
          if (mounted) setPhotoUrl(URL.createObjectURL(blob));
        } catch { /* ignore */ }
      }
    };
    loadPhoto();
    return () => {
      mounted = false;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [entity.id, entity.files]);

  // Load resume files as inline images
  useEffect(() => {
    let mounted = true;
    setResumeImagesLoading(true);

    const loadResumeImages = async () => {
      try {
        const files = entity.files || [];
        const resumeFiles = files.filter(f =>
          f.file_type === 'resume' &&
          (f.mime_type?.startsWith('image/') ||
           f.file_name.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i))
        );

        const images = await Promise.all(
          resumeFiles.map(async (file) => {
            try {
              const blob = await api.downloadEntityFile(entity.id, file.id);
              return { id: file.id, url: URL.createObjectURL(blob), name: file.file_name };
            } catch {
              return null;
            }
          })
        );

        if (mounted) {
          setResumeImages(images.filter(Boolean) as { id: number; url: string; name: string }[]);
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setResumeImagesLoading(false);
      }
    };

    loadResumeImages();
    return () => {
      mounted = false;
      resumeImages.forEach(img => URL.revokeObjectURL(img.url));
    };
  }, [entity.id, entity.files]);

  // Helpers
  const getExtraData = (key: string): string => {
    const val = entity.extra_data?.[key];
    return typeof val === 'string' ? val : '';
  };

  const getExtraDataNumber = (key: string): number | null => {
    const val = entity.extra_data?.[key];
    return typeof val === 'number' ? val : null;
  };

  // Status change handler
  const handleStatusChange = async (newStatus: EntityStatus) => {
    setStatusUpdating(true);
    try {
      await api.updateEntityStatus(entity.id, newStatus);
      toast.success(`Статус изменён: ${STATUS_LABELS[newStatus]}`);
      fetchEntity(entity.id);
    } catch {
      toast.error('Ошибка смены статуса');
    } finally {
      setStatusUpdating(false);
      setShowStatusDropdown(false);
    }
  };


  // Extra data fields
  const summary = getExtraData('summary');
  const location = getExtraData('location');
  const experienceYears = getExtraDataNumber('experience_years');
  const dateOfBirth = getExtraData('date_of_birth');
  const gender = getExtraData('gender');
  const character = getExtraData('character');

  const salary = (entity.expected_salary_min || entity.expected_salary_max)
    ? formatSalary(entity.expected_salary_min, entity.expected_salary_max, entity.expected_salary_currency)
    : null;

  // Info rows: label → value
  const infoRows: { label: string; value: string; href?: string }[] = [];
  if (salary) infoRows.push({ label: 'Зарплата', value: salary });
  const phones = entity.phones?.length ? entity.phones : entity.phone ? [entity.phone] : [];
  if (phones.length) infoRows.push({ label: 'Телефон', value: phones.join(', '), href: `tel:${phones[0]}` });
  const emails = entity.emails?.length ? entity.emails : entity.email ? [entity.email] : [];
  if (emails.length) infoRows.push({ label: 'Эл. почта', value: emails.join(', '), href: `mailto:${emails[0]}` });
  if (entity.telegram_usernames?.length) infoRows.push({ label: 'Telegram', value: entity.telegram_usernames.map(u => `@${u}`).join(', '), href: `https://t.me/${entity.telegram_usernames[0]}` });
  if (location) infoRows.push({ label: 'Город', value: location });
  if (entity.company) infoRows.push({ label: 'Компания', value: entity.company });
  if (entity.position) infoRows.push({ label: 'Должность', value: entity.position });
  if (dateOfBirth) infoRows.push({ label: 'Дата рождения', value: dateOfBirth });
  if (gender) infoRows.push({ label: 'Пол', value: gender });
  if (experienceYears) infoRows.push({ label: 'Опыт', value: `${experienceYears} лет` });

  const tabs = [
    { id: 'calls', label: `Звонки (${entity.calls?.length || 0})` },
    ...(entity.type === 'candidate' ? [{ id: 'vacancies', label: 'Вакансии' }] : []),
    { id: 'files', label: 'Файлы' },
    { id: 'red_flags', label: 'Red Flags' },
    { id: 'prometheus', label: 'Prometheus' },
    { id: 'history', label: 'История' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5 overflow-x-hidden">
      {/* Duplicate Warning */}
      {entity.type === 'candidate' && (
        <DuplicateWarning
          entityId={entity.id}
          entityName={entity.name}
          isAdmin={isAdmin()}
          isTransferred={entity.is_transferred}
          onMergeComplete={() => fetchEntity(entity.id)}
        />
      )}

      {/* ===== TOP CARD: Name + Photo + Info rows ===== */}
      <div className="rounded-xl p-5 sm:p-6 border border-white/[0.06] bg-white/[0.02]">
        <div className="flex gap-5">
          {/* Left: name + info */}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4 leading-tight">{entity.name}</h2>

            {/* Info rows — simple label: value */}
            <div className="space-y-2">
              {infoRows.map(row => (
                <div key={row.label} className="flex items-baseline gap-3 text-sm">
                  <span className="text-white/40 w-28 flex-shrink-0">{row.label}</span>
                  {row.href ? (
                    <a href={row.href} target="_blank" rel="noopener noreferrer" className="text-white hover:text-cyan-400 transition-colors truncate">
                      {row.value}
                    </a>
                  ) : (
                    <span className="text-white truncate">{row.value}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Tags — editable */}
            <TagEditor entityId={entity.id} tags={entity.tags || []} onUpdated={() => fetchEntity(entity.id)} />
          </div>

          {/* Right: photo */}
          <div className="flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={entity.name}
                className="w-24 h-28 sm:w-28 sm:h-32 rounded-xl object-cover border border-white/[0.08]"
              />
            ) : (
              <div className="w-24 h-28 sm:w-28 sm:h-32 rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 border border-white/[0.08] flex items-center justify-center">
                <span className="text-2xl sm:text-3xl font-bold text-white/60 select-none">
                  {entity.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== STATUS BLOCK with "Сменить этап" ===== */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <span className={clsx(
              'text-lg font-semibold px-3 py-1 rounded-lg inline-block',
              STATUS_COLORS[entity.status]
            )}>
              {STATUS_LABELS[entity.status]}
            </span>
            {entity.department_name && (
              <p className="text-sm text-white/40 mt-1.5">{entity.department_name}</p>
            )}
          </div>

          {/* Сменить этап */}
          <div className="relative">
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              disabled={statusUpdating}
              className="px-4 py-2 bg-green-500 hover:bg-green-400 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {statusUpdating ? 'Сохранение...' : 'Сменить этап'}
            </button>
            {showStatusDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-gray-900 border border-white/10 rounded-xl shadow-xl overflow-hidden">
                  {CANDIDATE_STATUSES.map(st => (
                    <button
                      key={st}
                      onClick={() => handleStatusChange(st)}
                      className={clsx(
                        'w-full text-left px-4 py-2.5 text-sm hover:bg-white/[0.06] transition-colors',
                        entity.status === st ? 'text-cyan-400 bg-white/[0.04]' : 'text-white/70'
                      )}
                    >
                      {STATUS_LABELS[st]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Transferred notice */}
        {entity.is_transferred && (
          <div className="px-5 pb-3">
            <div className="p-2.5 bg-orange-500/10 border border-orange-500/20 rounded-lg text-xs text-orange-300 flex items-center gap-2">
              <ArrowRightLeft size={14} />
              Передан → {entity.transferred_to_name || 'другому пользователю'}
            </div>
          </div>
        )}
      </div>

      {/* ===== DESCRIPTION / CHARACTER ===== */}
      {(summary || character) && (
        <div className="rounded-xl p-5 border border-white/[0.06] bg-white/[0.02] space-y-3">
          {summary && (
            <div>
              <h3 className="text-sm font-medium text-white/50 mb-1">Описание</h3>
              <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{summary}</p>
            </div>
          )}
          {character && (
            <div>
              <h3 className="text-sm font-medium text-white/50 mb-1">Характер</h3>
              <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{character}</p>
            </div>
          )}
        </div>
      )}

      {/* ===== ENTITY NOTES ===== */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
            <StickyNote size={14} />
            Заметки
          </h3>
          <div className="flex items-center gap-2 text-xs text-white/30">
            {notesSaving && <Loader2 size={12} className="animate-spin" />}
            {notesSaved && <span className="flex items-center gap-1 text-green-400"><Check size={12} /> Сохранено</span>}
          </div>
        </div>
        <div className="p-4">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => saveNotes(notes)}
            placeholder="Добавьте заметки о контакте..."
            rows={3}
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80 placeholder-white/20 outline-none focus:border-cyan-500/40 resize-y min-h-[72px] transition-colors"
          />
        </div>
      </div>

      {/* ===== RESUME SCREENSHOTS (CV inline) ===== */}
      {entity.type === 'candidate' && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-medium text-white/60">Резюме</h3>
          </div>
          <div className="p-4">
            {resumeImagesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-white/30" />
              </div>
            ) : resumeImages.length > 0 ? (
              <div className="space-y-4">
                {resumeImages.map(img => (
                  <div key={img.id} className="rounded-lg overflow-hidden border border-white/[0.06]">
                    <img
                      src={img.url}
                      alt={img.name}
                      className="w-full h-auto"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-white/30 text-sm">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Нет скриншотов резюме</p>
                <p className="text-xs mt-1 text-white/20">Загрузите скриншот резюме (JPG, PNG) во вкладке «Файлы»</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== TABS ===== */}
      <div className="flex gap-0 border-b border-white/[0.06] overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-white/40 hover:text-white/70'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'calls' && (
          <div className="rounded-xl p-4 border border-white/[0.06] bg-white/[0.02]">
            <h3 className="font-medium mb-3">Звонки</h3>
            {entity.calls?.length > 0 ? (
              <div className="space-y-2">
                {entity.calls.map(call => (
                  <button
                    key={call.id}
                    onClick={() => navigate(`/calls/${call.id}`)}
                    className="w-full text-left p-3 rounded-lg hover:bg-white/[0.04] border border-white/[0.06] flex items-center justify-between"
                  >
                    <div>
                      <span className="text-sm text-white/80 truncate">{call.summary || 'Звонок'}</span>
                      <span className="block text-xs text-white/30 mt-0.5">{formatDate(call.created_at, 'short')}</span>
                    </div>
                    <ChevronRight size={16} className="text-white/30 flex-shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyCalls />
            )}
          </div>
        )}

        {activeTab === 'vacancies' && entity.type === 'candidate' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <Briefcase size={16} className="text-cyan-400" />
                Вакансии кандидата
              </h3>
              <FeatureGatedButton
                feature="candidate_database"
                onClick={() => setShowAddToVacancyModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs transition-colors"
              >
                <Plus size={14} /> Добавить в вакансию
              </FeatureGatedButton>
            </div>
            <EntityVacancies
              key={vacanciesKey}
              entityId={entity.id}
            />
          </div>
        )}

        {activeTab === 'files' && (
          <EntityFiles entityId={entity.id} />
        )}

        {activeTab === 'red_flags' && (
          <RedFlagsPanel entityId={entity.id} />
        )}

        {activeTab === 'prometheus' && (
          <PrometheusDetailedReview entityId={entity.id} />
        )}

        {activeTab === 'history' && (
          <div className="rounded-xl p-4 border border-white/[0.06] bg-white/[0.02]">
            <h3 className="font-medium mb-3">История</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-white/40">
                <Clock size={14} />
                <span>Создан: {formatDate(entity.created_at, 'long')}</span>
              </div>
              <div className="flex items-center gap-2 text-white/40">
                <Clock size={14} />
                <span>Обновлён: {formatDate(entity.updated_at, 'long')}</span>
              </div>
              {entity.owner_name && (
                <div className="flex items-center gap-2 text-white/40">
                  <User size={14} />
                  <span>Ответственный: {entity.owner_name}</span>
                </div>
              )}
              {entity.transfers?.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-xs text-white/30 uppercase tracking-wide">Передачи</h4>
                  {entity.transfers.map(t => (
                    <div key={t.id} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs text-white/50">
                      {t.from_user_name} → {t.to_user_name}
                      {t.comment && <span className="block text-white/30 mt-1">{t.comment}</span>}
                      <span className="block text-white/20 mt-1">{formatDate(t.created_at, 'short')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add to Vacancy Modal */}
      {showAddToVacancyModal && (
        <AddToVacancyModal
          entityId={entity.id}
          entityName={entity.name}
          onClose={() => setShowAddToVacancyModal(false)}
          onSuccess={() => {
            setShowAddToVacancyModal(false);
            setVacanciesKey(k => k + 1);
            toast.success('Кандидат добавлен в вакансию');
          }}
        />
      )}
    </div>
  );
}
