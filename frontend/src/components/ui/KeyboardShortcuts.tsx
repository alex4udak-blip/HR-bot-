import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard } from 'lucide-react';

interface Shortcut {
  key: string;
  description: string;
  global?: boolean;
}

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { key: '?', description: 'Показать горячие клавиши', global: true },
  { key: 'Esc', description: 'Закрыть модальное окно', global: true },
  { key: '/', description: 'Фокус на поиск', global: true },
  { key: 'N', description: 'Создать новый элемент' },
  { key: 'K', description: 'Переключить Kanban-вид' },
];

interface KeyboardShortcutsProps {
  shortcuts?: Shortcut[];
  onShortcut?: (key: string) => void;
  showHint?: boolean;
}

export default function KeyboardShortcuts({
  shortcuts = DEFAULT_SHORTCUTS,
  onShortcut,
  showHint = true
}: KeyboardShortcutsProps) {
  const [showModal, setShowModal] = useState(false);
  const [hintVisible, setHintVisible] = useState(showHint);

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
      const shortcut = shortcuts.find(s => s.key.toUpperCase() === key);
      if (shortcut) {
        e.preventDefault();
        onShortcut(shortcut.key);
      }
    }
  }, [showModal, shortcuts, onShortcut]);

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
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Keyboard className="w-5 h-5 text-blue-400" />
                  </div>
                  <h2 className="text-lg font-semibold">Горячие клавиши</h2>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-2">
                  {shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.key}
                      className="flex items-center justify-between py-2 px-3 bg-white/5 rounded-lg"
                    >
                      <span className="text-white/80">{shortcut.description}</span>
                      <kbd className="px-2 py-1 bg-white/10 rounded text-white/90 font-mono text-sm min-w-[40px] text-center">
                        {shortcut.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
