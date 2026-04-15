import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider as JotaiProvider } from 'jotai';
import App from './App';
import { ThemeProvider } from './ThemeContext';
import { channelSelectionStore } from './store/channel-selection';
import './assets/main.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JotaiProvider store={channelSelectionStore}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </JotaiProvider>
  </React.StrictMode>,
);
