import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKeyboardShortcuts, type KeyboardShortcut } from '@/hooks/useKeyboardShortcuts';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';

/**
 * Props for GlobalShortcuts component
 */
interface GlobalShortcutsProps {
  /** Callback for creating a new candidate */
  onCreateCandidate?: () => void;
  /** Callback for creating a new vacancy */
  onCreateVacancy?: () => void;
  /** Callback for uploading a resume */
  onUploadResume?: () => void;
  /** Callback for opening global search */
  onOpenSearch?: () => void;
  /** Children to render */
  children?: React.ReactNode;
}

/**
 * GlobalShortcuts - Provides application-wide keyboard shortcuts
 */
export default function GlobalShortcuts({
  onCreateCandidate,
  onCreateVacancy,
  onUploadResume,
  onOpenSearch,
  children,
}: GlobalShortcutsProps) {
  const navigate = useNavigate();
  const [showHelp, setShowHelp] = useState(false);
  const [pendingSequence, setPendingSequence] = useState<string | null>(null);

  // Check if any modal is open (to avoid conflicts)
  const isModalOpen = showHelp;

  // Navigation shortcuts (G then X)
  const handleGoToCandidates = useCallback(() => {
    navigate('/candidates');
  }, [navigate]);

  const handleGoToVacancies = useCallback(() => {
    navigate('/vacancies');
  }, [navigate]);

  const handleGoToSettings = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleGoToDashboard = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

  const handleGoToChats = useCallback(() => {
    navigate('/chats');
  }, [navigate]);

  // Action shortcuts
  const handleCreateCandidate = useCallback(() => {
    if (onCreateCandidate) {
      onCreateCandidate();
    } else {
      navigate('/candidates?action=create');
    }
  }, [navigate, onCreateCandidate]);

  const handleCreateVacancy = useCallback(() => {
    if (onCreateVacancy) {
      onCreateVacancy();
    } else {
      navigate('/vacancies?action=create');
    }
  }, [navigate, onCreateVacancy]);

  const handleUploadResume = useCallback(() => {
    if (onUploadResume) {
      onUploadResume();
    } else {
      navigate('/candidates?action=upload');
    }
  }, [navigate, onUploadResume]);

  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  const handleOpenSearch = useCallback(() => {
    if (onOpenSearch) {
      onOpenSearch();
    }
  }, [onOpenSearch]);

  // Define global shortcuts
  const globalShortcuts: KeyboardShortcut[] = [
    // Help
    {
      id: 'global-help',
      key: '/',
      ctrlOrCmd: true,
      handler: handleShowHelp,
      description: 'Показать горячие клавиши',
      category: 'general',
      global: true,
    },
    {
      id: 'global-help-question',
      key: '?',
      handler: handleShowHelp,
      description: 'Показать справку',
      category: 'general',
      global: true,
    },

    // Global search
    {
      id: 'global-search',
      key: 'k',
      ctrlOrCmd: true,
      handler: handleOpenSearch,
      description: 'Глобальный поиск',
      category: 'navigation',
      global: true,
    },

    // Create actions
    {
      id: 'create-candidate',
      key: 'n',
      ctrlOrCmd: true,
      handler: handleCreateCandidate,
      description: 'Создать кандидата',
      category: 'actions',
      global: true,
    },
    {
      id: 'create-vacancy',
      key: 'n',
      ctrlOrCmd: true,
      shift: true,
      handler: handleCreateVacancy,
      description: 'Создать вакансию',
      category: 'actions',
      global: true,
    },
    {
      id: 'upload-resume',
      key: 'u',
      ctrlOrCmd: true,
      handler: handleUploadResume,
      description: 'Загрузить резюме',
      category: 'actions',
      global: true,
    },

    // Close modal
    {
      id: 'close-modal',
      key: 'Escape',
      handler: () => setShowHelp(false),
      description: 'Закрыть модальное окно',
      category: 'general',
      global: true,
      allowInInput: true,
    },
  ];

  // Sequence shortcuts (G then X)
  const sequenceShortcuts: KeyboardShortcut[] = [
    {
      id: 'go-to-candidates',
      key: 'c',
      sequence: ['g', 'c'],
      handler: handleGoToCandidates,
      description: 'Перейти к кандидатам',
      category: 'navigation',
      global: true,
    },
    {
      id: 'go-to-vacancies',
      key: 'v',
      sequence: ['g', 'v'],
      handler: handleGoToVacancies,
      description: 'Перейти к вакансиям',
      category: 'navigation',
      global: true,
    },
    {
      id: 'go-to-settings',
      key: 's',
      sequence: ['g', 's'],
      handler: handleGoToSettings,
      description: 'Перейти к настройкам',
      category: 'navigation',
      global: true,
    },
    {
      id: 'go-to-dashboard',
      key: 'd',
      sequence: ['g', 'd'],
      handler: handleGoToDashboard,
      description: 'Перейти на главную',
      category: 'navigation',
      global: true,
    },
    {
      id: 'go-to-chats',
      key: 'h',
      sequence: ['g', 'h'],
      handler: handleGoToChats,
      description: 'Перейти к чатам',
      category: 'navigation',
      global: true,
    },
  ];

  // Use keyboard shortcuts hook
  useKeyboardShortcuts([...globalShortcuts, ...sequenceShortcuts], {
    enabled: !isModalOpen,
  });

  // Sequence indicator timeout
  useEffect(() => {
    if (pendingSequence) {
      const timeout = setTimeout(() => {
        setPendingSequence(null);
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [pendingSequence]);

  // All shortcuts for help modal
  const allShortcuts = [
    {
      category: 'navigation' as const,
      shortcuts: [
        { key: 'k', ctrlOrCmd: true, handler: () => {}, description: 'Глобальный поиск' },
        { key: 'c', sequence: ['g', 'c'], handler: () => {}, description: 'Перейти к кандидатам' },
        { key: 'v', sequence: ['g', 'v'], handler: () => {}, description: 'Перейти к вакансиям' },
        { key: 's', sequence: ['g', 's'], handler: () => {}, description: 'Перейти к настройкам' },
        { key: 'd', sequence: ['g', 'd'], handler: () => {}, description: 'Перейти на главную' },
        { key: 'h', sequence: ['g', 'h'], handler: () => {}, description: 'Перейти к чатам' },
      ],
    },
    {
      category: 'actions' as const,
      shortcuts: [
        { key: 'n', ctrlOrCmd: true, handler: () => {}, description: 'Создать кандидата' },
        { key: 'n', ctrlOrCmd: true, shift: true, handler: () => {}, description: 'Создать вакансию' },
        { key: 'u', ctrlOrCmd: true, handler: () => {}, description: 'Загрузить резюме' },
      ],
    },
    {
      category: 'candidates' as const,
      shortcuts: [
        { key: 'j', handler: () => {}, description: 'Следующий кандидат' },
        { key: 'k', handler: () => {}, description: 'Предыдущий кандидат' },
        { key: 'Enter', handler: () => {}, description: 'Открыть кандидата' },
        { key: 'e', handler: () => {}, description: 'Редактировать' },
        { key: 'd', handler: () => {}, description: 'Удалить (с подтверждением)' },
        { key: 's', handler: () => {}, description: 'Изменить статус' },
        { key: ' ', handler: () => {}, description: 'Выбрать / снять выбор' },
      ],
    },
    {
      category: 'kanban' as const,
      shortcuts: [
        { key: '1', handler: () => {}, description: 'Переместить в колонку 1' },
        { key: '2', handler: () => {}, description: 'Переместить в колонку 2' },
        { key: '3', handler: () => {}, description: 'Переместить в колонку 3' },
        { key: '4', handler: () => {}, description: 'Переместить в колонку 4' },
        { key: '5', handler: () => {}, description: 'Переместить в колонку 5' },
        { key: '6', handler: () => {}, description: 'Переместить в колонку 6' },
        { key: 'c', handler: () => {}, description: 'Добавить комментарий' },
        { key: 'i', handler: () => {}, description: 'Назначить интервью' },
      ],
    },
    {
      category: 'general' as const,
      shortcuts: [
        { key: 'Escape', handler: () => {}, description: 'Закрыть модальное окно' },
        { key: '?', handler: () => {}, description: 'Показать справку' },
        { key: '/', ctrlOrCmd: true, handler: () => {}, description: 'Показать горячие клавиши' },
      ],
    },
  ];

  return (
    <>
      {children}

      {/* Sequence indicator */}
      {pendingSequence && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-800/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-lg">
          <span className="text-sm text-white/60">
            Нажмите{' '}
            <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white font-mono text-xs">
              {pendingSequence.toUpperCase()}
            </kbd>
            {' затем ...'}
          </span>
        </div>
      )}

      {/* Help modal */}
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={allShortcuts}
      />
    </>
  );
}
