import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search,
  Phone,
  Mail,
  GraduationCap,
  Trophy,
  Info,
  Clock,
  Users,
  Filter,
  X,
  BarChart3,
  GitBranch,
  MessageSquare,
  Download,
  User
} from 'lucide-react';
import clsx from 'clsx';
import { formatDate } from '@/utils';

// Tabs for interns section
type InternTab = 'interns' | 'analytics' | 'stages' | 'chats' | 'csv';

const INTERN_TABS: { key: InternTab; label: string; icon: typeof GraduationCap }[] = [
  { key: 'interns', label: 'Практиканты', icon: GraduationCap },
  { key: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { key: 'stages', label: 'Этапы прохождения', icon: GitBranch },
  { key: 'chats', label: 'Чаты', icon: MessageSquare },
  { key: 'csv', label: 'Выгрузка в CSV', icon: Download },
];

// Mock intern data for UI demonstration
interface Intern {
  id: number;
  name: string;
  position: string;
  email: string;
  phone: string;
  department: string;
  startDate: string;
  tags: string[];
  mentor: string;
}

const MOCK_INTERNS: Intern[] = [
  {
    id: 1,
    name: 'Тест Алексей Петров',
    position: 'Frontend-разработчик',
    email: 'a.petrov@example.com',
    phone: '+7 (999) 123-45-67',
    department: 'Разработка',
    startDate: '2026-01-15',
    tags: ['React', 'TypeScript'],
    mentor: 'Иван Сидоров',
  },
  {
    id: 2,
    name: 'Тест Мария Иванова',
    position: 'Backend-разработчик',
    email: 'm.ivanova@example.com',
    phone: '+7 (999) 234-56-78',
    department: 'Разработка',
    startDate: '2026-01-20',
    tags: ['Python', 'FastAPI'],
    mentor: 'Анна Козлова',
  },
  {
    id: 3,
    name: 'Тест Дмитрий Смирнов',
    position: 'Data Analyst',
    email: 'd.smirnov@example.com',
    phone: '+7 (999) 345-67-89',
    department: 'Аналитика',
    startDate: '2026-02-01',
    tags: ['SQL', 'Python', 'Tableau'],
    mentor: 'Олег Морозов',
  },
  {
    id: 4,
    name: 'Тест Елена Волкова',
    position: 'UI/UX Дизайнер',
    email: 'e.volkova@example.com',
    phone: '+7 (999) 456-78-90',
    department: 'Дизайн',
    startDate: '2026-02-05',
    tags: ['Figma', 'UI/UX'],
    mentor: 'Светлана Белова',
  },
  {
    id: 5,
    name: 'Тест Николай Кузнецов',
    position: 'QA Engineer',
    email: 'n.kuznetsov@example.com',
    phone: '+7 (999) 567-89-01',
    department: 'Тестирование',
    startDate: '2026-01-25',
    tags: ['Selenium', 'Python'],
    mentor: 'Павел Новиков',
  },
  {
    id: 6,
    name: 'Тест Анна Соколова',
    position: 'DevOps Engineer',
    email: 'a.sokolova@example.com',
    phone: '+7 (999) 678-90-12',
    department: 'Инфраструктура',
    startDate: '2026-02-10',
    tags: ['Docker', 'CI/CD', 'Linux'],
    mentor: 'Дмитрий Орлов',
  },
];

function getAvatarInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

// Stub content for non-implemented tabs
function TabStub({ title, icon: Icon }: { title: string; icon: typeof GraduationCap }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-white/40">
        <Icon className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-2">{title}</h3>
        <p className="text-sm">Раздел в разработке</p>
      </div>
    </div>
  );
}

