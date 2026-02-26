import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Download,
  Users,
  BarChart3,
  GitBranch,
  ArrowLeft,
  AlertTriangle,
  FileSpreadsheet,
  ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';

type CsvPanel = 'overview' | 'users' | 'analytics' | 'stages';

interface ExportCard {
  id: 'users' | 'analytics' | 'stages';
  icon: typeof Users;
  title: string;
  description: string;
  endpoint: string;
  columns: { name: string; desc: string }[];
}

const EXPORT_CARDS: ExportCard[] = [
  {
    id: 'users',
    icon: Users,
    title: 'Пользователи CSV',
    description:
      'Список пользователей организации: ID, имя, email, роль, активность, Telegram, дата регистрации.',
    endpoint: '/api/exports/users.csv',
    columns: [
      { name: 'id', desc: 'Идентификатор' },
      { name: 'name', desc: 'ФИО' },
      { name: 'email', desc: 'Email' },
      { name: 'role', desc: 'Роль в системе' },
      { name: 'is_active', desc: 'Активен (yes/no)' },
      { name: 'telegram_username', desc: 'Telegram' },
      { name: 'created_at', desc: 'Дата регистрации (ISO)' },
    ],
  },
  {
    id: 'analytics',
    icon: BarChart3,
    title: 'Аналитика CSV',
    description:
      'Ключевые HR-метрики: вакансии, кандидаты, заявки, наймы, отказы, воронка по этапам, статистика по отделам.',
    endpoint: '/api/exports/analytics.csv',
    columns: [
      { name: 'metric', desc: 'Код метрики' },
      { name: 'value', desc: 'Значение' },
      { name: 'description', desc: 'Описание метрики' },
    ],
  },
  {
    id: 'stages',
    icon: GitBranch,
    title: 'Этапы прохождения CSV',
    description:
      'Пайплайн кандидатов по вакансиям: вакансия, кандидат, текущий этап, рейтинг, источник, дата подачи, причина отказа.',
    endpoint: '/api/exports/stages.csv',
    columns: [
      { name: 'vacancy_id', desc: 'ID вакансии' },
      { name: 'vacancy_title', desc: 'Название вакансии' },
      { name: 'candidate_id', desc: 'ID кандидата' },
      { name: 'candidate_name', desc: 'Имя кандидата' },
      { name: 'stage', desc: 'Текущий этап' },
      { name: 'rating', desc: 'Рейтинг' },
      { name: 'source', desc: 'Источник' },
      { name: 'applied_at', desc: 'Дата подачи (ISO)' },
      { name: 'last_stage_change', desc: 'Последнее изменение этапа (ISO)' },
      { name: 'rejection_reason', desc: 'Причина отказа' },
    ],
  },
];

export default function InternsCsvTab() {
  const [activePanel, setActivePanel] = useState<CsvPanel>('overview');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const activeCard = EXPORT_CARDS.find((c) => c.id === activePanel);

  const handleDownloadClick = (endpoint: string) => {
    setDownloadError(null);
    // We use a regular <a> link for the actual download,
    // but this handler can verify connectivity first if needed.
    // The <a> element handles the download natively without blob.
    // If fetch fails or returns non-ok, we show error.
    fetch(endpoint, { method: 'HEAD', credentials: 'same-origin' })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          setDownloadError(
            'Нет доступа к экспорту. Убедитесь, что вы авторизованы и имеете права администратора.',
          );
          return;
        }
        if (!res.ok) {
          setDownloadError(`Ошибка сервера (${res.status}). Попробуйте позже.`);
          return;
        }
        // All good — trigger native download via hidden link
        const a = document.createElement('a');
        a.href = endpoint;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      })
      .catch(() => {
        setDownloadError('Не удалось связаться с сервером. Проверьте подключение к сети.');
      });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 w-full">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
          <h2 className="text-xl font-bold">Выгрузка в CSV</h2>
        </div>
        <p className="text-sm text-white/50">
          Выберите тип данных для экспорта. Файл формируется на сервере и скачивается напрямую.
        </p>
      </div>

      {/* Global error callout */}
      {downloadError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-300">{downloadError}</p>
            <button
              onClick={() => setDownloadError(null)}
              className="mt-2 text-xs text-red-400 hover:text-red-300 underline transition-colors"
            >
              Скрыть
            </button>
          </div>
        </motion.div>
      )}

      {activePanel === 'overview' ? (
        /* ── Cards grid ── */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {EXPORT_CARDS.map((card, idx) => (
            <motion.button
              key={card.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.08 }}
              onClick={() => {
                setActivePanel(card.id);
                setDownloadError(null);
              }}
              className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/30 rounded-xl p-5 text-left group transition-all"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-500/20 flex items-center justify-center mb-4 group-hover:bg-emerald-500/30 transition-colors">
                <card.icon className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold text-white mb-2">{card.title}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{card.description}</p>
            </motion.button>
          ))}
        </div>
      ) : (
        /* ── Detail panel ── */
        activeCard && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-6"
          >
            {/* Back button */}
            <button
              onClick={() => {
                setActivePanel('overview');
                setDownloadError(null);
              }}
              className="flex items-center gap-2 text-white/40 hover:text-white/80 transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Назад к выбору
            </button>

            {/* Card header */}
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <activeCard.icon className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">{activeCard.title}</h3>
                <p className="text-white/40 text-sm">{activeCard.description}</p>
              </div>
            </div>

            {/* Columns preview */}
            <div>
              <h4 className="text-sm font-medium text-white/50 mb-3">Поля в файле:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeCard.columns.map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg border border-white/5"
                  >
                    <code className="text-xs text-emerald-400 font-mono">{col.name}</code>
                    <span className="text-xs text-white/30">&mdash;</span>
                    <span className="text-xs text-white/50">{col.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Download */}
            <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <button
                onClick={() => handleDownloadClick(activeCard.endpoint)}
                className={clsx(
                  'inline-flex items-center gap-3 px-6 py-3 rounded-xl font-medium transition-all',
                  'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30',
                )}
              >
                <Download className="w-5 h-5" />
                Скачать CSV
              </button>
              <a
                href={activeCard.endpoint}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white/40 hover:text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                Открыть в новой вкладке
              </a>
            </div>
            <p className="text-white/30 text-xs">
              Файл формируется на сервере в реальном времени. Имя файла включает текущую дату.
            </p>
          </motion.div>
        )
      )}
    </div>
  );
}
