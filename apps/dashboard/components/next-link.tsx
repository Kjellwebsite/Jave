import Link from 'next/link';
import type { LinkLikeProps } from '@jave/ui';

/** Adapter so router-agnostic @jave/ui components navigate client-side. */
export function NextLink(props: LinkLikeProps) {
  return <Link {...props} />;
}
