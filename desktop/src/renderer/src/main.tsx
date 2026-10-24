import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PetWindow } from './PetWindow';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

const windowKind = new URLSearchParams(window.location.search).get('window');
if (windowKind === 'pet') document.documentElement.classList.add('is-pet-window');

createRoot(root).render(
  <React.StrictMode>{windowKind === 'pet' ? <PetWindow /> : <App />}</React.StrictMode>
);
