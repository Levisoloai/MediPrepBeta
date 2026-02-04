import { supabase } from './supabaseClient';
import { GoldQuestionRow, Question } from '../types';

type GoldStatus = 'draft' | 'approved';
type ModuleId = 'heme' | 'pulm';

const normalizeOptions = (raw: any): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((opt) => String(opt ?? '').trim()).filter((opt) => opt.length > 0);
  }
  if (raw && typeof raw === 'object') {
    const orderedLetterKeys = ['A', 'B', 'C', 'D', 'E', 'a', 'b', 'c', 'd', 'e'];
    const letterValues = orderedLetterKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(raw, key))
      .map((key) => String(raw[key] ?? '').trim())
      .filter((opt) => opt.length > 0);
    if (letterValues.length > 0) {
      return letterValues;
    }
    const numericKeys = Object.keys(raw)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      return numericKeys
        .map((key) => String(raw[key] ?? '').trim())
        .filter((opt) => opt.length > 0);
    }
    return Object.values(raw)
      .map((opt) => String(opt ?? '').trim())
      .filter((opt) => opt.length > 0);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n/)
      .map((opt) => String(opt ?? '').trim())
      .filter((opt) => opt.length > 0);
  }
  return [];
};

const normalizeStudyConcepts = (raw: any): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((concept) => String(concept ?? '').trim()).filter((concept) => concept.length > 0);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[|,]/)
      .map((concept) => String(concept ?? '').trim())
      .filter((concept) => concept.length > 0);
  }
  return [];
};

const toQuestion = (row: any): Question => {
  const question = (row?.question || {}) as Question;
  return {
    ...question,
    id: row.id,
    options: normalizeOptions(question.options),
    studyConcepts: normalizeStudyConcepts(question.studyConcepts),
    sourceType: 'gold'
  };
};

export const listGoldQuestions = async (filters?: {
  module?: ModuleId;
  status?: GoldStatus;
}) => {
  let query = supabase.from('gold_questions').select('*').order('created_at', { ascending: false });
  if (filters?.module) {
    query = query.eq('module', filters.module);
  }
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    question: toQuestion(row)
  })) as GoldQuestionRow[];
};

export const getApprovedGoldQuestions = async (module: ModuleId) => {
  const { data, error } = await supabase
    .from('gold_questions')
    .select('*')
    .eq('module', module)
    .eq('status', 'approved');
  if (error) throw error;
  return (data || []).map((row) => toQuestion(row));
};

export const createGoldQuestion = async (input: {
  module: ModuleId;
  question: Question;
  status?: GoldStatus;
  authorId?: string | null;
  approvedBy?: string | null;
}) => {
  const normalizedQuestion: Question = {
    ...input.question,
    options: normalizeOptions(input.question.options),
    studyConcepts: normalizeStudyConcepts(input.question.studyConcepts)
  };
  const payload = {
    module: input.module,
    status: input.status || 'draft',
    question: { ...normalizedQuestion, sourceType: 'gold' },
    author_id: input.authorId ?? null,
    approved_by: input.status === 'approved' ? (input.approvedBy ?? input.authorId ?? null) : null,
    approved_at: input.status === 'approved' ? new Date().toISOString() : null
  };
  const { data, error } = await supabase.from('gold_questions').insert(payload).select('*').single();
  if (error) throw error;
  return { ...data, question: toQuestion(data) } as GoldQuestionRow;
};

export const updateGoldQuestion = async (
  id: string,
  updates: Partial<GoldQuestionRow> & { question?: Question }
) => {
  const payload: any = { ...updates };
  if (updates.question) {
    const normalizedQuestion: Question = {
      ...updates.question,
      options: normalizeOptions(updates.question.options),
      studyConcepts: normalizeStudyConcepts(updates.question.studyConcepts)
    };
    payload.question = { ...normalizedQuestion, sourceType: 'gold' };
  }
  const { data, error } = await supabase.from('gold_questions').update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return { ...data, question: toQuestion(data) } as GoldQuestionRow;
};

export const approveGoldQuestion = async (id: string, approverId?: string | null) =>
  updateGoldQuestion(id, {
    status: 'approved',
    approved_by: approverId ?? null,
    approved_at: new Date().toISOString()
  });

export const revokeGoldApproval = async (id: string) =>
  updateGoldQuestion(id, {
    status: 'draft',
    approved_by: null,
    approved_at: null
  });

export const deleteGoldQuestion = async (id: string) => {
  const { error } = await supabase.from('gold_questions').delete().eq('id', id);
  if (error) throw error;
};
