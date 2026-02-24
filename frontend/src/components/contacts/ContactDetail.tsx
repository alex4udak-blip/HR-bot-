import { useState, useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  Mail,
  MessageSquare,
  Building2,
  Briefcase,
  ArrowRightLeft,
  FileText,
  ChevronRight,
  Tag,
  User,
  Link2,
  X,
  Loader2,
  AtSign,
  Download,
  Target,
  Plus,
  FolderOpen,
  AlertTriangle,
  Brain,
  RefreshCw,
  Flame
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { EntityWithRelations, Chat, CallRecording, VacancyApplication } from '@/types';
import { EmptyChats, EmptyCalls } from '@/components/ui';
import { STATUS_LABELS, STATUS_COLORS, CALL_STATUS_LABELS, CALL_STATUS_COLORS } from '@/types';
import { formatSalary, formatDate } from '@/utils';
import EntityAI from './EntityAI';
import CriteriaPanelEntity from './CriteriaPanelEntity';
import AddToVacancyModal from '../entities/AddToVacancyModal';
import EntityVacancies from '../entities/EntityVacancies';
import RecommendedVacancies from '../entities/RecommendedVacancies';
import EntityFiles from '../entities/EntityFiles';
import RedFlagsPanel from '../entities/RedFlagsPanel';
import SimilarCandidates from '../entities/SimilarCandidates';
import DuplicateWarning from '../entities/DuplicateWarning';
import InteractionTimeline from '../entities/InteractionTimeline';
import * as api from '@/services/api';
import type { AIProfile } from '@/services/api';
import { useEntityStore } from '@/stores/entityStore';
import { useAuthStore } from '@/stores/authStore';
import { FeatureGatedButton } from '@/components/auth/FeatureGate';
import { useCanAccessFeature } from '@/hooks/useCanAccessFeature';
import type { Entity } from '@/types';

interface ContactDetailProps {
  entity: EntityWithRelations;
  showAIInOverview?: boolean;
}

// Reducer for modal states (logically related - one modal at a time)
type ModalType = 'none' | 'linkChat' | 'linkCall' | 'addToVacancy';

interface ModalState {
  activeModal: ModalType;
  unlinkedChats: Chat[];
  unlinkedCalls: CallRecording[];
}

type ModalAction =
  | { type: 'OPEN_MODAL'; modal: ModalType }
  | { type: 'CLOSE_MODAL' }
  | { type: 'SET_UNLINKED_CHATS'; chats: Chat[] }
  | { type: 'SET_UNLINKED_CALLS'; calls: CallRecording[] };

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case 'OPEN_MODAL':
      return { ...state, activeModal: action.modal };
    case 'CLOSE_MODAL':
      return { ...state, activeModal: 'none' };
    case 'SET_UNLINKED_CHATS':
      return { ...state, unlinkedChats: action.chats };
    case 'SET_UNLINKED_CALLS':
      return { ...state, unlinkedCalls: action.calls };
    default:
      return state;
  }
}

const initialModalState: ModalState = {
  activeModal: 'none',
  unlinkedChats: [],
  unlinkedCalls: []
};

// Reducer for async operations (loading states that are mutually exclusive)
interface AsyncState {
  loadingData: boolean;
  loadingLink: boolean;
  downloadingReport: string | null;
}

type AsyncAction =
  | { type: 'START_LOADING_DATA' }
  | { type: 'STOP_LOADING_DATA' }
  | { type: 'START_LOADING_LINK' }
  | { type: 'STOP_LOADING_LINK' }
  | { type: 'START_DOWNLOAD'; format: string }
  | { type: 'STOP_DOWNLOAD' };

function asyncReducer(state: AsyncState, action: AsyncAction): AsyncState {
  switch (action.type) {
    case 'START_LOADING_DATA':
      return { ...state, loadingData: true };
    case 'STOP_LOADING_DATA':
      return { ...state, loadingData: false };
    case 'START_LOADING_LINK':
      return { ...state, loadingLink: true };
    case 'STOP_LOADING_LINK':
      return { ...state, loadingLink: false };
    case 'START_DOWNLOAD':
      return { ...state, downloadingReport: action.format };
    case 'STOP_DOWNLOAD':
      return { ...state, downloadingReport: null };
    default:
      return state;
  }
}

const initialAsyncState: AsyncState = {
  loadingData: false,
  loadingLink: false,
  downloadingReport: null
};

