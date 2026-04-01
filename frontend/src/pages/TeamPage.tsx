import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users,
  FolderKanban,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import * as api from '@/services/api';

// Use the type from the backend response (array of user objects)
interface ResourceUser {
  user_id: number;
  user_name: string;
  projects: {
    project_id: number;
    project_name: string;
    project_status: string;
    role: string;
    allocation_percent: number;
  }[];
  total_allocation: number;
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function TeamPage() {
  const navigate = useNavigate();
  const [resources, setResources] = useState<ResourceUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  useEffect(() => {
    api.getResourceAllocation()
      .then((data: any) => {
        // Backend returns array directly or { users: [...] }
        const users = Array.isArray(data) ? data : (data?.users || []);
        setResources(users);
      })
      .catch(() => setResources([]))
      .finally(() => setIsLoading(false));
  }, []);

  const toggle = (uid: number) => {
    setCollapsed((prev) => ({ ...prev, [uid]: !prev[uid] }));
  };

  const ROLE_LABELS: Record<string, string> = {
    manager: 'Менеджер',
    developer: 'Разработчик',
    reviewer: 'Ревьюер',
    observer: 'Наблюдатель',
  };

  const STATUS_LABELS: Record<string, string> = {
    planning: 'Планирование',
    active: 'В разработке',
    on_hold: 'На паузе',
    completed: 'Завершён',
    cancelled: 'Отменён',
  };

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Users className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Команда</h1>
          <p className="text-[11px] text-white/30">Распределение ресурсов по проектам</p>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && resources.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <Users className="w-10 h-10 text-white/10 mb-3" />
          <p className="text-sm text-white/30">Нет данных о команде</p>
          <p className="text-xs text-white/15 mt-1">Добавьте участников в проекты</p>
        </div>
      )}

      {/* Resource allocation table */}
      {!isLoading && resources.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_100px_100px] gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/20 border-b border-white/5">
            <span>Участник</span>
            <span>Проектов</span>
            <span>Загрузка</span>
          </div>

          {resources.map((user) => {
            const isCollapsed = collapsed[user.user_id] ?? true;
            const overloaded = user.total_allocation > 100;

            return (
              <div key={user.user_id} className="border-b border-white/[0.04] last:border-b-0">
                {/* User row */}
                <button
                  onClick={() => toggle(user.user_id)}
                  className="w-full grid grid-cols-[1fr_100px_100px] gap-2 px-4 py-3 items-center hover:bg-white/[0.03] transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed
                      ? <ChevronRight className="w-4 h-4 text-white/20" />
                      : <ChevronDown className="w-4 h-4 text-white/20" />
                    }
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center border border-white/10">
                      <span className="text-xs text-white/70 font-medium">
                        {user.user_name?.charAt(0).toUpperCase() || '?'}
                      </span>
                    </div>
                    <span className="text-sm text-white font-medium">{user.user_name}</span>
                  </div>

                  <span className="text-xs text-white/40">{user.projects.length}</span>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden max-w-[60px]">
                      <div
                        className={clsx('h-full rounded-full', {
                          'bg-emerald-400': user.total_allocation <= 80,
                          'bg-amber-400': user.total_allocation > 80 && user.total_allocation <= 100,
                          'bg-red-400': overloaded,
                        })}
                        style={{ width: `${Math.min(user.total_allocation, 100)}%` }}
                      />
                    </div>
                    <span className={clsx('text-xs font-medium', {
                      'text-emerald-400': user.total_allocation <= 80,
                      'text-amber-400': user.total_allocation > 80 && user.total_allocation <= 100,
                      'text-red-400': overloaded,
                    })}>
                      {user.total_allocation}%
                    </span>
                  </div>
                </button>

                {/* Projects breakdown */}
                {!isCollapsed && user.projects.map((proj) => (
                  <motion.div
                    key={proj.project_id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="grid grid-cols-[1fr_100px_100px] gap-2 px-4 py-2 pl-16 items-center hover:bg-white/[0.02] cursor-pointer border-t border-white/[0.02]"
                    onClick={() => navigate(`/projects/${proj.project_id}`)}
                  >
                    <div className="flex items-center gap-2">
                      <FolderKanban className="w-3.5 h-3.5 text-white/20" />
                      <span className="text-xs text-white/60">{proj.project_name}</span>
                      <span className="text-[10px] text-white/20">{STATUS_LABELS[proj.project_status] || proj.project_status}</span>
                    </div>
                    <span className="text-[10px] text-white/30">{ROLE_LABELS[proj.role] || proj.role}</span>
                    <span className="text-[10px] text-white/30">{proj.allocation_percent}%</span>
                  </motion.div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
