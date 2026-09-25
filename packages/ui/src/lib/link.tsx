import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';

export interface LinkLikeProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  children?: ReactNode;
}

/**
 * The design system does not depend on a router. Components that render
 * links accept a link component (e.g. Next.js `Link`) and default to `<a>`.
 */
export type LinkComponent = ComponentType<LinkLikeProps>;

export function PlainLink(props: LinkLikeProps) {
  return <a {...props} />;
}
