import { createClient } from '@supabase/supabase-js';

const rawUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  (import.meta.env as any).SUPABASE_URL ||
  (import.meta.env as any).NEXT_PUBLIC_SUPABASE_URL;

const rawAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  (import.meta.env as any).SUPABASE_ANON_KEY ||
  (import.meta.env as any).NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  (import.meta.env as any).SUPABASE_PUBLISHABLE_KEY ||
  (import.meta.env as any).VITE_SUPABASE_PUBLISHABLE_KEY ||
  (import.meta.env as any).SUPABASE_KEY;

const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : rawUrl;
const trimmedAnonKey = typeof rawAnonKey === 'string' ? rawAnonKey.trim() : rawAnonKey;

/** Shown on screen instead of a blank page when env vars are missing. */
export const configError =
  !trimmedUrl || !trimmedAnonKey
    ? 'Missing Supabase credentials (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Please ensure they are added to your Vercel Environment Variables (or .env.local locally) and redeploy.'
    : null;

// "same-origin" is used only by the local development stack (services proxied by Vite).
const url = trimmedUrl === 'same-origin' ? window.location.origin : trimmedUrl;

export const supabase = createClient(url || 'http://localhost.invalid', trimmedAnonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const isLocalStack = import.meta.env.VITE_LOCAL_STACK === 'true';