export default function InternsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<InternTab>('interns');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Filter interns by search and tags
  const filteredInterns = useMemo(() => {
    let result = MOCK_INTERNS;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(intern =>
        intern.name.toLowerCase().includes(query) ||
        intern.email.toLowerCase().includes(query) ||
        intern.phone.includes(query) ||
        intern.position.toLowerCase().includes(query) ||
        intern.department.toLowerCase().includes(query) ||
        intern.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    if (selectedTags.length > 0) {
      result = result.filter(intern =>
        selectedTags.every(tag => intern.tags.includes(tag))
      );
    }

    return result;
  }, [searchQuery, selectedTags]);

  // Get all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    MOCK_INTERNS.forEach(intern => intern.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, []);

  // Render intern card
  const renderInternCard = (intern: Intern) => (
    <motion.div
      key={intern.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors group overflow-hidden flex flex-col"
    >
      <div className="flex items-start gap-2 mb-2">
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-medium text-sm flex-shrink-0">
          {getAvatarInitials(intern.name)}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{intern.name}</h4>
          {intern.position && <p className="text-xs text-white/50 truncate">{intern.position}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2 ml-12">
        <span className="px-2 py-0.5 text-xs rounded-full whitespace-nowrap bg-emerald-500/20 text-emerald-400">
          {intern.department}
        </span>
      </div>

      <div className="space-y-1 text-xs text-white/60 ml-12">
        {intern.email && (
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{intern.email}</span>
          </div>
        )}
        {intern.phone && (
          <div className="flex items-center gap-1.5 truncate">
            <Phone className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{intern.phone}</span>
          </div>
        )}
      </div>

      {intern.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 ml-12">
          {intern.tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-white/60 truncate max-w-[80px]">
              {tag}
            </span>
          ))}
          {intern.tags.length > 3 && (
            <span className="text-xs text-white/40">+{intern.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-2 ml-12 text-xs text-white/40">
        <div className="flex items-center gap-1.5">
          <User className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">Ментор: {intern.mentor}</span>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-white/5 flex items-center text-xs text-white/40 ml-12">
        <div className="flex items-center gap-1 whitespace-nowrap flex-shrink-0">
          <Clock className="w-3 h-3" />
          {formatDate(intern.startDate, 'short')}
        </div>
      </div>

      {/* Action buttons: Успехи and Информация */}
      <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
        <button
          onClick={() => navigate(`/interns/${intern.id}/achievements`)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
        >
          <Trophy className="w-3.5 h-3.5" />
          Успехи
        </button>
        <button
          onClick={() => navigate(`/interns/${intern.id}/info`)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-medium transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
          Информация
        </button>
      </div>
    </motion.div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="px-4 pt-4 border-b border-white/10">
        <div className="flex items-center gap-1 overflow-x-auto pb-0 scrollbar-hide">
          {INTERN_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all border-b-2 -mb-[1px]',
                activeTab === tab.key
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-white/50 hover:text-white/80 hover:border-white/20'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'interns' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-white/10 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap">
                <GraduationCap className="w-6 h-6 text-emerald-400" />
                База практикантов
                <span className="text-sm font-medium text-white/40 bg-white/5 px-2 py-0.5 rounded-full ml-1">
                  {filteredInterns.length}
                </span>
              </h2>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-focus-within:text-emerald-400 transition-colors" />
                <input
                  type="text"
                  placeholder="Поиск по имени, email, навыкам..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-emerald-500/50 focus:bg-white/10 text-sm transition-all"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-all active:scale-95 whitespace-nowrap',
                    selectedTags.length > 0
                      ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  )}
                >
                  <Filter className="w-4 h-4" />
                  <span>Навыки</span>
                  {selectedTags.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-emerald-600 text-white text-[10px] rounded-full">
                      {selectedTags.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Tag filters */}
            {showFilters && allTags.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-3 bg-white/5 rounded-lg border border-white/10 overflow-hidden"
              >
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() =>
                        setSelectedTags(prev =>
                          prev.includes(tag)
                            ? prev.filter(t => t !== tag)
                            : [...prev, tag]
                        )
                      }
                      className={clsx(
                        'px-2.5 py-1 text-xs rounded-full border transition-colors',
                        selectedTags.includes(tag)
                          ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/70'
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {/* Cards Grid */}
          <div className="flex-1 overflow-auto p-4">
            {filteredInterns.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-white/40">
                  <GraduationCap className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium mb-2">
                    {searchQuery || selectedTags.length > 0
                      ? 'Ничего не найдено'
                      : 'Нет практикантов'}
                  </h3>
                  <p className="text-sm">
                    {searchQuery || selectedTags.length > 0
                      ? 'Попробуйте изменить параметры поиска'
                      : 'Практиканты появятся здесь после добавления'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredInterns.map(intern => renderInternCard(intern))}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'analytics' ? (
        <div className="flex-1 overflow-auto p-4">
          <TabStub title="Аналитика" icon={BarChart3} />
        </div>
      ) : activeTab === 'stages' ? (
        <div className="flex-1 overflow-auto p-4">
          <TabStub title="Этапы прохождения" icon={GitBranch} />
        </div>
      ) : activeTab === 'chats' ? (
        <div className="flex-1 overflow-auto p-4">
          <TabStub title="Чаты" icon={MessageSquare} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <TabStub title="Выгрузка в CSV" icon={Download} />
        </div>
      )}
    </div>
  );
}
