import { useEffect, useState } from 'react';

export type Route = 'home' | 'method' | 'setup' | 'assessment' | 'report' | 'library' | 'review';

const ROUTES: Route[] = ['home', 'method', 'setup', 'assessment', 'report', 'library', 'review'];

const parse = (): Route => {
  const token = window.location.hash.replace(/^#/, '');
  return (ROUTES as string[]).includes(token) ? (token as Route) : 'home';
};

export function navigate(route: Route) {
  const hash = route === 'home' ? '' : `#${route}`;
  if (window.location.hash !== hash) {
    if (hash) window.location.hash = hash;
    else history.pushState(null, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return route;
}
