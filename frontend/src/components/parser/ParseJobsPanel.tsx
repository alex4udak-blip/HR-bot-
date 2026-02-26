import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, X, FileText, ExternalLink, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import type { ParseJob, ParseJobsListResponse } from '@/services/api';
import { getParseJobs, cancelParseJob } from '@/services/api';

interface ParseJobsPanelProps {
  /** Refresh trigger - increment to force refresh */
  refreshTrigger?: number;
  /** Callback when a job completes */
  onJobComplete?: (job: ParseJob) => void;
}

/**
 * Panel showing active parsing jobs with status updates.
 * Polls for updates while there are pending/processing jobs.
 */
export default function ParseJobsPanel({ refreshTrigger, onJobComplete }: ParseJobsPanelProps) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<ParseJob[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [processingCount, setProcessingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Track completed jobs to avoid duplicate toasts (use ref to avoid re-renders)
  const notifiedJobIds = useRef<Set<number>>(new Set());
  // Track jobs that were processing when component mounted
  const initialProcessingIds = useRef<Set<number> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const response: ParseJobsListResponse = await getParseJobs({ limit: 20 });
      setJobs(response.jobs);
      setPendingCount(response.pending_count);
      setProcessingCount(response.processing_count);

      // On first fetch, remember which jobs are already processing/completed
      // to avoid showing toast for jobs that were already done before we started watching
      if (initialProcessingIds.current === null) {
        initialProcessingIds.current = new Set(
          response.jobs
            .filter(j => j.status === 'processing' || j.status === 'pending')
            .map(j => j.id)
        );
        // Also mark already-completed jobs as notified
        response.jobs
          .filter(j => j.status === 'completed')
          .forEach(j => notifiedJobIds.current.add(j.id));
      }

      // Check for newly completed jobs (only those we were tracking as processing)
      response.jobs.forEach((job) => {
        const wasTracking = initialProcessingIds.current?.has(job.id);
        const alreadyNotified = notifiedJobIds.current.has(job.id);

        if (job.status === 'completed' && wasTracking && !alreadyNotified) {
          notifiedJobIds.current.add(job.id);
          if (onJobComplete) {
            onJobComplete(job);
          }
          // Show success toast
          toast.success(
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>"{job.entity_name || job.file_name}" создан</span>
            </div>,
            { duration: 5000, id: `parse-job-${job.id}` }
          );
        }
      });
    } catch (error) {
      console.error('Failed to fetch parse jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [onJobComplete]);

  // Initial fetch
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshTrigger]);

  // Poll for updates while there are active jobs
  useEffect(() => {
    if (pendingCount === 0 && processingCount === 0) return;

    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, [pendingCount, processingCount, fetchJobs]);

  const handleCancel = async (jobId: number) => {
    try {
      await cancelParseJob(jobId);
      toast.success('Парсинг отменён');
      fetchJobs();
    } catch {
      toast.error('Не удалось отменить');
    }
  };

  const handleNavigateToEntity = (entityId: number) => {
    navigate(`/contacts/${entityId}`);
  };

  // Filter to show only recent jobs (last 10 minutes) or active ones
  const recentJobs = jobs.filter((job) => {
    if (job.status === 'pending' || job.status === 'processing') return true;
    const createdAt = new Date(job.created_at).getTime();
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    return createdAt > tenMinutesAgo;
  });

  if (loading) return null;
  if (recentJobs.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900/50 backdrop-blur-sm border border-white/10 rounded-xl p-3 mb-4"
    >
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-medium text-white">Парсинг резюме</h3>
        {(pendingCount > 0 || processingCount > 0) && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">
            {pendingCount + processingCount} в процессе
          </span>
        )}
      </div>

      <div className="space-y-2 max-h-48 overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {recentJobs.map((job) => (
            <motion.div
              key={job.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={clsx(
                'flex items-center gap-3 p-2 rounded-lg',
                job.status === 'completed' ? 'bg-green-500/10' :
                job.status === 'failed' ? 'bg-red-500/10' :
                'glass-light'
              )}
            >
              {/* Status icon */}
              <div className="flex-shrink-0">
                {job.status === 'pending' && (
                  <div className="w-5 h-5 rounded-full border-2 border-white/30 flex items-center justify-center">
                    <div className="w-2 h-2 bg-white/30 rounded-full" />
                  </div>
                )}
                {job.status === 'processing' && (
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                )}
                {job.status === 'completed' && (
                  <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                {job.status === 'failed' && (
                  <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                    <X className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>

              {/* Job info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">
                  {job.entity_name || job.file_name}
                </p>
                <p className="text-xs text-white/50">
                  {job.status === 'pending' && 'В очереди...'}
                  {job.status === 'processing' && (
                    <span className="flex items-center gap-1">
                      <span>{job.progress_stage || 'Обработка...'}</span>
                      <span className="text-cyan-400">{job.progress}%</span>
                    </span>
                  )}
                  {job.status === 'completed' && 'Готово'}
                  {job.status === 'failed' && (
                    <span className="text-red-400">{job.error_message || 'Ошибка'}</span>
                  )}
                </p>
              </div>

              {/* Progress bar for processing */}
              {job.status === 'processing' && (
                <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-cyan-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${job.progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {job.status === 'pending' && (
                  <button
                    onClick={() => handleCancel(job.id)}
                    className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-red-400 transition-colors"
                    title="Отменить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                {job.status === 'completed' && job.entity_id && (
                  <button
                    onClick={() => handleNavigateToEntity(job.entity_id!)}
                    className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-cyan-400 transition-colors"
                    title="Открыть контакт"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
