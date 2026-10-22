import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Shown on screen instead of a blank page when env vars are missing. */
export const configError =
  !rawUrl || !anonKey ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.' : null;

// "same-origin" is used only by the local development stack (services proxied by Vite).
const url = rawUrl === 'same-origin' ? window.location.origin : rawUrl;

export const supabase = createClient(url || 'http://localhost.invalid', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const isLocalStack = import.meta.env.VITE_LOCAL_STACK === 'true';
