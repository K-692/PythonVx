import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';
import App from './App';
import { loadScreenshotMock, screenshotMode } from './devScreenshot';
import { useAppStore } from './store';

const mock = screenshotMode();
if (mock) useAppStore.getState().updateSettings({ autoRun: false });

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (mock) setTimeout(() => void loadScreenshotMock(mock), 300);
