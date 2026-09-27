import { Skeleton } from '@jave/ui';

const FACTS = 6;
const MESSAGES = 4;
const SIDE_PANELS = 3;

/** Shaped like the ticket page: header, facts, conversation and side panels. */
export default function TicketLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading ticket</span>
      <div className="space-y-3 border-b border-line-subtle pb-7">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: FACTS }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
          {Array.from({ length: MESSAGES }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: SIDE_PANELS }, (_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
      </div>
    </div>
  );
}
