import { supabase } from './supabaseClient';
import { Question } from '../types';
import { buildFingerprintVariants } from '../utils/questionDedupe';

type SeenRowInput = {
  user_id: string;
  module: string;
  source_type: string;
  question_id: string;
  fingerprint: string;
};

export const fetchSeenFingerprints = async (userId: string, moduleId: string) => {
  const { data, error } = await supabase
    .from('user_seen_questions')
    .select('fingerprint')
    .eq('user_id', userId)
    .eq('module', moduleId);
  if (error) throw error;
  return (data || []).map((row: any) => row.fingerprint as string);
};

export const recordSeenQuestions = async (
  userId: string,
  moduleId: string,
  questions: Question[]
) => {
  if (!questions.length) return;
  const rows: SeenRowInput[] = [];
  questions.forEach((question) => {
    const variants = Array.from(new Set(buildFingerprintVariants(question)));
    variants.forEach((fingerprint) => {
      rows.push({
        user_id: userId,
        module: moduleId,
        source_type: question.sourceType || 'generated',
        question_id: question.id,
        fingerprint
      });
    });
  });
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('user_seen_questions')
    .upsert(rows, { onConflict: 'user_id,module,fingerprint' });
  if (error) throw error;
};
