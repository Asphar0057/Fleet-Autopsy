// App_Shell (visual-redesign design.md): chooses the Landing_View or the
// Simulator_View from location.hash. Navigating assigns location.hash, which
// pushes a history entry, so browser back returns to the landing view. Only one
// of Landing (Backdrop loop) and App (sim loop) is mounted at a time.
import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from './App';
import { Landing } from './Landing';
import { parseRoute, routeHash } from './route';
import type { Route } from './route';

export function Root() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  // Drawer state; the HowItWorks drawer that reads it arrives in task 8.
  const [, setDrawerOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Each view starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const navigate = useCallback((r: Route) => {
    window.location.hash = routeHash(r);
  }, []);

  const openDrawer = useCallback((opener: HTMLElement) => {
    openerRef.current = opener;
    setDrawerOpen(true);
  }, []);

  return route === 'app' ? (
    <App onHome={() => navigate('landing')} onHowItWorks={openDrawer} />
  ) : (
    <Landing onEnter={() => navigate('app')} onHowItWorks={openDrawer} />
  );
}
