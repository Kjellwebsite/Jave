import { Skeleton } from '@jave/ui';

export type SkeletonLayout = 'stats' | 'table' | 'profile' | 'form' | 'list';

const STAT_TILES = 8;
const TABLE_ROWS = 8;
const LIST_ROWS = 6;
const FORM_FIELDS = 5;
const PROFILE_PANELS = 4;

function HeaderSkeleton() {
  return (
    <div className="space-y-3 border-b border-line-subtle pb-7">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-3.5 w-80 max-w-full" />
    </div>
  );
}

/** Route-level loading placeholder shaped like the page it precedes. */
export function PageSkeleton({ layout }: { layout: SkeletonLayout }) {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading</span>
      <HeaderSkeleton />
      {layout === 'stats' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: STAT_TILES }, (_, index) => (
            <div key={index} className="space-y-4 rounded-lg border border-line bg-surface p-5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : null}
      {layout === 'table' || layout === 'list' ? (
        <div className="rounded-lg border border-line bg-surface">
          <div className="flex gap-3 border-b border-line-subtle p-4">
            <Skeleton className="h-8 w-60" />
            <Skeleton className="h-8 w-32" />
          </div>
          <div className="space-y-4 p-5">
            {Array.from({ length: layout === 'table' ? TABLE_ROWS : LIST_ROWS }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="size-8 shrink-0" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="ml-auto h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {layout === 'profile' ? (
        <div className="space-y-6">
          <div className="flex items-center gap-5">
            <Skeleton className="size-16 shrink-0" />
            <div className="flex-1 space-y-2.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: PROFILE_PANELS }, (_, index) => (
              <Skeleton key={index} className="h-40" />
            ))}
          </div>
        </div>
      ) : null}
      {layout === 'form' ? (
        <div className="max-w-2xl space-y-5 rounded-lg border border-line bg-surface p-6">
          {Array.from({ length: FORM_FIELDS }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
