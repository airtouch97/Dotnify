/** Lightweight skeleton block for loading states (soft shimmer; static under reduced motion). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden="true" />;
}

/** A row of skeletons mimicking a table row. */
export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-black/[0.05] last:border-b-0 dark:border-white/[0.06]">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

/** A stack of list-row skeletons inside a surface. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="surface overflow-hidden" role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-black/[0.05] px-5 py-4 last:border-b-0 dark:border-white/[0.06]">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
