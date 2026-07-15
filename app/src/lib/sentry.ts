import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // "development" | "production"
    integrations: [Sentry.browserTracingIntegration()],
    // Trace fewer requests in production to stay within free-tier limits;
    // capture everything in dev for easier debugging.
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.2 : 1.0
  });
} else if (import.meta.env.MODE === 'production') {
  console.warn('VITE_SENTRY_DSN is not set — error monitoring is disabled.');
}
