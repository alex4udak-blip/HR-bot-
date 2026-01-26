import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  UserCheck,
  Building2,
  Wrench,
  Target,
  User,
  Users,
  Phone,
  MessageSquare,
  ArrowRightLeft,
  ChevronLeft,
  Edit,
  Trash2,
  Bot,
  X,
  Share2,
  FolderOpen,
  Share,
  Globe,
  Upload,
  Briefcase
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import { useAuthStore } from '@/stores/authStore';
import type { EntityType, Entity } from '@/types';
import { ENTITY_TYPES, STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { OwnershipFilter, Department, ParsedResume } from '@/services/api';
import { getDepartments, getVacancies, getApplications } from '@/services/api';
import type { Vacancy } from '@/types';
import ContactForm from '@/components/contacts/ContactForm';
import TransferModal from '@/components/contacts/TransferModal';
import ContactDetail from '@/components/contacts/ContactDetail';
import EntityAI from '@/components/contacts/EntityAI';
import ShareModal from '@/components/common/ShareModal';
import ParserModal from '@/components/parser/ParserModal';
import ParseJobsPanel from '@/components/parser/ParseJobsPanel';
import { OnboardingTooltip } from '@/components/onboarding';
import { FeatureGatedButton } from '@/components/auth/FeatureGate';
import { useCanAccessFeature } from '@/hooks/useCanAccessFeature';

// Ownership filter options
const OWNERSHIP_FILTERS: { id: OwnershipFilter; name: string; icon: typeof FolderOpen; description: string }[] = [
  { id: 'all', name: 'Все', icon: Globe, description: 'Все доступные контакты' },
  { id: 'mine', name: 'Мои', icon: FolderOpen, description: 'Созданные мной' },
  { id: 'shared', name: 'Расшаренные', icon: Share, description: 'Расшаренные мне другими' },
];

// Entity type filter options
const ENTITY_TYPE_FILTERS: { id: EntityType | 'all'; name: string; icon: typeof Users }[] = [
  { id: 'all', name: 'Все', icon: Users },
  { id: 'candidate', name: 'Кандидаты', icon: UserCheck },
  { id: 'client', name: 'Клиенты', icon: Building2 },
  { id: 'contractor', name: 'Подрядчики', icon: Wrench },
  { id: 'lead', name: 'Лиды', icon: Target },
  { id: 'partner', name: 'Партнёры', icon: Users },
  { id: 'custom', name: 'Другие', icon: User },
];

export default function ContactsPage() {
  const { entityId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get('type') as EntityType | null;

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<EntityType | 'all'>(initialType || 'all');
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState<number | 'all'>('all');
  const [vacancyFilter, setVacancyFilter] = useState<number | 'all'>('all');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [vacancyEntityIds, setVacancyEntityIds] = useState<Set<number> | null>(null);
  const [vacancyFilterLoading, setVacancyFilterLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showParserModal, setShowParserModal] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [selectedEntityForTransfer, setSelectedEntityForTransfer] = useState<Entity | null>(null);
  const [prefillData, setPrefillData] = useState<Partial<Entity> | null>(null);
  const [parseJobsRefresh, setParseJobsRefresh] = useState(0);

  const {
    canEditResource,
    canDeleteResource,
    canShareResource,
    canAccessDepartment,
    isSuperAdmin,
    isOwner
  } = useAuthStore();

  const {
    entities,
    currentEntity,
    isLoading,
    fetchEntity,
    deleteEntity,
    setFilters,
    clearCurrentEntity,
    typeCounts,
    fetchTypeCounts
  } = useEntityStore();

  const { canAccessFeature } = useCanAccessFeature();

  // Helper functions to check permissions using authStore helpers
  const canEdit = (entity: Entity) => {
    // Transferred entities are read-only
    if (entity.is_transferred) return false;

    // Check department access - user must have access to entity's department
    if (!canAccessDepartment(entity.department_id)) return false;

    // Check based on ownership and access level
    return canEditResource({
      owner_id: entity.owner_id,
      is_mine: entity.is_mine,
      access_level: entity.access_level
    });
  };

  const canDelete = (entity: Entity) => {
    // Transferred entities cannot be deleted
    if (entity.is_transferred) return false;

    // Check department access - user must have access to entity's department
    if (!canAccessDepartment(entity.department_id)) return false;

    // Only owners can delete
    return canDeleteResource({
      owner_id: entity.owner_id,
      is_mine: entity.is_mine,
      access_level: entity.access_level
    });
  };

  const canShare = (entity: Entity) => {
    // Transferred entities cannot be shared
    if (entity.is_transferred) return false;

    // Check department access - user must have access to entity's department
    if (!canAccessDepartment(entity.department_id)) return false;

    // Check share permissions
    return canShareResource({
      owner_id: entity.owner_id,
      is_mine: entity.is_mine,
      access_level: entity.access_level
    });
  };

  const canTransfer = (entity: Entity) => {
    // Already transferred entities cannot be transferred again
    if (entity.is_transferred) return false;

    // Check department access - user must have access to entity's department
    if (!canAccessDepartment(entity.department_id)) return false;

    // Only owners can transfer
    return canDeleteResource({
      owner_id: entity.owner_id,
      is_mine: entity.is_mine,
      access_level: entity.access_level
    });
  };

  // Load departments, vacancies, and type counts on mount
  useEffect(() => {
    getDepartments().then(setDepartments).catch(console.error);
    getVacancies().then(setVacancies).catch(console.error);
    fetchTypeCounts(); // Load initial type counts
  }, [fetchTypeCounts]);

  // Load entity IDs when vacancy filter changes
  useEffect(() => {
    if (vacancyFilter === 'all') {
      setVacancyEntityIds(null);
      return;
    }

    setVacancyFilterLoading(true);
    getApplications(vacancyFilter)
      .then((applications) => {
        const entityIds = new Set(applications.map((app) => app.entity_id));
        setVacancyEntityIds(entityIds);
      })
      .catch((error) => {
        console.error('Failed to load vacancy applications:', error);
        setVacancyEntityIds(new Set());
      })
      .finally(() => {
        setVacancyFilterLoading(false);
      });
  }, [vacancyFilter]);

  // Load entities on mount and when any filter changes - single unified effect
  useEffect(() => {
    // Build complete filter object to avoid race conditions
    const newFilters = {
      type: typeFilter === 'all' ? undefined : typeFilter,
      ownership: ownershipFilter,
      department_id: departmentFilter === 'all' ? undefined : departmentFilter,
      search: searchQuery || undefined
    };
    setFilters(newFilters);
  }, [typeFilter, ownershipFilter, departmentFilter, setFilters]);

  // Debounced search - only updates when searchQuery changes
  useEffect(() => {
    if (searchQuery === '') {
      // If search is cleared, immediately update
      setFilters({ search: undefined });
      return;
    }

    const timeout = setTimeout(() => {
      setFilters({ search: searchQuery });
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, setFilters]);

  // Load specific entity when URL changes
  useEffect(() => {
    if (entityId) {
      fetchEntity(parseInt(entityId));
    } else {
      clearCurrentEntity();
    }
  }, [entityId, fetchEntity, clearCurrentEntity]);

  // Update type filter from URL
  useEffect(() => {
    if (initialType) {
      setTypeFilter(initialType);
    }
  }, [initialType]);

  const handleSelectEntity = (id: number) => {
    navigate(`/contacts/${id}`);
  };

  const handleBack = () => {
    navigate('/contacts');
  };

  const handleDelete = async (entity: Entity) => {
    if (!confirm(`Вы уверены, что хотите удалить "${entity.name}"?`)) return;

    try {
      await deleteEntity(entity.id);
      toast.success('Контакт удалён');
      if (currentEntity?.id === entity.id) {
        navigate('/contacts');
      }
    } catch {
      toast.error('Не удалось удалить контакт');
    }
  };

  const handleTransfer = (entity: Entity) => {
    setSelectedEntityForTransfer(entity);
    setShowTransferModal(true);
  };

  const handleEdit = (entity: Entity) => {
    setEditingEntity(entity);
    setShowCreateModal(true);
  };

  const handleParsedResume = (data: ParsedResume) => {
    // Convert parsed resume to prefill data for the form
    const prefill: Partial<Entity> = {
      type: 'candidate',
      name: data.name || '',
      email: data.email,
      phone: data.phone,
      telegram_usernames: data.telegram ? [data.telegram] : [],
      company: data.company,
      position: data.position,
      tags: data.skills || [],
      extra_data: {
        experience_years: data.experience_years,
        salary_min: data.salary_min,
        salary_max: data.salary_max,
        salary_currency: data.salary_currency,
        location: data.location,
        summary: data.summary,
        source_url: data.source_url,
      },
    };
    setPrefillData(prefill);
    setShowParserModal(false);
    setShowCreateModal(true);
    toast.success('Данные распознаны');
  };

  const handleParseJobStarted = () => {
    // Trigger refresh of parse jobs panel
    setParseJobsRefresh((prev) => prev + 1);
    setShowParserModal(false);
  };

  const handleParseJobComplete = () => {
    // Refresh entities list when a parse job completes
    fetchTypeCounts();
    setFilters({ ...{} }); // Force refresh entities
  };

  // Backend already filters entities by access control (ownership, department, sharing)
  // Apply vacancy filter on frontend (filter by entity IDs who applied to selected vacancy)
  const accessibleEntities = vacancyEntityIds !== null
    ? entities.filter((entity) => vacancyEntityIds.has(entity.id))
    : entities;

  // Note: typeCounts comes from the store and is fetched separately
  // to show accurate totals even when filtered by type

  const getEntityIcon = (type: EntityType) => {
    const icons = {
      candidate: UserCheck,
      client: Building2,
      contractor: Wrench,
      lead: Target,
      partner: Users,
      custom: User
    };
    return icons[type] || User;
  };

  // Calculate layout mode based on AI panel state
  // When AI panel is open on xl+ screens, we show all 3 columns: sidebar (240px) + content (1fr) + AI (480px)
  const layoutMode = currentEntity
    ? showAIPanel
      ? 'ai-open' // sidebar (narrow) + content + AI panel
      : 'detail' // sidebar + content
    : 'list'; // full width list

  return (
    <div
      className={clsx(
        'h-full overflow-hidden',
        // Use CSS Grid for precise layout control with 3 columns when AI panel is open
        // On xl (1280px): 220px sidebar + flex content + 420px AI = ~1280px fits perfectly
        // On 2xl (1536px): 260px sidebar + flex content + 480px AI = more breathing room
        layoutMode === 'ai-open' && 'xl:grid xl:grid-cols-[220px_minmax(300px,1fr)_420px] 2xl:grid-cols-[260px_minmax(400px,1fr)_480px]',
        layoutMode === 'detail' && 'flex',
        layoutMode === 'list' && 'flex'
      )}
    >
      {/* Sidebar - Entity List */}
      {/* When AI panel is open on xl+, sidebar becomes narrow via grid column */}
      {/* On lg screens without AI: fixed 280px. On xl+ with AI: grid controls width */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className={clsx(
          'border-r border-white/5 flex flex-col bg-black/20 transition-all duration-200 overflow-hidden',
          layoutMode === 'ai-open'
            ? 'hidden xl:flex xl:w-full min-w-0' // Hidden on <xl, grid controls width on xl+
            : layoutMode === 'detail'
              ? 'w-64 lg:w-72 xl:w-80 flex-shrink-0' // Responsive sidebar widths
              : 'w-full max-w-2xl'
        )}
      >
        {/* Header */}
        <div className={clsx(
          'border-b border-white/5',
          layoutMode === 'ai-open' ? 'p-3' : 'p-4'
        )}>
          <div className="flex items-center justify-between mb-3">
            <OnboardingTooltip
              id="contacts-page"
              content="Import candidates from hh.ru or upload resumes"
              position="bottom"
            >
              <h1 className={clsx(
                'font-semibold text-white truncate',
                layoutMode === 'ai-open' ? 'text-base' : 'text-xl'
              )}>Контакты</h1>
            </OnboardingTooltip>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <FeatureGatedButton
                feature="candidate_database"
                onClick={() => setShowParserModal(true)}
                className={clsx(
                  'rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  layoutMode === 'ai-open' ? 'p-1.5' : 'p-2'
                )}
                title="Импорт резюме"
                disabledTooltip="You don't have access to this feature"
              >
                <Upload size={layoutMode === 'ai-open' ? 16 : 20} />
              </FeatureGatedButton>
              <button
                onClick={() => {
                  setEditingEntity(null);
                  setPrefillData(null);
                  setShowCreateModal(true);
                }}
                className={clsx(
                  'rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors',
                  layoutMode === 'ai-open' ? 'p-1.5' : 'p-2'
                )}
              >
                <Plus size={layoutMode === 'ai-open' ? 16 : 20} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={layoutMode === 'ai-open' ? 14 : 18} />
            <input
              type="text"
              placeholder={layoutMode === 'ai-open' ? 'Поиск...' : 'Поиск контактов...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={clsx(
                'w-full bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50',
                layoutMode === 'ai-open' ? 'pl-8 pr-3 py-1.5 text-sm' : 'pl-10 pr-4 py-2'
              )}
            />
          </div>

          {/* Ownership Filters */}
          <div className={clsx(
            'flex gap-1 mb-3 p-1 bg-white/5 rounded-lg',
            layoutMode === 'ai-open' && 'overflow-x-auto'
          )}>
            {OWNERSHIP_FILTERS.map((filter) => {
              const Icon = filter.icon;
              return (
                <button
                  key={filter.id}
                  onClick={() => setOwnershipFilter(filter.id)}
                  className={clsx(
                    'flex-1 flex items-center justify-center rounded-md transition-colors whitespace-nowrap',
                    layoutMode === 'ai-open' ? 'gap-1 px-2 py-1.5 text-xs' : 'gap-1.5 px-3 py-2 text-sm',
                    ownershipFilter === filter.id
                      ? 'bg-cyan-500 text-white shadow-lg'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  )}
                  title={filter.description}
                >
                  <Icon size={layoutMode === 'ai-open' ? 12 : 14} />
                  <span className={layoutMode === 'ai-open' ? 'sr-only' : ''}>{filter.name}</span>
                </button>
              );
            })}
          </div>

          {/* Department Filter - Only for Superadmin/Owner */}
          {departments.length > 0 && (isSuperAdmin() || isOwner()) && (
            <div className="mb-3">
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className={clsx(
                  'w-full bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50',
                  layoutMode === 'ai-open' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'
                )}
              >
                <option value="all">{layoutMode === 'ai-open' ? 'Все' : 'Все департаменты'}</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Vacancy Filter - Filter candidates by vacancy */}
          {vacancies.length > 0 && canAccessFeature('vacancies') && (
            <div className="mb-3">
              <div className="relative">
                <Briefcase className={clsx(
                  'absolute top-1/2 -translate-y-1/2 text-white/40',
                  layoutMode === 'ai-open' ? 'left-2' : 'left-3'
                )} size={layoutMode === 'ai-open' ? 14 : 16} />
                <select
                  value={vacancyFilter}
                  onChange={(e) => setVacancyFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  disabled={vacancyFilterLoading}
                  className={clsx(
                    'w-full bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 appearance-none cursor-pointer disabled:opacity-50',
                    layoutMode === 'ai-open' ? 'pl-7 pr-3 py-1.5 text-xs' : 'pl-10 pr-4 py-2 text-sm'
                  )}
                >
                  <option value="all">{layoutMode === 'ai-open' ? 'Все' : 'All candidates'}</option>
                  {vacancies.map((vacancy) => (
                    <option key={vacancy.id} value={vacancy.id}>
                      {vacancy.title} ({vacancy.applications_count})
                    </option>
                  ))}
                </select>
                {vacancyFilterLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Type Filters */}
          <div className={clsx(
            'flex flex-wrap',
            layoutMode === 'ai-open' ? 'gap-1' : 'gap-2'
          )}>
            {ENTITY_TYPE_FILTERS.map((filter) => {
              const Icon = filter.icon;
              // Use typeCounts from store - these stay constant regardless of type filter
              const count = filter.id === 'all'
                ? typeCounts.all
                : typeCounts[filter.id as keyof typeof typeCounts] || 0;

              return (
                <button
                  key={filter.id}
                  onClick={() => setTypeFilter(filter.id)}
                  title={`${filter.name} (${count})`}
                  className={clsx(
                    'flex items-center rounded-lg transition-colors',
                    layoutMode === 'ai-open' ? 'gap-1 px-2 py-1 text-xs' : 'gap-1.5 px-3 py-1.5 text-sm',
                    typeFilter === filter.id
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  )}
                >
                  <Icon size={layoutMode === 'ai-open' ? 12 : 14} />
                  <span className={layoutMode === 'ai-open' ? 'sr-only' : ''}>{filter.name}</span>
                  <span className={clsx('opacity-60', layoutMode === 'ai-open' ? 'text-[10px]' : 'text-xs')}>({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Parse Jobs Panel - Shows active parsing jobs */}
        {layoutMode !== 'ai-open' && canAccessFeature('candidate_database') && (
          <div className="px-4 pt-4">
            <ParseJobsPanel
              refreshTrigger={parseJobsRefresh}
              onJobComplete={handleParseJobComplete}
            />
          </div>
        )}

        {/* Entity List */}
        <div className={clsx(
          'flex-1 overflow-y-auto overflow-x-hidden',
          layoutMode === 'ai-open' ? 'p-2 space-y-1' : 'p-4 space-y-2'
        )}>
          {isLoading && accessibleEntities.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : accessibleEntities.length === 0 ? (
            <div className="text-center py-8 text-white/40">
              <Users className="mx-auto mb-2" size={layoutMode === 'ai-open' ? 28 : 40} />
              <p className={layoutMode === 'ai-open' ? 'text-xs' : ''}>Контакты не найдены</p>
              <button
                onClick={() => {
                  setEditingEntity(null);
                  setShowCreateModal(true);
                }}
                className={clsx(
                  'mt-4 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors',
                  layoutMode === 'ai-open' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2'
                )}
              >
                {layoutMode === 'ai-open' ? 'Добавить' : 'Добавить первый контакт'}
              </button>
            </div>
          ) : (
            accessibleEntities.map((entity) => {
              const Icon = getEntityIcon(entity.type);
              const isSelected = currentEntity?.id === entity.id;
              const isCompact = !!currentEntity; // Sidebar is narrow when entity is selected
              const isVeryCompact = layoutMode === 'ai-open'; // Extra compact when AI panel is open

              return (
                <motion.div
                  key={entity.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => handleSelectEntity(entity.id)}
                  className={clsx(
                    'rounded-xl cursor-pointer transition-all group overflow-hidden',
                    isVeryCompact ? 'p-2' : isCompact ? 'p-3' : 'p-4',
                    entity.is_transferred
                      ? 'bg-white/3 border border-white/5 opacity-60'
                      : isSelected
                        ? 'bg-cyan-500/20 border border-cyan-500/30'
                        : 'bg-white/5 border border-white/5 hover:bg-white/10'
                  )}
                >
                  <div className={clsx('flex items-center', isVeryCompact ? 'gap-2' : 'gap-3')}>
                    <div className={clsx(
                      'rounded-lg flex-shrink-0',
                      isVeryCompact ? 'p-1' : isCompact ? 'p-1.5' : 'p-2',
                      isSelected ? 'bg-cyan-500/30' : 'bg-white/10'
                    )}>
                      <Icon size={isVeryCompact ? 14 : isCompact ? 16 : 20} className={isSelected ? 'text-cyan-400' : 'text-white/60'} />
                    </div>

                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <h3 className={clsx(
                          'font-medium text-white truncate',
                          isVeryCompact ? 'text-xs' : isCompact ? 'text-sm' : ''
                        )}>{entity.name}</h3>
                        {!isCompact && entity.is_transferred && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 flex-shrink-0">
                            Передан
                          </span>
                        )}
                        {!isCompact && (
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_COLORS[entity.status])}>
                            {STATUS_LABELS[entity.status]}
                          </span>
                        )}
                      </div>

                      {/* Compact/Very compact mode: show minimal info */}
                      {isCompact ? (
                        <div className={clsx(
                          'flex items-center flex-wrap mt-0.5 text-white/40',
                          isVeryCompact ? 'gap-1.5 text-[10px]' : 'gap-2 text-xs'
                        )}>
                          {/* Owner info - show in compact mode too */}
                          {!entity.is_mine && entity.owner_name && !entity.is_transferred && (
                            <span className={clsx(
                              'flex items-center gap-0.5',
                              entity.is_shared ? 'text-purple-400' : 'text-blue-400'
                            )}>
                              <User size={isVeryCompact ? 8 : 10} />
                              <span className="truncate max-w-[60px]">{entity.owner_name}</span>
                            </span>
                          )}
                          {entity.chats_count !== undefined && entity.chats_count > 0 && (
                            <span className="flex items-center gap-0.5">
                              <MessageSquare size={isVeryCompact ? 8 : 10} />
                              {entity.chats_count}
                            </span>
                          )}
                          {entity.calls_count !== undefined && entity.calls_count > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Phone size={isVeryCompact ? 8 : 10} />
                              {entity.calls_count}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          {(entity.company || entity.position) && (
                            <p className="text-sm text-white/60 truncate mt-1">
                              {entity.position}{entity.position && entity.company && ' @ '}{entity.company}
                            </p>
                          )}

                          <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
                            {entity.is_transferred && entity.transferred_to_name && (
                              <span className="flex items-center gap-1 text-orange-400">
                                <ArrowRightLeft size={12} />
                                Передан → {entity.transferred_to_name}
                              </span>
                            )}
                            {entity.is_shared && entity.owner_name && !entity.is_transferred && (
                              <span className="flex items-center gap-1 text-purple-400">
                                <Share size={12} />
                                {entity.access_level === 'view' ? 'Просмотр' : entity.access_level === 'edit' ? 'Редактирование' : 'Полный доступ'} от {entity.owner_name}
                              </span>
                            )}
                            {/* Show owner for all non-owned entities (for superadmin, org owner, dept admins) */}
                            {!entity.is_mine && entity.owner_name && !entity.is_transferred && !entity.is_shared && (
                              <span className="flex items-center gap-1 text-blue-400" title={`Владелец: ${entity.owner_name}`}>
                                <User size={12} />
                                <span className="text-white/40">Владелец:</span> {entity.owner_name}
                              </span>
                            )}
                            {entity.chats_count !== undefined && entity.chats_count > 0 && (
                              <span className="flex items-center gap-1">
                                <MessageSquare size={12} />
                                {entity.chats_count} чатов
                              </span>
                            )}
                            {entity.calls_count !== undefined && entity.calls_count > 0 && (
                              <span className="flex items-center gap-1">
                                <Phone size={12} />
                                {entity.calls_count} звонков
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Quick Actions - only in full mode */}
                    {!isCompact && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 flex-shrink-0">
                        {canTransfer(entity) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTransfer(entity);
                            }}
                            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60"
                            title="Передать"
                          >
                            <ArrowRightLeft size={14} />
                          </button>
                        )}
                        {canEdit(entity) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(entity);
                            }}
                            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60"
                            title="Редактировать"
                          >
                            <Edit size={14} />
                          </button>
                        )}
                        {canDelete(entity) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(entity);
                            }}
                            className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400"
                            title="Удалить"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </motion.div>

      {/* Main Content - Entity Detail */}
      <AnimatePresence mode="wait">
        {currentEntity && (
          <motion.div
            key={currentEntity.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className={clsx(
              'flex flex-col overflow-hidden min-w-0',
              // When AI panel is open, this is the middle grid column (minmax controls width)
              // When AI panel is closed, use flex-1 to fill available space
              layoutMode === 'ai-open'
                ? 'w-full' // Grid controls width via minmax
                : 'flex-1' // Flex layout fills remaining space
            )}
          >
            {/* Header */}
            <div className="p-3 xl:p-4 border-b border-white/5 flex items-center gap-2 sm:gap-3 overflow-hidden">
              <button
                onClick={handleBack}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors flex-shrink-0"
              >
                <ChevronLeft size={20} className="text-white/60" />
              </button>
              {/* Back to candidates button for candidate entities */}
              {currentEntity.type === 'candidate' && (
                <button
                  onClick={() => navigate('/candidates')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg text-sm transition-colors flex-shrink-0"
                  title="Перейти к базе кандидатов"
                >
                  <Users size={16} />
                  <span className="hidden sm:inline">К кандидатам</span>
                </button>
              )}
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 overflow-hidden">
                  <h2 className="text-base sm:text-lg xl:text-xl font-semibold text-white truncate">{currentEntity.name}</h2>
                  {currentEntity.is_transferred && currentEntity.transferred_to_name && (
                    <span className="hidden lg:flex px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-lg whitespace-nowrap items-center gap-1 flex-shrink-0">
                      <ArrowRightLeft size={12} />
                      <span className="hidden xl:inline">Передан</span>
                    </span>
                  )}
                  {currentEntity.is_shared && currentEntity.access_level === 'view' && (
                    <span className="hidden lg:inline px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-lg whitespace-nowrap flex-shrink-0">
                      <span className="hidden xl:inline">Просмотр</span>
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-white/60 truncate">
                  {ENTITY_TYPES[currentEntity.type].name}
                  {currentEntity.company && ` @ ${currentEntity.company}`}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => setShowAIPanel(!showAIPanel)}
                  data-tour="ai-button"
                  className={clsx(
                    'p-2 rounded-lg flex items-center gap-1.5 transition-colors',
                    showAIPanel
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-white/5 hover:bg-white/10 text-white/60'
                  )}
                  title="AI Ассистент"
                >
                  <Bot size={16} />
                  <span className={clsx('hidden', showAIPanel ? '2xl:inline' : 'lg:inline')}>AI</span>
                </button>
                {canShare(currentEntity as Entity) && (
                  <button
                    onClick={() => setShowShareModal(true)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 flex items-center gap-1.5"
                    title="Поделиться"
                  >
                    <Share2 size={16} />
                    <span className={clsx('hidden', showAIPanel ? '2xl:inline' : 'xl:inline')}>Поделиться</span>
                  </button>
                )}
                {canTransfer(currentEntity as Entity) && (
                  <button
                    onClick={() => handleTransfer(currentEntity as Entity)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 flex items-center gap-1.5"
                    title="Передать"
                  >
                    <ArrowRightLeft size={16} />
                    <span className={clsx('hidden', showAIPanel ? '2xl:inline' : 'xl:inline')}>Передать</span>
                  </button>
                )}
                {canEdit(currentEntity as Entity) && (
                  <button
                    onClick={() => handleEdit(currentEntity as Entity)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 flex items-center gap-1.5"
                    title="Редактировать"
                  >
                    <Edit size={16} />
                    <span className={clsx('hidden', showAIPanel ? '2xl:inline' : 'xl:inline')}>Изменить</span>
                  </button>
                )}
              </div>
            </div>

            {/* Detail Content */}
            <div className="flex-1 overflow-y-auto">
              <ContactDetail entity={currentEntity} showAIInOverview={false} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Panel - Right Column */}
      {/* On xl (1280px): 420px width, on 2xl (1536px): 480px width as third grid column */}
      {/* On smaller screens: uses mobile overlay below */}
      <AnimatePresence>
        {currentEntity && showAIPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hidden xl:flex flex-col border-l border-white/5 glass overflow-hidden w-full min-w-0"
          >
            <div className="p-3 2xl:p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <h3 className="text-base 2xl:text-lg font-semibold text-white flex items-center gap-2 truncate">
                <Bot size={18} className="text-cyan-400 flex-shrink-0" />
                <span className="truncate">AI Ассистент</span>
              </h3>
              <button
                onClick={() => setShowAIPanel(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 flex-shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <EntityAI entity={currentEntity} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile AI Panel - EXACT same as ChatsPage */}
      <AnimatePresence>
        {currentEntity && showAIPanel && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="xl:hidden fixed inset-0 z-50 glass flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Bot size={20} className="text-cyan-400" />
                AI Ассистент
              </h3>
              <button
                onClick={() => setShowAIPanel(false)}
                className="p-2 rounded-lg hover:bg-white/5"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <EntityAI entity={currentEntity} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Floating AI Button */}
      {currentEntity && !showAIPanel && (
        <button
          onClick={() => setShowAIPanel(true)}
          className="xl:hidden fixed bottom-4 right-4 p-4 rounded-full bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 z-40"
        >
          <Bot size={24} />
        </button>
      )}

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <ContactForm
            entity={editingEntity}
            prefillData={prefillData || undefined}
            defaultType={typeFilter === 'all' ? undefined : typeFilter}
            onClose={() => {
              setShowCreateModal(false);
              setEditingEntity(null);
              setPrefillData(null);
            }}
            onSuccess={(entity) => {
              setShowCreateModal(false);
              setEditingEntity(null);
              setPrefillData(null);
              toast.success(editingEntity ? 'Контакт обновлён' : 'Контакт создан');
              if (!editingEntity) {
                navigate(`/contacts/${entity.id}`);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Parser Modal */}
      <AnimatePresence>
        {showParserModal && (
          <ParserModal
            type="resume"
            onClose={() => setShowParserModal(false)}
            onParsed={(data) => handleParsedResume(data as ParsedResume)}
            onJobStarted={handleParseJobStarted}
          />
        )}
      </AnimatePresence>

      {/* Transfer Modal */}
      <AnimatePresence>
        {showTransferModal && selectedEntityForTransfer && (
          <TransferModal
            entity={selectedEntityForTransfer}
            onClose={() => {
              setShowTransferModal(false);
              setSelectedEntityForTransfer(null);
            }}
            onSuccess={() => {
              setShowTransferModal(false);
              setSelectedEntityForTransfer(null);
              toast.success('Контакт передан');
            }}
          />
        )}
      </AnimatePresence>

      {/* Share Modal */}
      {currentEntity && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          resourceType="entity"
          resourceId={currentEntity.id}
          resourceName={currentEntity.name}
          canManageAccess={canShare(currentEntity as Entity)}
        />
      )}
    </div>
  );
}
