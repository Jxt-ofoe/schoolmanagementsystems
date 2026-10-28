import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { ClassRow, GradeBand, School, Semester, SubjectRow } from './types';

/** Throw Supabase errors so react-query surfaces them. */
// Without generated DB types, supabase-js infers to-one embeds as arrays; at runtime they are objects. Callers state T explicitly.
export async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function useClasses(schoolId: string | undefined, opts: { includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ['classes', schoolId, !!opts.includeInactive],
    enabled: !!schoolId,
    queryFn: async () => {
      let q = supabase.from('classes').select('*').eq('school_id', schoolId!).order('level_order').order('name').order('section');
      if (!opts.includeInactive) q = q.eq('is_active', true);
      return unwrap<ClassRow[]>(q);
    },
  });
}

export function useSubjects(schoolId: string | undefined, opts: { includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ['subjects', schoolId, !!opts.includeInactive],
    enabled: !!schoolId,
    queryFn: async () => {
      let q = supabase.from('subjects').select('*').eq('school_id', schoolId!).order('name');
      if (!opts.includeInactive) q = q.eq('is_active', true);
      return unwrap<SubjectRow[]>(q);
    },
  });
}

export function useSemesters(schoolId: string | undefined) {
  return useQuery({
    queryKey: ['semesters', schoolId],
    enabled: !!schoolId,
    queryFn: () => unwrap<Semester[]>(
      supabase.from('semesters').select('*, academic_years(name)').eq('school_id', schoolId!).order('starts_on', { ascending: false }),
    ),
  });
}

export function useGradeBands(schoolId: string | undefined) {
  return useQuery({
    queryKey: ['grade_bands', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const scales = await unwrap<{ id: string }[]>(
        supabase.from('grading_scales').select('id').eq('school_id', schoolId!).eq('is_default', true).limit(1),
      );
      if (!scales.length) return { scaleId: null as string | null, bands: [] as GradeBand[] };
      const bands = await unwrap<GradeBand[]>(
        supabase.from('grading_scale_bands').select('*').eq('scale_id', scales[0].id).order('min_score', { ascending: false }),
      );
      return { scaleId: scales[0].id as string | null, bands };
    },
  });
}

export function usePlatformSettings() {
  return useQuery({
    queryKey: ['platform_settings'],
    queryFn: () => unwrap<{ price_per_student: number; currency: string; billing_due_days: number; void_grace_days: number; updated_at: string }>(
      supabase.from('platform_settings').select('*').single(),
    ),
  });
}

export function semesterLabel(s: Semester | undefined | null): string {
  if (!s) return '—';
  return s.academic_years?.name ? `${s.academic_years.name} · ${s.name}` : s.name;
}

export function useSchoolDetails(schoolId: string | undefined) {
  return useQuery({
    queryKey: ['school_details', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const data = await unwrap<School>(
        supabase.from('schools').select('*').eq('id', schoolId!).single()
      );

      // If logo_url is not present or null on the row, check if an uploaded logo exists via API
      if (!data.logo_url) {
        try {
          const res = await fetch(`/api/school/logo?school_id=${schoolId}`);
          if (res.ok) {
            const json = await res.json();
            if (json?.url) {
              data.logo_url = json.url;
            }
          }
        } catch {
          // ignore network fallback error
        }
      }

      return data;
    },
  });
}

