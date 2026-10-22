import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Membership, MyContext } from './types';
import { friendlyError } from './errors';

interface AuthState {
  session: Session | null;
  loading: boolean;
  ctx: MyContext | null;
  ctxLoading: boolean;
  ctxError: string | null;
  active: Membership | null;
  recovery: boolean;
  setActiveSchool: (schoolId: string) => void;
  refreshContext: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const ACTIVE_KEY = 'sms.activeSchool';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        setRecovery(false);
        qc.clear();
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [qc]);

  const userId = session?.user.id ?? null;
  const ctxQuery = useQuery({
    queryKey: ['my_context', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_context');
      if (error) throw error;
      return data as MyContext;
    },
  });

  const ctx = ctxQuery.data ?? null;
  const active = useMemo(() => {
    const list = ctx?.memberships ?? [];
    return list.find((m) => m.school_id === activeId) ?? list[0] ?? null;
  }, [ctx, activeId]);

  const setActiveSchool = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_KEY, id);
    setActiveId(id);
    qc.invalidateQueries();
  }, [qc]);

  const refreshContext = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['my_context'] });
  }, [qc]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    qc.clear();
  }, [qc]);

  const value: AuthState = {
    session,
    loading,
    ctx,
    ctxLoading: !!userId && ctxQuery.isLoading,
    ctxError: ctxQuery.error ? friendlyError(ctxQuery.error) : null,
    active,
    recovery,
    setActiveSchool,
    refreshContext,
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

/** Active school for headmaster/teacher pages. Guarded routes guarantee it exists. */
export function useSchool() {
  const { active } = useAuth();
  if (!active) throw new Error('No active school membership');
  return { schoolId: active.school_id, role: active.role, schoolName: active.school_name, membership: active };
}
