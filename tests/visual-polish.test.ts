// Render and copy tests for the visual-polish spec (Requirement 8.4, 8.5).
// Vitest runs in node without jsdom, and tests/ is type-checked without JSX, so
// components are loaded through a dynamic import whose specifier is a plain
// string: tsc does not follow it, while Vitest compiles the .tsx at run time.
// Effects do not run under renderToString, so Backdrop renders nothing.
import { createElement } from 'react';
import type { FunctionComponent } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CARD_TITLES, LANDING, LANDING_CENTER_CLASS, shortLayoutName } from '../src/ui/copy';

type AnyProps = Record<string, unknown>;

async function component(file: string, name: string): Promise<FunctionComponent<AnyProps>> {
  const spec: string = `../src/ui/${file}.tsx`;
  const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  const c = mod[name];
  if (typeof c !== 'function') throw new Error(`${name} not exported from ${file}`);
  return c as FunctionComponent<AnyProps>;
}

const noop = (): void => undefined;

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const PANEL_PROPS: AnyProps = {
  layout: null,
  rec: null,
  playhead: 0,
  frames: 1,
  series: new Int16Array(0),
  badge: null,
  telemetry: null,
  error: null,
};

describe('Card_Grid render (Requirement 4.2, 4.5, 8.4)', () => {
  it('renders four cards with their titles in order', async () => {
    const Panel = await component('Panel', 'Panel');
    const html = renderToString(createElement(Panel, PANEL_PROPS));
    expect(html).toContain('class="panel cards"');
    expect(count(html, '<section class="card"')).toBe(4);
    expect(html).not.toContain('card--wide');
    let from = 0;
    for (const title of CARD_TITLES) {
      const at = html.indexOf(title, from);
      expect(at, title).toBeGreaterThanOrEqual(from);
      from = at + title.length;
    }
  });

  it('puts an error card spanning all columns above the four cards', async () => {
    const Panel = await component('Panel', 'Panel');
    const html = renderToString(createElement(Panel, { ...PANEL_PROPS, error: 'boom' }));
    expect(count(html, '<section class="card card--wide"')).toBe(1);
    expect(count(html, '<section class="card"')).toBe(4);
    expect(html.indexOf('card card--wide')).toBeLessThan(html.indexOf('<section class="card"'));
    expect(html).toContain('boom');
  });
});

describe('Landing render (Requirement 5.1, 5.2, 8.4)', () => {
  it('renders the centred content, eyebrow, three steps and both actions', async () => {
    const Landing = await component('Landing', 'Landing');
    const html = renderToString(createElement(Landing, { onEnter: noop, onHowItWorks: noop }));
    expect(html).toContain(LANDING_CENTER_CLASS);
    expect(html).toContain(LANDING.eyebrow);
    expect(html).toMatch(/<button[^>]*>Enter the simulator<\/button>/);
    expect(html).toMatch(/<button[^>]*>How it works<\/button>/);
    expect(count(html, 'class="step-num"')).toBe(3);
  });
});

describe('shortLayoutName (Requirement 8.5)', () => {
  it('drops a trailing " Block" and leaves other names unchanged', () => {
    expect(shortLayoutName('Fulfillment Block')).toBe('Fulfillment');
    expect(shortLayoutName('Pocket DC')).toBe('Pocket DC');
    expect(shortLayoutName('Chokepoint')).toBe('Chokepoint');
  });
});
