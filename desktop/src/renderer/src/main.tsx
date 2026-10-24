import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const PetWindow = lazy(() =>
  import('./PetWindow').then((module) => ({ default: module.PetWindow }))
);

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

const windowKind = new URLSearchParams(window.location.search).get('window');
if (windowKind === 'pet') document.documentElement.classList.add('is-pet-window');

createRoot(root).render(
  <React.StrictMode>
    {windowKind === 'pet' ? (
      <Suspense fallback={null}>
        <PetWindow />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
