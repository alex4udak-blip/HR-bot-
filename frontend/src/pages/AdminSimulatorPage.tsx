import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  Check,
  X,
  Eye,
  Edit,
  Trash2,
  Share2,
  ArrowRightLeft,
  User,
  Users,
  Building2,
  Crown,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Phone,
  UserCheck,
  Target
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '@/stores/authStore';

// Типы ролей
type OrgRole = 'superadmin' | 'owner' | 'admin' | 'member';
type DeptRole = 'lead' | 'sub_admin' | 'member';
type ResourceType = 'entity' | 'chat' | 'call';
type ActionType = 'view' | 'edit' | 'delete' | 'share' | 'transfer';
type AccessLevel = 'view' | 'edit' | 'full';

// Конфигурация ролей
const ROLES: { id: OrgRole; name: string; icon: typeof Crown; description: string; color: string }[] = [
  {
    id: 'superadmin',
    name: 'Суперадмин',
    icon: Crown,
    description: 'Глобальный доступ ко всему',
    color: 'text-purple-400'
  },
  {
    id: 'owner',
    name: 'Владелец',
    icon: Building2,
    description: 'Доступ ко всему в организации',
    color: 'text-cyan-400'
  },
  {
    id: 'admin',
    name: 'Админ/Руководитель',
    icon: Shield,
    description: 'Доступ к своему департаменту',
    color: 'text-blue-400'
  },
  {
    id: 'member',
    name: 'Сотрудник',
    icon: User,
    description: 'Базовый доступ',
    color: 'text-green-400'
  }
];

// Конфигурация действий
const ACTIONS: { id: ActionType; name: string; icon: typeof Eye; color: string }[] = [
  { id: 'view', name: 'Просмотр', icon: Eye, color: 'text-blue-400' },
  { id: 'edit', name: 'Редактирование', icon: Edit, color: 'text-yellow-400' },
  { id: 'delete', name: 'Удаление', icon: Trash2, color: 'text-red-400' },
  { id: 'share', name: 'Расшаривание', icon: Share2, color: 'text-purple-400' },
  { id: 'transfer', name: 'Передача', icon: ArrowRightLeft, color: 'text-orange-400' }
];

// Конфигурация ресурсов
const RESOURCES: { id: ResourceType; name: string; icon: typeof UserCheck }[] = [
  { id: 'entity', name: 'Контакт', icon: UserCheck },
  { id: 'chat', name: 'Чат', icon: MessageSquare },
  { id: 'call', name: 'Звонок', icon: Phone }
];

// Уровни доступа при расшаривании
const ACCESS_LEVELS: { id: AccessLevel; name: string }[] = [
  { id: 'view', name: 'Только просмотр' },
  { id: 'edit', name: 'Редактирование' },
  { id: 'full', name: 'Полный доступ' }
];

