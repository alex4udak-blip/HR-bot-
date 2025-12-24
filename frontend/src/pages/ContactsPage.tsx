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
  Globe
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useEntityStore } from '@/stores/entityStore';
import { useAuthStore } from '@/stores/authStore';
import type { EntityType, Entity } from '@/types';
import { ENTITY_TYPES, STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { OwnershipFilter, Department } from '@/services/api';
import { getDepartments } from '@/services/api';
import ContactForm from '@/components/contacts/ContactForm';
import TransferModal from '@/components/contacts/TransferModal';
import ContactDetail from '@/components/contacts/ContactDetail';
import EntityAI from '@/components/contacts/EntityAI';
import ShareModal from '@/components/common/ShareModal';

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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [selectedEntityForTransfer, setSelectedEntityForTransfer] = useState<Entity | null>(null);

  const {
    canEditResource,
    canDeleteResource,
    canShareResource
  } = useAuthStore();

  const {
    entities,
    currentEntity,
    loading,
    fetchEntity,
    deleteEntity,
    setFilters,
    clearCurrentEntity
  } = useEntityStore();

  // Helper functions to check permissions using authStore helpers
  const canEdit = (entity: Entity) => {
    // Transferred entities are read-only
    if (entity.is_transferred) return false;

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

    // Only owners can transfer
    return canDeleteResource({
      owner_id: entity.owner_id,
      is_mine: entity.is_mine,
      access_level: entity.access_level
    });
  };

  // Load departments on mount
  useEffect(() => {
    getDepartments().then(setDepartments).catch(console.error);
  }, []);

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

  // Count entities per type
  const typeCounts = entities.reduce((acc, entity) => {
    acc[entity.type] = (acc[entity.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

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

  return (
    <div className="h-full flex">
      {/* Sidebar - Entity List */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className={clsx(
          'flex-shrink-0 border-r border-white/5 flex flex-col bg-black/20',
          currentEntity ? 'w-80' : 'w-full max-w-2xl'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-white">Контакты</h1>
            <button
              onClick={() => {
                setEditingEntity(null);
                setShowCreateModal(true);
              }}
              className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors"
            >
              <Plus size={20} />
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input
              type="text"
              placeholder="Поиск контактов..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          {/* Ownership Filters */}
          <div className="flex gap-1 mb-3 p-1 bg-white/5 rounded-lg">
            {OWNERSHIP_FILTERS.map((filter) => {
              const Icon = filter.icon;
              return (
                <button
                  key={filter.id}
                  onClick={() => setOwnershipFilter(filter.id)}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors',
                    ownershipFilter === filter.id
                      ? 'bg-cyan-500 text-white shadow-lg'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  )}
                  title={filter.description}
                >
                  <Icon size={14} />
                  <span>{filter.name}</span>
                </button>
              );
            })}
          </div>

          {/* Department Filter */}
          {departments.length > 0 && (
            <div className="mb-3">
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500/50"
              >
                <option value="all">Все департаменты</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Type Filters */}
          <div className="flex flex-wrap gap-2">
            {ENTITY_TYPE_FILTERS.map((filter) => {
              const Icon = filter.icon;
              const count = filter.id === 'all'
                ? entities.length
                : typeCounts[filter.id] || 0;

              return (
                <button
                  key={filter.id}
                  onClick={() => setTypeFilter(filter.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                    typeFilter === filter.id
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  )}
                >
                  <Icon size={14} />
                  <span>{filter.name}</span>
                  <span className="text-xs opacity-60">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Entity List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && entities.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : entities.length === 0 ? (
            <div className="text-center py-8 text-white/40">
              <Users className="mx-auto mb-2" size={40} />
              <p>Контакты не найдены</p>
              <button
                onClick={() => {
                  setEditingEntity(null);
                  setShowCreateModal(true);
                }}
                className="mt-4 px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors"
              >
                Добавить первый контакт
              </button>
            </div>
          ) : (
            entities.map((entity) => {
              const Icon = getEntityIcon(entity.type);
              const isSelected = currentEntity?.id === entity.id;

              return (
                <motion.div
                  key={entity.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => handleSelectEntity(entity.id)}
                  className={clsx(
                    'p-4 rounded-xl cursor-pointer transition-all group overflow-hidden',
                    entity.is_transferred
                      ? 'bg-white/3 border border-white/5 opacity-60'
                      : isSelected
                      ? 'bg-cyan-500/20 border border-cyan-500/30'
                      : 'bg-white/5 border border-white/5 hover:bg-white/10'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={clsx(
                      'p-2 rounded-lg',
                      isSelected ? 'bg-cyan-500/30' : 'bg-white/10'
                    )}>
                      <Icon size={20} className={isSelected ? 'text-cyan-400' : 'text-white/60'} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-white truncate">{entity.name}</h3>
                        {entity.is_transferred && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300">
                            Передан
                          </span>
                        )}
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[entity.status])}>
                          {STATUS_LABELS[entity.status]}
                        </span>
                      </div>

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
                    </div>

                    {/* Quick Actions */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
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
            className="flex-1 flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center gap-4">
              <button
                onClick={handleBack}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              >
                <ChevronLeft size={20} className="text-white/60" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-white truncate">{currentEntity.name}</h2>
                  {currentEntity.is_transferred && currentEntity.transferred_to_name && (
                    <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-lg whitespace-nowrap flex items-center gap-1">
                      <ArrowRightLeft size={12} />
                      Передан → {currentEntity.transferred_to_name}
                    </span>
                  )}
                  {currentEntity.is_shared && currentEntity.access_level === 'view' && (
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-lg whitespace-nowrap">
                      Только просмотр
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/60 truncate">
                  {ENTITY_TYPES[currentEntity.type].name}
                  {currentEntity.company && ` @ ${currentEntity.company}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAIPanel(!showAIPanel)}
                  className={clsx(
                    'px-3 py-2 rounded-lg flex items-center gap-2 transition-colors',
                    showAIPanel
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-white/5 hover:bg-white/10 text-white/60'
                  )}
                >
                  <Bot size={16} />
                  AI
                </button>
                {canShare(currentEntity as Entity) && (
                  <button
                    onClick={() => setShowShareModal(true)}
                    className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 flex items-center gap-2"
                  >
                    <Share2 size={16} />
                    Share
                  </button>
                )}
                {canTransfer(currentEntity as Entity) && (
                  <button
                    onClick={() => handleTransfer(currentEntity as Entity)}
                    className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 flex items-center gap-2"
                  >
                    <ArrowRightLeft size={16} />
                    Transfer
                  </button>
                )}
                {canEdit(currentEntity as Entity) && (
                  <button
                    onClick={() => handleEdit(currentEntity as Entity)}
                    className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 flex items-center gap-2"
                  >
                    <Edit size={16} />
                    Edit
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
      <AnimatePresence>
        {currentEntity && showAIPanel && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 420, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hidden xl:flex flex-col h-full border-l border-white/5 bg-black/20 overflow-hidden flex-shrink-0"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Bot size={20} className="text-cyan-400" />
                AI Ассистент
              </h3>
              <button
                onClick={() => setShowAIPanel(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/60"
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

      {/* Mobile AI Panel */}
      <AnimatePresence>
        {currentEntity && showAIPanel && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.2 }}
            className="xl:hidden fixed inset-0 z-50 bg-gray-900/95 flex flex-col"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Bot size={20} className="text-cyan-400" />
                AI Ассистент - {currentEntity.name}
              </h3>
              <button
                onClick={() => setShowAIPanel(false)}
                className="p-2 rounded-lg hover:bg-white/10 text-white/60"
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

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <ContactForm
            entity={editingEntity}
            defaultType={typeFilter === 'all' ? undefined : typeFilter}
            onClose={() => {
              setShowCreateModal(false);
              setEditingEntity(null);
            }}
            onSuccess={(entity) => {
              setShowCreateModal(false);
              setEditingEntity(null);
              toast.success(editingEntity ? 'Contact updated' : 'Contact created');
              if (!editingEntity) {
                navigate(`/contacts/${entity.id}`);
              }
            }}
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
              toast.success('Contact transferred');
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
