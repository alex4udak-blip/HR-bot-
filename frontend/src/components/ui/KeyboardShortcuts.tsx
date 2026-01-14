import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard, Search } from 'lucide-react';
import { formatShortcut, CATEGORY_LABELS, type KeyboardShortcut, type ShortcutCategory } from '@/hooks/useKeyboardShortcuts';

/**
 * Legacy shortcut interface for backward compatibility
 */
interface LegacyShortcut {
  key: string;
  description: string;
  global?: boolean;
}

/**
 * Extended shortcut for the new system
 */
interface ExtendedShortcut extends KeyboardShortcut {
  category?: ShortcutCategory;
}

const DEFAULT_SHORTCUTS: ExtendedShortcut[] = [
  { key: '?', handler: () => {}, description: 'Показать горячие клавиши', global: true, category: 'general' },
  { key: 'Escape', handler: () => {}, description: 'Закрыть модальное окно', global: true, category: 'general' },
  { key: '/', handler: () => {}, description: 'Фокус на поиск', global: true, category: 'navigation' },
  { key: 'n', ctrlOrCmd: true, handler: () => {}, description: 'Создать новый элемент', category: 'actions' },
  { key: 'k', handler: () => {}, description: 'Переключить Kanban-вид', category: 'vacancies' },
];

interface KeyboardShortcutsProps {
  /** Shortcuts to display - can be legacy or extended format */
  shortcuts?: LegacyShortcut[] | ExtendedShortcut[];
  /** Callback when a shortcut is triggered */
  onShortcut?: (key: string) => void;
  /** Show hint tooltip */
  showHint?: boolean;
  /** Group shortcuts by category */
  grouped?: boolean;
  /** Enable search in modal */
  searchable?: boolean;
}

/**
 * Convert legacy shortcuts to extended format
 */
function normalizeShortcuts(shortcuts: (LegacyShortcut | ExtendedShortcut)[]): ExtendedShortcut[] {
  return shortcuts.map(s => {
    if ('handler' in s) return s as ExtendedShortcut;
    return {
      ...s,
      handler: () => {},
      category: s.global ? 'general' : 'actions',
    } as ExtendedShortcut;
  });
}

/**
 * Shortcut key badge component
 */
