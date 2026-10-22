import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './lib/toast';
import { App } from './App';
import { configError } from './lib/supabase';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err: any) => count < 2 && !['42501', 'PGRST116', '22P02'].includes(err?.code),
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {configError ? (
      <div className="center-page"><h1>Configuration needed</h1><p>{configError}</p></div>
    ) : (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    )}
  </React.StrictMode>,
);
