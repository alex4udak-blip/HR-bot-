import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, Search, Command } from 'lucide-react';
import clsx from 'clsx';
import {
  useShortcutContext,
  formatShortcut,
  CATEGORY_LABELS,
  type KeyboardShortcut,
  type ShortcutCategory,
} from '@/hooks/useKeyboardShortcuts';

/**
 * Default shortcuts to show when no provider is available
 */
const DEFAULT_SHORTCUTS: { category: ShortcutCategory; shortcuts: KeyboardShortcut[] }[] = [
  {
    category: 'navigation',
    shortcuts: [
      { key: 'k', ctrlOrCmd: true, handler: () => {}, description: 'Глобальный поиск' },
      { key: 'c', sequence: ['g', 'c'], handler: () => {}, description: 'Перейти к кандидатам' },
      { key: 'v', sequence: ['g', 'v'], handler: () => {}, description: 'Перейти к вакансиям' },
      { key: 's', sequence: ['g', 's'], handler: () => {}, description: 'Перейти к настройкам' },
    ],
  },
  {
    category: 'actions',
    shortcuts: [
      { key: 'n', ctrlOrCmd: true, handler: () => {}, description: 'Создать кандидата' },
      { key: 'n', ctrlOrCmd: true, shift: true, handler: () => {}, description: 'Создать вакансию' },
      { key: 'u', ctrlOrCmd: true, handler: () => {}, description: 'Загрузить резюме' },
      { key: '/', ctrlOrCmd: true, handler: () => {}, description: 'Показать шорткаты' },
    ],
  },
  {
    category: 'candidates',
    shortcuts: [
      { key: 'j', handler: () => {}, description: 'Следующий кандидат' },
      { key: 'k', handler: () => {}, description: 'Предыдущий кандидат' },
      { key: 'Enter', handler: () => {}, description: 'Открыть кандидата' },
      { key: 'e', handler: () => {}, description: 'Редактировать' },
      { key: 'd', handler: () => {}, description: 'Удалить' },
      { key: 's', handler: () => {}, description: 'Изменить статус' },
      { key: ' ', handler: () => {}, description: 'Выбрать/снять выбор' },
    ],
  },
  {
    category: 'kanban',
    shortcuts: [
      { key: '1', handler: () => {}, description: 'Переместить в колонку 1' },
      { key: '2', handler: () => {}, description: 'Переместить в колонку 2' },
      { key: '3', handler: () => {}, description: 'Переместить в колонку 3' },
      { key: 'c', handler: () => {}, description: 'Добавить комментарий' },
      { key: 'i', handler: () => {}, description: 'Назначить интервью' },
    ],
  },
  {
    category: 'general',
    shortcuts: [
      { key: 'Escape', handler: () => {}, description: 'Закрыть модальное окно' },
      { key: '?', handler: () => {}, description: 'Показать справку' },
    ],
  },
];

/**
 * Props for KeyboardShortcutsHelp
 */
interface KeyboardShortcutsHelpProps {
  /** External control for showing the modal */
  open?: boolean;
  /** Callback when modal is closed */
  onClose?: () => void;
  /** Custom shortcuts to display (overrides context shortcuts) */
  shortcuts?: { category: ShortcutCategory; shortcuts: KeyboardShortcut[] }[];
}

/**
 * Shortcut key badge component
 */
function ShortcutKeyBadge({ shortcut }: { shortcut: KeyboardShortcut }) {
  const formatted = formatShortcut(shortcut);
  const parts = shortcut.sequence && shortcut.sequence.length > 0
    ? shortcut.sequence.map(k => k.toUpperCase())
    : formatted.split(/[+\s]/);

  return (
    <div className="flex items-center gap-1">
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 && shortcut.sequence && (
            <span className="text-white/30 text-xs mx-0.5">затем</span>
          )}
          <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-white/10 border border-white/20 rounded text-xs font-mono text-white/90">
            {part}
          </kbd>
        </span>
      ))}
    </div>
  );
}

/**
 * KeyboardShortcutsHelp - Modal component for displaying keyboard shortcuts
 */