function ShortcutKeyBadge({ shortcut }: { shortcut: ExtendedShortcut }) {
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

export default function KeyboardShortcuts({
  shortcuts = DEFAULT_SHORTCUTS,
  onShortcut,
  showHint = true,
  grouped = false,
  searchable = false,
}: KeyboardShortcutsProps) {
  const [showModal, setShowModal] = useState(false);
  const [hintVisible, setHintVisible] = useState(showHint);
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedShortcuts = useMemo(() => normalizeShortcuts(shortcuts), [shortcuts]);

  // Group shortcuts by category
  const groupedShortcuts = useMemo(() => {
    if (!grouped) return null;

    const groups: Record<ShortcutCategory, ExtendedShortcut[]> = {
      navigation: [],
      actions: [],
      candidates: [],
      vacancies: [],
      kanban: [],
      general: [],
    };

    for (const shortcut of normalizedShortcuts) {
      const category = shortcut.category || 'general';
      groups[category].push(shortcut);
    }

    return Object.entries(groups)
      .filter(([, items]) => items.length > 0)
      .map(([category, items]) => ({
        category: category as ShortcutCategory,
        shortcuts: items,
      }));
  }, [normalizedShortcuts, grouped]);

  // Filter shortcuts by search query
  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) {
      return grouped ? groupedShortcuts : normalizedShortcuts;
    }

    const query = searchQuery.toLowerCase();
    const filtered = normalizedShortcuts.filter(
      s =>
        s.description?.toLowerCase().includes(query) ||
        s.key.toLowerCase().includes(query) ||
        s.sequence?.some(k => k.toLowerCase().includes(query))
    );

    if (!grouped) return filtered;

    // Re-group filtered shortcuts
    const groups: Record<ShortcutCategory, ExtendedShortcut[]> = {
      navigation: [],
      actions: [],
      candidates: [],
      vacancies: [],
      kanban: [],
      general: [],
    };

    for (const shortcut of filtered) {
      const category = shortcut.category || 'general';
      groups[category].push(shortcut);
    }

    return Object.entries(groups)
      .filter(([, items]) => items.length > 0)
      .map(([category, items]) => ({
        category: category as ShortcutCategory,
        shortcuts: items,
      }));
  }, [normalizedShortcuts, groupedShortcuts, grouped, searchQuery]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if user is typing in an input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Show shortcuts modal
    if (e.key === '?') {
      e.preventDefault();
      setShowModal(true);
      setHintVisible(false);
      return;
    }

    // Close modal on Escape
    if (e.key === 'Escape' && showModal) {
      e.preventDefault();
      setShowModal(false);
      return;
    }

    // Focus search on /
    if (e.key === '/') {
      e.preventDefault();
      const searchInput = document.querySelector('input[type="text"][placeholder*="Поиск"]') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
      }
      onShortcut?.('/');
      return;
    }

    // Pass other shortcuts to handler
    if (onShortcut) {
      const key = e.key.toUpperCase();
      const shortcut = normalizedShortcuts.find(s => s.key.toUpperCase() === key);
      if (shortcut) {
        e.preventDefault();
        onShortcut(shortcut.key);
      }
    }
  }, [showModal, normalizedShortcuts, onShortcut]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Hide hint after 5 seconds
  useEffect(() => {
    if (hintVisible) {
      const timer = setTimeout(() => setHintVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [hintVisible]);

  // Reset search when modal closes
  useEffect(() => {
    if (!showModal) {
      setSearchQuery('');
    }
  }, [showModal]);

  return (
    <>
      {/* Floating hint */}
      <AnimatePresence>
        {hintVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 bg-gray-800/90 backdrop-blur-sm border border-white/10 rounded-lg shadow-lg cursor-pointer"
            onClick={() => {
              setShowModal(true);
              setHintVisible(false);
            }}
          >
            <Keyboard className="w-4 h-4 text-white/60" />
            <span className="text-sm text-white/60">
              Нажмите <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/80 font-mono text-xs">?</kbd> для справки
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shortcuts modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-xl max-h-[80vh] overflow-hidden shadow-2xl"
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
                      в любое время
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search */}
              {searchable && (
                <div className="p-4 border-b border-white/10">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <input
                      type="text"
                      placeholder="Поиск по шорткатам..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                      autoFocus
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
              )}

              {/* Shortcuts list */}
              <div className="p-4 max-h-[60vh] overflow-y-auto">
                {grouped && Array.isArray(filteredShortcuts) && filteredShortcuts.length > 0 ? (
                  <div className="space-y-6">
                    {(filteredShortcuts as { category: ShortcutCategory; shortcuts: ExtendedShortcut[] }[]).map((group) => (
                      <div key={group.category}>
                        <h3 className="text-sm font-semibold text-white/60 mb-3 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                          {CATEGORY_LABELS[group.category]}
                        </h3>
                        <div className="space-y-1.5">
                          {group.shortcuts.map((shortcut, index) => (
                            <div
                              key={`${shortcut.key}-${index}`}
                              className="flex items-center justify-between py-2.5 px-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
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
                ) : (
                  <div className="space-y-2">
                    {(filteredShortcuts as ExtendedShortcut[]).map((shortcut, index) => (
                      <div
                        key={`${shortcut.key}-${index}`}
                        className="flex items-center justify-between py-2.5 px-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        <span className="text-white/80">{shortcut.description}</span>
                        <ShortcutKeyBadge shortcut={shortcut} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty state */}
                {((Array.isArray(filteredShortcuts) && filteredShortcuts.length === 0) ||
                  (!Array.isArray(filteredShortcuts) && Object.keys(filteredShortcuts || {}).length === 0)) && (
                  <div className="text-center py-8 text-white/50">
                    <Keyboard className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Шорткаты не найдены</p>
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
    </>
  );
}
