import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SettingsWindow } from './SettingsWindow';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';

createRoot(root).render(
  <React.StrictMode>{isSettingsWindow ? <SettingsWindow /> : <App />}</React.StrictMode>
);