export default function AdminSimulatorPage() {
  const { user, isSuperAdmin } = useAuthStore();
  const [selectedRole, setSelectedRole] = useState<OrgRole>('member');

  // Состояние для тестирования сценариев
  const [scenario, setScenario] = useState({
    actorRole: 'member' as OrgRole,
    actorIsOwner: false,
    actorSameDepartment: true,
    action: 'view' as ActionType,
    resourceType: 'entity' as ResourceType,
    resourceOwnerRole: 'member' as OrgRole,
    resourceIsShared: false,
    resourceAccessLevel: 'view' as AccessLevel,
    targetUserRole: 'member' as OrgRole,
    targetSameDepartment: true
  });

  // Проверка доступа - только для SUPERADMIN
  if (!isSuperAdmin()) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass rounded-2xl p-8 max-w-md text-center"
        >
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
          <h2 className="text-2xl font-bold mb-2">Доступ запрещён</h2>
          <p className="text-white/60">
            Эта страница доступна только пользователям с ролью SUPERADMIN
          </p>
        </motion.div>
      </div>
    );
  }

  // Логика проверки прав доступа (имитация backend)
  const checkPermission = (
    role: OrgRole,
    action: ActionType,
    isOwner: boolean,
    isShared: boolean,
    accessLevel?: AccessLevel,
    sameDepartment?: boolean
  ): boolean => {
    // SUPERADMIN имеет доступ ко всему
    if (role === 'superadmin') return true;

    // OWNER имеет доступ ко всему в организации
    if (role === 'owner') return true;

    // Проверка для владельца ресурса
    if (isOwner) {
      return true; // Владелец может делать всё со своими ресурсами
    }

    // Проверка для расшаренных ресурсов
    if (isShared) {
      if (action === 'view') return true; // Любой уровень доступа позволяет просмотр
      if (action === 'edit') return accessLevel === 'edit' || accessLevel === 'full';
      if (action === 'delete') return false; // Нельзя удалять расшаренное
      if (action === 'share') return accessLevel === 'full';
      if (action === 'transfer') return false; // Нельзя передавать чужое
    }

    // Проверка для ADMIN
    if (role === 'admin') {
      // Админ видит всё в своём департаменте
      if (action === 'view' && sameDepartment) return true;
      // Но редактировать/удалять/передавать может только своё
      return false;
    }

    // MEMBER может работать только со своими ресурсами
    return false;
  };

  // Проверка возможности расшаривания
  const canShareTo = (
    fromRole: OrgRole,
    toRole: OrgRole,
    sameDepartment: boolean
  ): boolean => {
    // SUPERADMIN может расшарить кому угодно
    if (fromRole === 'superadmin') return true;

    // OWNER может расшарить кому угодно в организации
    if (fromRole === 'owner') return true;

    // ADMIN может расшарить:
    // - другим админам (любой департамент)
    // - сотрудникам своего департамента
    // - OWNER/SUPERADMIN
    if (fromRole === 'admin') {
      if (toRole === 'owner' || toRole === 'superadmin') return true;
      if (toRole === 'admin') return true;
      if (toRole === 'member' && sameDepartment) return true;
      return false;
    }

    // MEMBER может расшарить только в своём департаменте
    if (fromRole === 'member') {
      return sameDepartment;
    }

    return false;
  };

  // Выполнение теста сценария
  const testScenario = (): { allowed: boolean; reason: string } => {
    const {
      actorRole,
      actorIsOwner,
      actorSameDepartment,
      action,
      resourceIsShared,
      resourceAccessLevel,
      targetUserRole,
      targetSameDepartment
    } = scenario;

    // Проверка расшаривания - особый случай
    if (action === 'share') {
      const canShare = checkPermission(
        actorRole,
        'share',
        actorIsOwner,
        resourceIsShared,
        resourceAccessLevel,
        actorSameDepartment
      );

      if (!canShare) {
        return {
          allowed: false,
          reason: 'У вас нет прав на расшаривание этого ресурса'
        };
      }

      const canShareToTarget = canShareTo(actorRole, targetUserRole, targetSameDepartment);

      if (!canShareToTarget) {
        let reason = 'Нельзя расшарить этому пользователю';

        if (actorRole === 'member' && !targetSameDepartment) {
          reason = 'Сотрудник может расшаривать только в своём департаменте';
        } else if (actorRole === 'admin' && targetUserRole === 'member' && !targetSameDepartment) {
          reason = 'Админ может расшарить сотруднику только в своём департаменте';
        }

        return { allowed: false, reason };
      }

      return { allowed: true, reason: 'Расшаривание разрешено' };
    }

    // Проверка других действий
    const allowed = checkPermission(
      actorRole,
      action,
      actorIsOwner,
      resourceIsShared,
      resourceAccessLevel,
      actorSameDepartment
    );

    if (allowed) {
      let reason = '';
      if (actorRole === 'superadmin') reason = 'SUPERADMIN имеет полный доступ';
      else if (actorRole === 'owner') reason = 'OWNER имеет доступ ко всему в организации';
      else if (actorIsOwner) reason = 'Вы владелец этого ресурса';
      else if (resourceIsShared) {
        if (action === 'view') reason = 'Ресурс расшарен вам';
        else if (action === 'edit') reason = `Уровень доступа "${ACCESS_LEVELS.find(l => l.id === resourceAccessLevel)?.name}" позволяет редактирование`;
        else if (action === 'share') reason = 'Уровень доступа "Полный доступ" позволяет расшаривание';
      } else if (actorRole === 'admin' && action === 'view' && actorSameDepartment) {
        reason = 'Админ видит все ресурсы своего департамента';
      }

      return { allowed: true, reason };
    } else {
      let reason = '';

      if (!actorIsOwner && !resourceIsShared) {
        reason = 'Ресурс вам не принадлежит и не расшарен';
      } else if (resourceIsShared && action === 'delete') {
        reason = 'Нельзя удалять чужие ресурсы, даже расшаренные';
      } else if (resourceIsShared && action === 'transfer') {
        reason = 'Нельзя передавать чужие ресурсы';
      } else if (resourceIsShared && action === 'edit') {
        reason = `Уровень доступа "${ACCESS_LEVELS.find(l => l.id === resourceAccessLevel)?.name}" не позволяет редактирование`;
      } else if (resourceIsShared && action === 'share' && resourceAccessLevel !== 'full') {
        reason = 'Только "Полный доступ" позволяет расшаривание';
      } else if (actorRole === 'admin' && !actorSameDepartment) {
        reason = 'Ресурс находится в другом департаменте';
      } else if (actorRole === 'member') {
        reason = 'Сотрудник может работать только со своими ресурсами';
      }

      return { allowed: false, reason };
    }
  };

  const testResult = testScenario();

  return (
    <div className="h-full overflow-y-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-7xl mx-auto space-y-6"
      >
        {/* Заголовок */}
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-purple-500/20">
            <Shield className="w-8 h-8 text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Симулятор ролей и прав доступа</h1>
            <p className="text-white/60">Тестирование матрицы доступа и сценариев</p>
          </div>
        </div>

        {/* Матрица доступа */}
        <div className="glass rounded-2xl p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-2">Матрица доступа</h2>
            <p className="text-white/60 text-sm">
              Какие действия может выполнять каждая роль с ресурсами
            </p>
          </div>

          {/* Легенда */}
          <div className="mb-4 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Check size={16} className="text-green-400" />
              </div>
              <span className="text-white/60">Свои ресурсы</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Check size={16} className="text-blue-400" />
              </div>
              <span className="text-white/60">Расшаренные (с полным доступом)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <Check size={16} className="text-yellow-400" />
              </div>
              <span className="text-white/60">Департамент (только просмотр)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                <X size={16} className="text-white/40" />
              </div>
              <span className="text-white/60">Запрещено</span>
            </div>
          </div>

          {/* Таблица */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-white/60 font-medium">Действие</th>
                  {ROLES.map((role) => (
                    <th key={role.id} className="text-center py-3 px-4">
                      <div className="flex flex-col items-center gap-2">
                        <role.icon className={clsx('w-5 h-5', role.color)} />
                        <span className="text-sm font-medium text-white">{role.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACTIONS.map((action) => (
                  <tr key={action.id} className="border-b border-white/5">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <action.icon className={clsx('w-5 h-5', action.color)} />
                        <span className="text-white font-medium">{action.name}</span>
                      </div>
                    </td>
                    {ROLES.map((role) => {
                      const ownResource = checkPermission(role.id, action.id, true, false);
                      const sharedFull = role.id !== 'superadmin' && role.id !== 'owner' && action.id !== 'transfer' && action.id !== 'delete' && checkPermission(role.id, action.id, false, true, 'full');
                      const deptView = role.id === 'admin' && action.id === 'view';

                      let bgColor = 'bg-white/5';
                      let iconColor = 'text-white/40';
                      let icon = X;

                      if (ownResource) {
                        bgColor = 'bg-green-500/20';
                        iconColor = 'text-green-400';
                        icon = Check;
                      } else if (sharedFull) {
                        bgColor = 'bg-blue-500/20';
                        iconColor = 'text-blue-400';
                        icon = Check;
                      } else if (deptView) {
                        bgColor = 'bg-yellow-500/20';
                        iconColor = 'text-yellow-400';
                        icon = Check;
                      }

                      const Icon = icon;

                      return (
                        <td key={role.id} className="py-4 px-4">
                          <div className="flex justify-center">
                            <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', bgColor)}>
                              <Icon size={16} className={iconColor} />
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Примечания */}
          <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <h3 className="text-sm font-semibold text-blue-400 mb-2">Правила доступа:</h3>
            <ul className="text-sm text-white/70 space-y-1">
              <li>• <strong>SUPERADMIN</strong>: полный доступ ко всему</li>
              <li>• <strong>OWNER</strong>: доступ ко всему в организации</li>
              <li>• <strong>ADMIN</strong>: видит всё в своём департаменте, но редактирует/удаляет только своё</li>
              <li>• <strong>MEMBER</strong>: работает только со своими ресурсами и расшаренными ему</li>
              <li>• Расшаренные ресурсы: нельзя удалять или передавать, даже с полным доступом</li>
              <li>• Полный доступ: позволяет редактировать и расшаривать дальше</li>
            </ul>
          </div>
        </div>

        {/* Тестирование сценариев */}
        <div className="glass rounded-2xl p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-2">Тестирование сценария</h2>
            <p className="text-white/60 text-sm">
              Проверьте, разрешено ли конкретное действие в заданных условиях
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Настройки актёра */}
            <div className="space-y-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-cyan-400" />
                Актёр (кто выполняет действие)
              </h3>

              <div>
                <label className="block text-sm text-white/60 mb-2">Роль актёра</label>
                <select
                  value={scenario.actorRole}
                  onChange={(e) => setScenario({ ...scenario, actorRole: e.target.value as OrgRole })}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                >
                  {ROLES.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scenario.actorIsOwner}
                    onChange={(e) => setScenario({ ...scenario, actorIsOwner: e.target.checked })}
                    className="w-4 h-4 rounded accent-cyan-500"
                  />
                  <span className="text-white/80">Актёр - владелец ресурса</span>
                </label>
              </div>

              {!scenario.actorIsOwner && (
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scenario.actorSameDepartment}
                      onChange={(e) => setScenario({ ...scenario, actorSameDepartment: e.target.checked })}
                      className="w-4 h-4 rounded accent-cyan-500"
                    />
                    <span className="text-white/80">Ресурс в том же департаменте</span>
                  </label>
                </div>
              )}

              {!scenario.actorIsOwner && (
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scenario.resourceIsShared}
                      onChange={(e) => setScenario({ ...scenario, resourceIsShared: e.target.checked })}
                      className="w-4 h-4 rounded accent-cyan-500"
                    />
                    <span className="text-white/80">Ресурс расшарен актёру</span>
                  </label>
                </div>
              )}

              {scenario.resourceIsShared && !scenario.actorIsOwner && (
                <div>
                  <label className="block text-sm text-white/60 mb-2">Уровень доступа</label>
                  <select
                    value={scenario.resourceAccessLevel}
                    onChange={(e) => setScenario({ ...scenario, resourceAccessLevel: e.target.value as AccessLevel })}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                  >
                    {ACCESS_LEVELS.map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Настройки действия и цели */}
            <div className="space-y-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-purple-400" />
                Действие и цель
              </h3>

              <div>
                <label className="block text-sm text-white/60 mb-2">Тип ресурса</label>
                <select
                  value={scenario.resourceType}
                  onChange={(e) => setScenario({ ...scenario, resourceType: e.target.value as ResourceType })}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                >
                  {RESOURCES.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Действие</label>
                <select
                  value={scenario.action}
                  onChange={(e) => setScenario({ ...scenario, action: e.target.value as ActionType })}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                >
                  {ACTIONS.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.name}
                    </option>
                  ))}
                </select>
              </div>

              {scenario.action === 'share' && (
                <>
                  <div>
                    <label className="block text-sm text-white/60 mb-2">Роль целевого пользователя</label>
                    <select
                      value={scenario.targetUserRole}
                      onChange={(e) => setScenario({ ...scenario, targetUserRole: e.target.value as OrgRole })}
                      className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500/50"
                    >
                      {ROLES.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={scenario.targetSameDepartment}
                        onChange={(e) => setScenario({ ...scenario, targetSameDepartment: e.target.checked })}
                        className="w-4 h-4 rounded accent-cyan-500"
                      />
                      <span className="text-white/80">Цель в том же департаменте</span>
                    </label>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Результат */}
          <div className="mt-6">
            <div
              className={clsx(
                'p-6 rounded-xl border-2 transition-all',
                testResult.allowed
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-red-500/10 border-red-500/30'
              )}
            >
              <div className="flex items-start gap-4">
                {testResult.allowed ? (
                  <CheckCircle2 className="w-8 h-8 text-green-400 flex-shrink-0" />
                ) : (
                  <X className="w-8 h-8 text-red-400 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <h3 className={clsx(
                    'text-xl font-bold mb-2',
                    testResult.allowed ? 'text-green-400' : 'text-red-400'
                  )}>
                    {testResult.allowed ? 'РАЗРЕШЕНО' : 'ЗАПРЕЩЕНО'}
                  </h3>
                  <p className="text-white/80">{testResult.reason}</p>

                  {/* Детали сценария */}
                  <div className="mt-4 pt-4 border-t border-white/10 text-sm text-white/60">
                    <p>
                      <strong className="text-white">Сценарий:</strong>{' '}
                      {ROLES.find(r => r.id === scenario.actorRole)?.name}
                      {' '}пытается{' '}
                      {ACTIONS.find(a => a.id === scenario.action)?.name.toLowerCase()}
                      {' '}
                      {RESOURCES.find(r => r.id === scenario.resourceType)?.name.toLowerCase()}
                      {scenario.action === 'share' && ` → ${ROLES.find(r => r.id === scenario.targetUserRole)?.name}`}
                    </p>
                    {scenario.actorIsOwner && (
                      <p className="mt-1">• Актёр владеет ресурсом</p>
                    )}
                    {!scenario.actorIsOwner && scenario.resourceIsShared && (
                      <p className="mt-1">
                        • Ресурс расшарен с уровнем "{ACCESS_LEVELS.find(l => l.id === scenario.resourceAccessLevel)?.name}"
                      </p>
                    )}
                    {!scenario.actorIsOwner && !scenario.resourceIsShared && scenario.actorSameDepartment && (
                      <p className="mt-1">• Ресурс находится в том же департаменте</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Правила расшаривания */}
        <div className="glass rounded-2xl p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-2">Правила расшаривания</h2>
            <p className="text-white/60 text-sm">
              Кто кому может расшарить ресурсы
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-white/60 font-medium">Роль</th>
                  <th className="text-left py-3 px-4 text-white/60 font-medium">Может расшарить</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Crown className="w-5 h-5 text-purple-400" />
                      <span className="font-medium text-white">Суперадмин</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-white/70">
                    Кому угодно (глобальный доступ)
                  </td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-cyan-400" />
                      <span className="font-medium text-white">Владелец</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-white/70">
                    Всем в организации
                  </td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-blue-400" />
                      <span className="font-medium text-white">Админ/Руководитель</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-white/70">
                    <ul className="list-disc list-inside space-y-1">
                      <li>Владельцу и Суперадмину</li>
                      <li>Другим админам (любой департамент)</li>
                      <li>Сотрудникам своего департамента</li>
                    </ul>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <User className="w-5 h-5 text-green-400" />
                      <span className="font-medium text-white">Сотрудник</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-white/70">
                    Только в своём департаменте
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