export default function ContactDetail({ entity, showAIInOverview = true }: ContactDetailProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'chats' | 'calls' | 'vacancies' | 'files' | 'history' | 'criteria' | 'reports' | 'red-flags' | 'prometheus'>('overview');

  // Reducers for related states
  const [modalState, dispatchModal] = useReducer(modalReducer, initialModalState);
  const [asyncState, dispatchAsync] = useReducer(asyncReducer, initialAsyncState);

  // Independent states that don't need reducer
  const [vacanciesKey, setVacanciesKey] = useState(0); // Key to force reload vacancies
  const [entityApplications, setEntityApplications] = useState<VacancyApplication[]>([]);

  // AI Profile state
  const [aiProfile, setAiProfile] = useState<AIProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [generatingProfile, setGeneratingProfile] = useState(false);

  const { fetchEntity } = useEntityStore();
  const { canAccessFeature } = useCanAccessFeature();
  const { isAdmin, canEditResource, canAccessDepartment } = useAuthStore();

  // Check if user can edit this entity (considering is_transferred and department access)
  const canEditEntity = (e: EntityWithRelations | Entity): boolean => {
    // Transferred entities are read-only
    if (e.is_transferred) return false;

    // Check department access
    if (!canAccessDepartment(e.department_id)) return false;

    // Check resource-level permissions
    return canEditResource({
      owner_id: e.owner_id,
      is_mine: e.is_mine,
      access_level: e.access_level
    });
  };

  // Load unlinked chats when modal opens
  useEffect(() => {
    if (modalState.activeModal === 'linkChat') {
      loadUnlinkedChats();
    }
  }, [modalState.activeModal]);

  // Load unlinked calls when modal opens
  useEffect(() => {
    if (modalState.activeModal === 'linkCall') {
      loadUnlinkedCalls();
    }
  }, [modalState.activeModal]);

  // Load entity applications for timeline
  useEffect(() => {
    let isMounted = true;

    const loadApplications = async () => {
      try {
        const data = await api.getEntityVacancies(entity.id);
        if (isMounted) {
          setEntityApplications(data);
        }
      } catch (e) {
        if (isMounted) {
          console.error('Failed to load entity applications:', e);
        }
      }
    };
    loadApplications();

    return () => {
      isMounted = false;
    };
  }, [entity.id, vacanciesKey]);

  // Load AI profile for candidates
  useEffect(() => {
    if (entity.type !== 'candidate') return;

    let isMounted = true;

    const loadProfile = async () => {
      setProfileLoading(true);
      try {
        const data = await api.getEntityProfile(entity.id);
        if (isMounted && data?.profile) {
          setAiProfile(data.profile);
        }
      } catch {
        // Profile not found is expected for new candidates
        if (isMounted) {
          setAiProfile(null);
        }
      } finally {
        if (isMounted) {
          setProfileLoading(false);
        }
      }
    };
    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [entity.id, entity.type]);

  // Handler for generating/updating AI profile
  const handleGenerateProfile = async () => {
    setGeneratingProfile(true);
    try {
      const data = await api.generateEntityProfile(entity.id);
      if (data?.profile) {
        setAiProfile(data.profile);
        toast.success('AI профиль обновлён');
      }
    } catch {
      toast.error('Не удалось создать профиль');
    } finally {
      setGeneratingProfile(false);
    }
  };

  const loadUnlinkedChats = async () => {
    dispatchAsync({ type: 'START_LOADING_DATA' });
    try {
      const allChats = await api.getChats();
      dispatchModal({ type: 'SET_UNLINKED_CHATS', chats: allChats.filter(c => !c.entity_id) });
    } catch (e) {
      console.error('Failed to load chats:', e);
    } finally {
      dispatchAsync({ type: 'STOP_LOADING_DATA' });
    }
  };

  const loadUnlinkedCalls = async () => {
    dispatchAsync({ type: 'START_LOADING_DATA' });
    try {
      const allCalls = await api.getCalls({});
      dispatchModal({ type: 'SET_UNLINKED_CALLS', calls: allCalls.filter(c => !c.entity_id) });
    } catch (e) {
      console.error('Failed to load calls:', e);
    } finally {
      dispatchAsync({ type: 'STOP_LOADING_DATA' });
    }
  };

  const handleLinkChat = async (chatId: number) => {
    dispatchAsync({ type: 'START_LOADING_LINK' });
    try {
      await api.linkChatToEntity(entity.id, chatId);
      toast.success('Чат привязан к контакту');
      dispatchModal({ type: 'CLOSE_MODAL' });
      fetchEntity(entity.id);
    } catch (e) {
      toast.error('Не удалось привязать чат');
    } finally {
      dispatchAsync({ type: 'STOP_LOADING_LINK' });
    }
  };

  const handleLinkCall = async (callId: number) => {
    dispatchAsync({ type: 'START_LOADING_LINK' });
    try {
      await api.linkCallToEntity(callId, entity.id);
      toast.success('Звонок привязан к контакту');
      dispatchModal({ type: 'CLOSE_MODAL' });
      fetchEntity(entity.id);
    } catch (e) {
      toast.error('Не удалось привязать звонок');
    } finally {
      dispatchAsync({ type: 'STOP_LOADING_LINK' });
    }
  };


  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownloadReport = async (format: string) => {
    if (asyncState.downloadingReport) return;

    dispatchAsync({ type: 'START_DOWNLOAD', format });
    try {
      const blob = await api.downloadEntityReport(entity.id, 'full_analysis', format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${entity.name}_${entity.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Отчёт скачан');
    } catch {
      toast.error('Ошибка скачивания');
    } finally {
      dispatchAsync({ type: 'STOP_DOWNLOAD' });
    }
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-x-hidden">
      {/* Duplicate Warning - only for candidates */}
      {entity.type === 'candidate' && (
        <DuplicateWarning
          entityId={entity.id}
          entityName={entity.name}
          isAdmin={isAdmin()}
          isTransferred={entity.is_transferred}
          onMergeComplete={() => fetchEntity(entity.id)}
        />
      )}

      {/* Contact Info Card */}
      <div className="glass rounded-xl p-4 sm:p-6 border border-white/10">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="w-12 h-12 sm:w-16 sm:h-16 aspect-square rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center flex-shrink-0 border border-white/10">
            <User size={24} className="text-white sm:hidden" />
            <User size={32} className="text-white hidden sm:block" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
              <h2 className="text-lg sm:text-2xl font-bold text-white truncate max-w-full">{entity.name}</h2>
              <span className={clsx('text-xs sm:text-sm px-2 sm:px-3 py-0.5 sm:py-1 rounded-full flex-shrink-0 whitespace-nowrap', STATUS_COLORS[entity.status])}>
                {STATUS_LABELS[entity.status]}
              </span>
            </div>

            {/* Transferred entity indicator */}
            {entity.is_transferred && (
              <div className="mb-4 p-3 bg-orange-500/20 border border-orange-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-orange-300">
                  <ArrowRightLeft size={16} className="flex-shrink-0" />
                  <span className="text-sm font-medium">
                    Контакт передан → {entity.transferred_to_name || 'другому пользователю'}
                  </span>
                </div>
                {entity.transferred_at && (
                  <p className="text-xs text-orange-300/70 mt-1 ml-6">
                    {formatDate(entity.transferred_at, 'long')}
                  </p>
                )}
                <p className="text-xs text-orange-300/70 mt-1 ml-6">
                  Это копия только для просмотра. Редактирование недоступно.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {/* Telegram usernames */}
              {entity.telegram_usernames && entity.telegram_usernames.length > 0 && (
                <div className="flex items-start gap-2 text-white/60 min-w-0">
                  <AtSign size={16} className="flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {entity.telegram_usernames.map((username, idx) => (
                      <a
                        key={idx}
                        href={`https://t.me/${username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-cyan-400 transition-colors"
                      >
                        @{username}{idx < entity.telegram_usernames!.length - 1 && ','}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {/* Emails (array first, fallback to single) */}
              {(entity.emails && entity.emails.length > 0) ? (
                <div className="flex items-start gap-2 text-white/60 min-w-0">
                  <Mail size={16} className="flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {entity.emails.map((email, idx) => (
                      <a
                        key={idx}
                        href={`mailto:${email}`}
                        className="hover:text-cyan-400 transition-colors truncate"
                      >
                        {email}{idx < entity.emails!.length - 1 && ','}
                      </a>
                    ))}
                  </div>
                </div>
              ) : entity.email && (
                <a
                  href={`mailto:${entity.email}`}
                  className="flex items-center gap-2 text-white/60 hover:text-cyan-400 transition-colors min-w-0"
                >
                  <Mail size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.email}</span>
                </a>
              )}
              {/* Phones (array first, fallback to single) */}
              {(entity.phones && entity.phones.length > 0) ? (
                <div className="flex items-start gap-2 text-white/60 min-w-0">
                  <Phone size={16} className="flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {entity.phones.map((phone, idx) => (
                      <a
                        key={idx}
                        href={`tel:${phone}`}
                        className="hover:text-cyan-400 transition-colors"
                      >
                        {phone}{idx < entity.phones!.length - 1 && ','}
                      </a>
                    ))}
                  </div>
                </div>
              ) : entity.phone && (
                <a
                  href={`tel:${entity.phone}`}
                  className="flex items-center gap-2 text-white/60 hover:text-cyan-400 transition-colors min-w-0"
                >
                  <Phone size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.phone}</span>
                </a>
              )}
              {entity.company && (
                <div className="flex items-center gap-2 text-white/60 min-w-0">
                  <Building2 size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.company}</span>
                </div>
              )}
              {entity.position && (
                <div className="flex items-center gap-2 text-white/60 min-w-0">
                  <Briefcase size={16} className="flex-shrink-0" />
                  <span className="truncate">{entity.position}</span>
                </div>
              )}
              {/* Expected salary for candidates */}
              {entity.type === 'candidate' && (entity.expected_salary_min || entity.expected_salary_max) && (
                <div className="flex items-center gap-2 text-white/60 min-w-0">
                  <span className="truncate text-green-400">
                    {formatSalary(entity.expected_salary_min, entity.expected_salary_max, entity.expected_salary_currency)}
                  </span>
                </div>
              )}
              {/* Owner and department info */}
              {(entity.owner_name || entity.department_name) && (
                <div className="flex items-center gap-4 text-white/40 mt-2">
                  {entity.owner_name && (
                    <span className="flex items-center gap-1" title="Владелец">
                      <User size={14} />
                      <span>Владелец: {entity.owner_name}</span>
                    </span>
                  )}
                  {entity.department_name && (
                    <span className="flex items-center gap-1" title="Департамент">
                      <Building2 size={14} />
                      <span>{entity.department_name}</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            {entity.tags && entity.tags.length > 0 && (
              <div className="flex items-center gap-2 mt-4">
                <Tag size={16} className="text-white/40" />
                <div className="flex flex-wrap gap-2">
                  {entity.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-white/10 text-white/60 text-xs rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="glass rounded-xl p-1 sm:p-1.5 flex flex-wrap gap-1 border border-white/10 overflow-x-auto">
        {[
          { id: 'overview', label: 'Обзор' },
          { id: 'chats', label: `Чаты (${entity.chats?.length || 0})`, shortLabel: `Чаты` },
          { id: 'calls', label: `Звонки (${entity.calls?.length || 0})`, shortLabel: `Звонки` },
          { id: 'vacancies', label: 'Вакансии', icon: Briefcase, onlyForCandidates: true },
          { id: 'files', label: 'Файлы', icon: FolderOpen },
          { id: 'criteria', label: 'Критерии', icon: Target },
          { id: 'reports', label: 'Отчёты', icon: Download },
          { id: 'red-flags', label: 'Red Flags', icon: AlertTriangle, onlyForCandidates: true },
          { id: 'prometheus', label: 'Prometheus', icon: Flame },
          { id: 'history', label: 'История' }
        ]
        .filter((tab) => {
          // Filter out tabs that are only for candidates
          if ('onlyForCandidates' in tab && tab.onlyForCandidates) {
            return entity.type === 'candidate';
          }
          return true;
        })
        .map((tab) => {
          const Icon = 'icon' in tab ? tab.icon : null;
          const shortLabel = 'shortLabel' in tab ? tab.shortLabel : tab.label;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={clsx(
                'px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5',
                activeTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-400 shadow-sm'
                  : 'text-white/60 hover:bg-white/5 hover:text-white/80'
              )}
            >
              {Icon && <Icon size={14} className="flex-shrink-0" />}
              <span className={clsx(Icon && 'hidden sm:inline', 'sm:hidden')}>{shortLabel}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'overview' && (
          <>
            {/* AI Assistant - only show if showAIInOverview is true */}
            {showAIInOverview && <EntityAI entity={entity} />}

            {/* AI Profile Status - only for candidates */}
            {entity.type === 'candidate' && (
              <div className="glass rounded-xl p-4 border border-white/10 mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={clsx(
                      "p-2 rounded-lg",
                      profileLoading ? "bg-white/10" : aiProfile ? "bg-green-500/20" : "bg-yellow-500/20"
                    )}>
                      {profileLoading ? (
                        <Loader2 size={18} className="text-white/50 animate-spin" />
                      ) : (
                        <Brain size={18} className={aiProfile ? "text-green-400" : "text-yellow-400"} />
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-white">AI Профиль</h4>
                      {profileLoading ? (
                        <p className="text-xs text-white/50">Загрузка...</p>
                      ) : aiProfile ? (
                        <p className="text-xs text-white/50">
                          Обновлён {formatDate(aiProfile.generated_at, 'short')}
                          {aiProfile.context_sources && (
                            <span className="ml-1">
                              {' '}&bull; {aiProfile.context_sources.files_count} файлов, {aiProfile.context_sources.chats_count} чатов, {aiProfile.context_sources.calls_count} звонков
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-yellow-400/80">Профиль не создан</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleGenerateProfile}
                    disabled={generatingProfile || profileLoading}
                    className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50",
                      aiProfile
                        ? "bg-white/10 text-white/80 hover:bg-white/20"
                        : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                    )}
                  >
                    {generatingProfile ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {aiProfile ? "Обновить" : "Создать"}
                  </button>
                </div>
              </div>
            )}

            <div className={clsx("grid grid-cols-1 2xl:grid-cols-2 gap-4 items-start", showAIInOverview && "mt-6")}>
            {/* Recent Chats */}
            <div className="glass rounded-xl p-4 h-fit border border-white/10">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-base font-semibold text-white flex items-center gap-2 min-w-0">
                  <MessageSquare size={18} className="text-cyan-400 flex-shrink-0" />
                  <span className="truncate">Последние чаты</span>
                </h3>
                {canEditEntity(entity) && (
                  <button
                    onClick={() => dispatchModal({ type: 'OPEN_MODAL', modal: 'linkChat' })}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors flex-shrink-0 whitespace-nowrap"
                  >
                    <Link2 size={12} />
                    Привязать
                  </button>
                )}
              </div>
              {entity.chats && entity.chats.length > 0 ? (
                <div className="space-y-2">
                  {entity.chats.slice(0, 3).map((chat) => (
                    <div
                      key={chat.id}
                      onClick={() => navigate(`/chats/${chat.id}`)}
                      className="p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{chat.title}</p>
                        <p className="text-xs text-white/40 truncate">{formatDate(chat.created_at, 'long')}</p>
                      </div>
                      <ChevronRight size={16} className="text-white/40 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyChats onLink={canEditEntity(entity) ? () => dispatchModal({ type: 'OPEN_MODAL', modal: 'linkChat' }) : undefined} />
              )}
            </div>

            {/* Recent Calls */}
            <div className="glass rounded-xl p-4 h-fit border border-white/10">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-base font-semibold text-white flex items-center gap-2 min-w-0">
                  <Phone size={18} className="text-green-400 flex-shrink-0" />
                  <span className="truncate">Последние звонки</span>
                </h3>
                {canEditEntity(entity) && (
                  <button
                    onClick={() => dispatchModal({ type: 'OPEN_MODAL', modal: 'linkCall' })}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors flex-shrink-0 whitespace-nowrap"
                  >
                    <Link2 size={12} />
                    Привязать
                  </button>
                )}
              </div>
              {entity.calls && entity.calls.length > 0 ? (
                <div className="space-y-2">
                  {entity.calls.slice(0, 3).map((call) => (
                    <div
                      key={call.id}
                      onClick={() => navigate(`/calls/${call.id}`)}
                      className="p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full', CALL_STATUS_COLORS[call.status])}>
                          {CALL_STATUS_LABELS[call.status]}
                        </span>
                        <span className="text-xs text-white/40">
                          {formatDuration(call.duration_seconds)}
                        </span>
                      </div>
                      <p className="text-xs text-white/40">{formatDate(call.created_at, 'long')}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyCalls onLink={canEditEntity(entity) ? () => dispatchModal({ type: 'OPEN_MODAL', modal: 'linkCall' }) : undefined} />
              )}
            </div>

            {/* Recommended Vacancies - for all candidates (filtered by user's accessible vacancies on backend) */}
            {entity.type === 'candidate' && (
              <div className="glass rounded-xl p-4 xl:col-span-2 h-fit border border-white/10">
                <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <Target size={18} className="text-purple-400" />
                  Подходящие вакансии
                </h3>
                <RecommendedVacancies
                  entityId={entity.id}
                  entityName={entity.name}
                  onApply={() => setVacanciesKey(prev => prev + 1)}
                />
              </div>
            )}

            {/* Similar Candidates - only for candidates */}
            {entity.type === 'candidate' && (
              <div className="glass rounded-xl p-4 xl:col-span-2 h-fit border border-white/10">
                <SimilarCandidates
                  entityId={entity.id}
                  entityName={entity.name}
                />
              </div>
            )}

            {/* Transfer History */}
            <div className="glass rounded-xl p-4 xl:col-span-2 h-fit border border-white/10">
              <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <ArrowRightLeft size={18} className="text-purple-400" />
                История передач
              </h3>
              {entity.transfers && entity.transfers.length > 0 ? (
                <div className="space-y-2">
                  {entity.transfers.slice(0, 5).map((transfer) => (
                    <div key={transfer.id} className="p-3 bg-white/5 rounded-lg">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-white/60">{transfer.from_user_name || 'Неизвестно'}</span>
                        <ArrowRightLeft size={14} className="text-white/40" />
                        <span className="text-white">{transfer.to_user_name || 'Неизвестно'}</span>
                      </div>
                      {transfer.comment && (
                        <p className="text-xs text-white/40 mt-1">{transfer.comment}</p>
                      )}
                      <p className="text-xs text-white/30 mt-1">{formatDate(transfer.created_at, 'long')}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/40 text-sm">Нет истории передач</p>
              )}
            </div>
          </div>
          </>
        )}

        {activeTab === 'chats' && (
          <div className="space-y-2">
            {entity.chats && entity.chats.length > 0 ? (
              entity.chats.map((chat) => (
                <motion.div
                  key={chat.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => navigate(`/chats/${chat.id}`)}
                  className="p-4 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 bg-cyan-500/20 rounded-lg flex-shrink-0">
                      <MessageSquare size={20} className="text-cyan-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium truncate">{chat.title}</p>
                      <p className="text-sm text-white/40 truncate">
                        {chat.chat_type} • Создан {formatDate(chat.created_at, 'long')}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-white/40 flex-shrink-0" />
                </motion.div>
              ))
            ) : (
              <EmptyChats onLink={canEditEntity(entity) ? () => dispatchModal({ type: 'OPEN_MODAL', modal: 'linkChat' }) : undefined} />
            )}
          </div>
        )}

        {activeTab === 'calls' && (
          <div className="space-y-2">
            {entity.calls && entity.calls.length > 0 ? (
              entity.calls.map((call) => (
                <motion.div
                  key={call.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => navigate(`/calls/${call.id}`)}
                  className="p-4 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="p-2 bg-green-500/20 rounded-lg flex-shrink-0">
                        <Phone size={20} className="text-green-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">
                          Звонок {call.source_type.toUpperCase()}
                        </p>
                        <p className="text-sm text-white/40 truncate">{formatDate(call.created_at, 'long')}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full whitespace-nowrap', CALL_STATUS_COLORS[call.status])}>
                        {CALL_STATUS_LABELS[call.status]}
                      </span>
                      <p className="text-sm text-white/60 mt-1">
                        {formatDuration(call.duration_seconds)}
                      </p>
                    </div>
                  </div>
                  {call.summary && (
                    <p className="text-sm text-white/60 line-clamp-2 mt-2">{call.summary}</p>
                  )}
                </motion.div>
              ))
            ) : (
              <EmptyCalls onLink={canEditEntity(entity) ? () => dispatchModal({ type: 'OPEN_MODAL', modal: 'linkCall' }) : undefined} />
            )}
          </div>
        )}

        {activeTab === 'vacancies' && canAccessFeature('candidate_database') && (
          <div className="glass rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Briefcase size={18} className="text-blue-400" />
                Вакансии
              </h3>
              {entity.type === 'candidate' && canEditEntity(entity) && (
                <FeatureGatedButton
                  feature="candidate_database"
                  onClick={() => dispatchModal({ type: 'OPEN_MODAL', modal: 'addToVacancy' })}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors disabled:bg-blue-600/50 disabled:hover:bg-blue-600/50"
                  disabledTooltip="You don't have access to this feature"
                >
                  <Plus size={16} />
                  Добавить в вакансию
                </FeatureGatedButton>
              )}
            </div>
            <EntityVacancies key={vacanciesKey} entityId={entity.id} />
          </div>
        )}

        {activeTab === 'files' && (
          <div className="glass rounded-xl border border-white/10 p-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2 mb-4">
              <FolderOpen size={18} className="text-green-400" />
              Файлы
            </h3>
            <EntityFiles entityId={entity.id} canEdit={canEditEntity(entity)} />
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Interaction Timeline */}
            <div className="glass rounded-xl border border-white/10 p-4">
              <InteractionTimeline
                entityId={entity.id}
                chats={entity.chats?.map(chat => ({
                  id: chat.id,
                  title: chat.title || 'Чат'
                }))}
                calls={entity.calls?.map(call => ({
                  id: call.id,
                  title: 'Звонок',
                  duration_seconds: call.duration_seconds,
                  created_at: call.created_at,
                  summary: call.summary
                }))}
                files={entity.files?.map(file => ({
                  id: file.id,
                  file_name: file.file_name,
                  file_type: file.file_type,
                  created_at: file.created_at
                }))}
                applications={entityApplications?.map(app => ({
                  id: app.id,
                  vacancy_title: app.vacancy_title || 'Вакансия',
                  stage: app.stage,
                  applied_at: app.applied_at,
                  updated_at: app.updated_at
                }))}
              />
            </div>

            {/* Transfers */}
            {entity.transfers && entity.transfers.length > 0 && (
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-sm font-medium text-white/60 mb-3 flex items-center gap-2">
                  <ArrowRightLeft size={16} className="text-purple-400" />
                  Передачи между сотрудниками
                </h4>
                <div className="space-y-2">
                  {entity.transfers.map((transfer) => (
                    <div key={transfer.id} className="p-3 bg-white/5 rounded-lg flex items-start gap-3">
                      <div className="p-2 bg-purple-500/20 rounded-lg">
                        <ArrowRightLeft size={16} className="text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-white/60">{transfer.from_user_name}</span>
                          <span className="text-white/30">→</span>
                          <span className="text-white">{transfer.to_user_name}</span>
                        </div>
                        {transfer.comment && (
                          <p className="text-xs text-white/50 mt-1">{transfer.comment}</p>
                        )}
                        <p className="text-xs text-white/30 mt-1">{formatDate(transfer.created_at, 'long')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analyses */}
            {entity.analyses && entity.analyses.length > 0 && (
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-sm font-medium text-white/60 mb-3 flex items-center gap-2">
                  <FileText size={16} className="text-cyan-400" />
                  AI Анализы
                </h4>
                <div className="space-y-2">
                  {entity.analyses.map((analysis) => (
                    <div key={analysis.id} className="p-3 bg-white/5 rounded-lg flex items-start gap-3">
                      <div className="p-2 bg-cyan-500/20 rounded-lg">
                        <FileText size={16} className="text-cyan-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-white font-medium">
                          {analysis.report_type || 'Анализ'}
                        </p>
                        {analysis.result && (
                          <p className="text-xs text-white/50 mt-1 line-clamp-2">{analysis.result}</p>
                        )}
                        <p className="text-xs text-white/30 mt-1">{formatDate(analysis.created_at, 'long')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'criteria' && (
          <div className="glass rounded-xl border border-white/10 overflow-hidden">
            <CriteriaPanelEntity entityId={entity.id} entityType={entity.type} />
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="glass rounded-xl border border-white/10 p-4">
            <div className="space-y-4">
              <div className="glass-light rounded-xl p-4">
                <h3 className="font-semibold mb-3">Создать отчёт</h3>
                <p className="text-sm text-dark-400 mb-4">
                  Скачайте полный аналитический отчёт по этому контакту
                </p>
                {asyncState.downloadingReport && (
                  <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-accent-500/10 text-accent-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Генерация отчёта... Это может занять до минуты</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleDownloadReport('pdf')}
                    disabled={!!asyncState.downloadingReport}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-wait transition-colors"
                  >
                    {asyncState.downloadingReport === 'pdf' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    PDF
                  </button>
                  <button
                    onClick={() => handleDownloadReport('docx')}
                    disabled={!!asyncState.downloadingReport}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-wait transition-colors"
                  >
                    {asyncState.downloadingReport === 'docx' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    DOCX
                  </button>
                  <button
                    onClick={() => handleDownloadReport('markdown')}
                    disabled={!!asyncState.downloadingReport}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-wait transition-colors"
                  >
                    {asyncState.downloadingReport === 'markdown' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Markdown
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'prometheus' && (
          <div className="glass rounded-xl border border-white/10 p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Flame size={18} className="text-orange-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Prometheus</h3>
                <p className="text-xs text-white/50">Статистика прохождения курсов на платформе</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white/5 rounded-lg p-3 border border-white/5">
                  <p className="text-xs text-white/40 mb-1">Курсы пройдены</p>
                  <p className="text-lg font-semibold text-white">—</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/5">
                  <p className="text-xs text-white/40 mb-1">Средний балл</p>
                  <p className="text-lg font-semibold text-white">—</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/5">
                  <p className="text-xs text-white/40 mb-1">Сертификаты</p>
                  <p className="text-lg font-semibold text-white">—</p>
                </div>
              </div>

              <div className="text-center py-8">
                <Flame className="w-12 h-12 mx-auto mb-3 text-orange-400/30" />
                <p className="text-sm text-white/40">
                  Данные с платформы Prometheus ещё не загружены
                </p>
                <p className="text-xs text-white/30 mt-1">
                  Здесь будет отображаться резюме кандидата по результатам курсов
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'red-flags' && entity.type === 'candidate' && (
          <div className="glass rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-red-400" />
              <h3 className="text-base font-semibold text-white">
                Анализ Red Flags
              </h3>
            </div>
            <p className="text-sm text-white/60 mb-4">
              Автоматическая проверка кандидата на потенциальные тревожные сигналы с использованием AI-анализа.
            </p>
            <RedFlagsPanel entityId={entity.id} />
          </div>
        )}
      </div>

      {/* Link Chat Modal */}
      <AnimatePresence>
        {modalState.activeModal === 'linkChat' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => dispatchModal({ type: 'CLOSE_MODAL' })}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md max-w-[calc(100%-2rem)] max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">Привязать чат</h3>
                <button
                  onClick={() => dispatchModal({ type: 'CLOSE_MODAL' })}
                  className="p-1 rounded-lg hover:bg-white/10"
                >
                  <X size={20} className="text-white/60" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 max-h-[60vh]">
                {asyncState.loadingData ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                  </div>
                ) : modalState.unlinkedChats.length === 0 ? (
                  <div className="text-center py-8 text-white/40">
                    <MessageSquare className="mx-auto mb-2" size={40} />
                    <p>Нет доступных чатов для привязки</p>
                    <p className="text-sm mt-1">Все чаты уже привязаны к контактам</p>
                  </div>
                ) : (
                  modalState.unlinkedChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => handleLinkChat(chat.id)}
                      disabled={asyncState.loadingLink}
                      className="w-full p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-left flex items-center justify-between gap-3 disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{chat.title}</p>
                        <p className="text-xs text-white/40 truncate">{chat.chat_type} • {formatDate(chat.created_at, 'long')}</p>
                      </div>
                      {asyncState.loadingLink ? (
                        <Loader2 size={16} className="text-cyan-400 animate-spin flex-shrink-0" />
                      ) : (
                        <Link2 size={16} className="text-cyan-400 flex-shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Link Call Modal */}
      <AnimatePresence>
        {modalState.activeModal === 'linkCall' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => dispatchModal({ type: 'CLOSE_MODAL' })}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md max-w-[calc(100%-2rem)] max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">Привязать звонок</h3>
                <button
                  onClick={() => dispatchModal({ type: 'CLOSE_MODAL' })}
                  className="p-1 rounded-lg hover:bg-white/10"
                >
                  <X size={20} className="text-white/60" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 max-h-[60vh]">
                {asyncState.loadingData ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
                  </div>
                ) : modalState.unlinkedCalls.length === 0 ? (
                  <div className="text-center py-8 text-white/40">
                    <Phone className="mx-auto mb-2" size={40} />
                    <p>Нет доступных звонков для привязки</p>
                    <p className="text-sm mt-1">Все звонки уже привязаны к контактам</p>
                  </div>
                ) : (
                  modalState.unlinkedCalls.map((call) => (
                    <button
                      key={call.id}
                      onClick={() => handleLinkCall(call.id)}
                      disabled={asyncState.loadingLink}
                      className="w-full p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-left flex items-center justify-between gap-3 disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">
                          Звонок {call.source_type?.toUpperCase() || 'N/A'}
                        </p>
                        <p className="text-xs text-white/40 truncate">
                          {formatDuration(call.duration_seconds)} • {formatDate(call.created_at, 'long')}
                        </p>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full mt-1 inline-block whitespace-nowrap', CALL_STATUS_COLORS[call.status])}>
                          {CALL_STATUS_LABELS[call.status]}
                        </span>
                      </div>
                      {asyncState.loadingLink ? (
                        <Loader2 size={16} className="text-green-400 animate-spin flex-shrink-0" />
                      ) : (
                        <Link2 size={16} className="text-green-400 flex-shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add to Vacancy Modal */}
      <AnimatePresence>
        {modalState.activeModal === 'addToVacancy' && (
          <AddToVacancyModal
            entityId={entity.id}
            entityName={entity.name}
            onClose={() => dispatchModal({ type: 'CLOSE_MODAL' })}
            onSuccess={() => {
              dispatchModal({ type: 'CLOSE_MODAL' });
              setVacanciesKey(prev => prev + 1); // Force reload vacancies
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
