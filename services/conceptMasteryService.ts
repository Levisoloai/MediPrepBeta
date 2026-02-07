import { supabase } from './supabaseClient';

export type ConceptMasteryRow = {
  user_id: string;
  guide_hash: string;
  concept: string;
  alpha: number;
  beta: number;
  attempts: number;
  avg_time_to_answer_ms: number | null;
  tutor_touches: number;
  updated_at: string;
};

export const upsertConceptMasteryRows = async (rows: ConceptMasteryRow[]) => {
  if (!rows || rows.length === 0) return;
  try {
    const { error } = await supabase
      .from('user_concept_mastery')
      .upsert(rows, { onConflict: 'user_id,guide_hash,concept' });
    if (error) {
      // Treat missing table/permissions as optional in v1.
      console.warn('Concept mastery upsert failed:', error.message);
    }
  } catch (err: any) {
    console.warn('Concept mastery upsert exception:', err?.message || err);
  }
};

