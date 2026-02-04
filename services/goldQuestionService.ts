import { supabase } from './supabaseClient';
import { GoldQuestionRow, Question } from '../types';

type GoldStatus = 'draft' | 'approved';
type ModuleId = 'heme' | 'pulm';

const toQuestion = (row: any): Question => {
  const question = (row?.question || {}) as Question;
  return {
    ...question,
    id: row.id,
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
  const payload = {
    module: input.module,
    status: input.status || 'draft',
    question: { ...input.question, sourceType: 'gold' },
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
    payload.question = { ...updates.question, sourceType: 'gold' };
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
