import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './lib/sentry';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={<p style={{ textAlign: 'center', marginTop: '4rem' }}>Something went wrong. Please reload.</p>}
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
