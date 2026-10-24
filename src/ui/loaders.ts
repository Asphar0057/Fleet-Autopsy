// Layout manifest and layout loaders, shared by App and the landing Backdrop.
import { parseLayout } from '../sim/layout';
import type { Layout, LayoutManifest, LayoutMeta } from '../sim/layout';

export async function loadManifest(): Promise<LayoutMeta[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}layouts/layouts.json`);
  if (!res.ok) throw new Error(`layouts.json: http ${res.status}`);
  return ((await res.json()) as LayoutManifest).layouts;
}

export async function loadLayout(meta: LayoutMeta): Promise<Layout> {
  const res = await fetch(`${import.meta.env.BASE_URL}layouts/${meta.file}`);
  if (!res.ok) throw new Error(`${meta.file}: http ${res.status}`);
  return parseLayout(meta, await res.text());
}
