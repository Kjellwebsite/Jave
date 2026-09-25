import { Skeleton } from '@jave/ui';

export default function LoginLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center px-4 pt-20"
    >
      <span className="sr-only">Loading</span>
      <Skeleton className="size-16" />
      <Skeleton className="mt-7 h-7 w-52" />
      <Skeleton className="mt-12 h-56 w-full max-w-[400px]" />
    </main>
  );
}
