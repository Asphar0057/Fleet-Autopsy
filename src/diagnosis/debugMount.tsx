// Mounts the diagnosis dev readout only under `?debug=diagnose` (design D14).
// Imported once from src/main.tsx; without the flag it does nothing.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugPanel } from './DebugPanel';

if (new URLSearchParams(window.location.search).get('debug') === 'diagnose') {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'diagnosis debug');
  const root = document.getElementById('root');
  if (root) root.after(section);
  else document.body.appendChild(section);
  createRoot(section).render(
    <StrictMode>
      <DebugPanel />
    </StrictMode>,
  );
}
