import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { bootstrap } from './app/bootstrap';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('The #root element is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <App boot={bootstrap(window.location)} />
  </StrictMode>,
);
