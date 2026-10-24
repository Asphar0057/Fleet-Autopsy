// Hash routing for the App_Shell (visual-redesign design.md). Pure, no DOM.

export type Route = 'landing' | 'app';

export const APP_HASH = '#/app';

/** '#/app' or '#/app/' -> 'app'; anything else (including '' and '#/') -> 'landing'. */
export function parseRoute(hash: string): Route {
  return hash === APP_HASH || hash === `${APP_HASH}/` ? 'app' : 'landing';
}

/** 'app' -> '#/app', 'landing' -> '#/'. */
export function routeHash(r: Route): string {
  return r === 'app' ? APP_HASH : '#/';
}
