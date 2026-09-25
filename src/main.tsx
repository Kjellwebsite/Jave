import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/base.css';
import './components/ui.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
