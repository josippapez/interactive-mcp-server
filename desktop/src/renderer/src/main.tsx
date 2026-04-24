import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider as JotaiProvider } from 'jotai';
import App from './App';
import { ThemeProvider } from './ThemeContext';
import { channelSelectionStore } from './store/channel-selection';
import { preloadShikiLanguages } from './lib/preload-shiki';
import './assets/main.css';

// Warm Shiki's highlighter cache for hot languages so the first
// diff/code block the user sees highlights instantly. Fire-and-forget;
// each grammar is loaded as a separate async chunk by the bundler.
preloadShikiLanguages();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JotaiProvider store={channelSelectionStore}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </JotaiProvider>
  </React.StrictMode>,
);
