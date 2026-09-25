import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { type Route, useRoute } from './router';
import './app.css';

const Landing = lazy(() => import('../pages/Landing'));
const Method = lazy(() => import('../pages/Method'));
const Setup = lazy(() => import('../pages/Setup'));
const Assessment = lazy(() => import('../pages/Assessment'));
const ReportPage = lazy(() => import('../pages/Report'));
const Library = lazy(() => import('../pages/Library'));
const Review = lazy(() => import('../pages/Review'));

const PAGES: Record<Route, React.ComponentType> = {
  home: Landing,
  method: Method,
  setup: Setup,
  assessment: Assessment,
  report: ReportPage,
  library: Library,
  review: Review,
};

const TITLES: Record<Route, string> = {
  home: 'JVLN Intelligence',
  method: 'Method · JVLN Intelligence',
  setup: 'Begin · JVLN Intelligence',
  assessment: 'Assessment · JVLN Intelligence',
  report: 'Report · JVLN Intelligence',
  library: 'Instruments · JVLN Intelligence',
  review: 'Item review · JVLN Intelligence',
};

export function App() {
  const route = useRoute();
  const Page = PAGES[route];
  useEffect(() => {
    document.title = TITLES[route];
    window.scrollTo(0, 0);
  }, [route]);
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Suspense fallback={<div className="page-loading" aria-hidden="true" />}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route}
            className="page-root"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease: [0.2, 0.7, 0.1, 1] }}
          >
            <Page />
          </motion.div>
        </AnimatePresence>
      </Suspense>
    </MotionConfig>
  );
}
