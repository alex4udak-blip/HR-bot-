import { Skeleton } from '@/components/ui';

/**
 * Skeleton component with animated pulse effect for vacancy cards.
 * Matches the layout of actual vacancy cards:
 * - Title placeholder (wider)
 * - Status badge placeholder
 * - Description/info placeholders (location, salary, employment type)
 * - Footer with candidates count and tags
 */
export default function VacancyCardSkeleton() {
  return (
    <div className="p-4 glass-light rounded-xl animate-pulse">
      {/* Header: Title and Status Badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          {/* Title placeholder - wider */}
          <Skeleton variant="text" className="h-6 w-3/4 mb-2" />
          {/* Status badge placeholder */}
          <Skeleton variant="rounded" className="h-5 w-20" />
        </div>
        {/* Priority badge placeholder */}
        <Skeleton variant="rounded" className="h-5 w-16 ml-2" />
      </div>

      {/* Description placeholders - info rows */}
      <div className="space-y-2">
        {/* Location row */}
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" className="h-4 w-28" />
        </div>
        {/* Salary row */}
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" className="h-4 w-36" />
        </div>
        {/* Employment type row */}
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" className="h-4 w-32" />
        </div>
      </div>

      {/* Footer: Candidates count and stage indicators */}
      <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
        {/* Candidates count */}
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" className="h-4 w-24" />
        </div>
        {/* Stage count badges */}
        <div className="flex gap-1">
          <Skeleton variant="rounded" className="h-5 w-8" />
          <Skeleton variant="rounded" className="h-5 w-8" />
          <Skeleton variant="rounded" className="h-5 w-8" />
        </div>
      </div>

      {/* Tags row */}
      <div className="mt-3 flex flex-wrap gap-1">
        <Skeleton variant="rounded" className="h-5 w-14" />
        <Skeleton variant="rounded" className="h-5 w-16" />
        <Skeleton variant="rounded" className="h-5 w-12" />
      </div>
    </div>
  );
}
