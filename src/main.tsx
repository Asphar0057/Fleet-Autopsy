// Styles first: tokens.css must be in the document before the renderer reads
// colors from CSS custom properties at mount.
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/landing.css';
import './styles/drawer.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './ui/Root';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