export default function KeyboardShortcutsHelp({
  open: externalOpen,
  onClose: externalOnClose,
  shortcuts: customShortcuts,
}: KeyboardShortcutsHelpProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Try to use context, fallback to defaults
  let contextValue: {
    showHelp: boolean;
    setShowHelp: (show: boolean) => void;
    shortcuts: KeyboardShortcut[];
  } | null = null;

  try {
    contextValue = useShortcutContext();
  } catch {
    // Context not available, use defaults
  }

  const isOpen = externalOpen ?? contextValue?.showHelp ?? false;
  const handleClose = () => {
    externalOnClose?.();
    contextValue?.setShowHelp(false);
    setSearchQuery('');
  };

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Group shortcuts by category
  const groupedShortcuts = useMemo(() => {
    if (customShortcuts) return customShortcuts;

    if (contextValue?.shortcuts && contextValue.shortcuts.length > 0) {
      const grouped: Record<ShortcutCategory, KeyboardShortcut[]> = {
        navigation: [],
        actions: [],
        candidates: [],
        vacancies: [],
        kanban: [],
        general: [],
      };

      const seen = new Set<string>();
      for (const shortcut of contextValue.shortcuts) {
        const key = `${shortcut.key}-${shortcut.ctrlOrCmd}-${shortcut.shift}-${shortcut.alt}-${shortcut.sequence?.join('-')}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const category = shortcut.category || 'general';
        grouped[category].push(shortcut);
      }

      return Object.entries(grouped)
        .filter(([, shortcuts]) => shortcuts.length > 0)
        .map(([category, shortcuts]) => ({
          category: category as ShortcutCategory,
          shortcuts,
        }));
    }

    return DEFAULT_SHORTCUTS;
  }, [customShortcuts, contextValue?.shortcuts]);

  // Filter shortcuts by search query
  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) return groupedShortcuts;

    const query = searchQuery.toLowerCase();
    return groupedShortcuts
      .map(group => ({
        ...group,
        shortcuts: group.shortcuts.filter(
          s =>
            s.description?.toLowerCase().includes(query) ||
            s.key.toLowerCase().includes(query) ||
            s.sequence?.some(k => k.toLowerCase().includes(query))
        ),
      }))
      .filter(group => group.shortcuts.length > 0);
  }, [groupedShortcuts, searchQuery]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        handleClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Keyboard className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Горячие клавиши</h2>
                  <p className="text-xs text-white/50">
                    Нажмите{' '}
                    <kbd className="px-1 py-0.5 bg-white/10 rounded text-xs font-mono">?</kbd>{' '}
                    или{' '}
                    <kbd className="px-1 py-0.5 bg-white/10 rounded text-xs font-mono">
                      <Command className="w-3 h-3 inline" />/
                    </kbd>{' '}
                    в любое время
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-white/10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Поиск по шорткатам..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Shortcuts list */}
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-180px)]">
              {filteredShortcuts.length === 0 ? (
                <div className="text-center py-8 text-white/50">
                  <Keyboard className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Шорткаты не найдены</p>
                  <p className="text-sm mt-1">Попробуйте другой запрос</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredShortcuts.map((group) => (
                    <div key={group.category}>
                      <h3 className="text-sm font-semibold text-white/60 mb-3 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        {CATEGORY_LABELS[group.category]}
                      </h3>
                      <div className="space-y-1.5">
                        {group.shortcuts.map((shortcut, index) => (
                          <div
                            key={`${shortcut.key}-${index}`}
                            className={clsx(
                              'flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors',
                              'hover:bg-white/5'
                            )}
                          >
                            <span className="text-sm text-white/80">
                              {shortcut.description || formatShortcut(shortcut)}
                            </span>
                            <ShortcutKeyBadge shortcut={shortcut} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-white/10 bg-white/5">
              <p className="text-xs text-white/40 text-center">
                Нажмите <kbd className="px-1 py-0.5 bg-white/10 rounded text-xs font-mono">Esc</kbd> для закрытия
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Standalone shortcut help trigger button
 */
export function ShortcutHelpButton() {
  let contextValue: { setShowHelp: (show: boolean) => void } | null = null;

  try {
    contextValue = useShortcutContext();
  } catch {
    // Context not available
  }

  if (!contextValue) return null;

  return (
    <button
      onClick={() => contextValue?.setShowHelp(true)}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 bg-gray-800/90 backdrop-blur-sm border border-white/10 rounded-lg shadow-lg hover:bg-gray-700/90 transition-colors"
      title="Показать горячие клавиши"
    >
      <Keyboard className="w-4 h-4 text-white/60" />
      <span className="text-sm text-white/60">
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/80 font-mono text-xs">?</kbd>
      </span>
    </button>
  );
}
