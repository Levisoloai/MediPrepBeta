import { supabase } from './supabaseClient';
import { QuestionFeedbackInput, FeedbackKind, FeedbackTag, QuestionFeedbackPayload } from '../types';

type FeedbackRow = {
  user_id: string;
  question_id: string;
  kind: FeedbackKind;
  rating?: number | null;
  tags?: FeedbackTag[] | null;
  comment?: string | null;
  selected_option?: string | null;
  is_correct?: boolean | null;
  time_spent_ms?: number | null;
  payload: QuestionFeedbackPayload;
};

const FEEDBACK_QUEUE_KEY = 'mediprep_feedback_queue';

const loadQueue = (): FeedbackRow[] => {
  try {
    const saved = localStorage.getItem(FEEDBACK_QUEUE_KEY);
    return saved ? (JSON.parse(saved) as FeedbackRow[]) : [];
  } catch {
    return [];
  }
};

const saveQueue = (queue: FeedbackRow[]) => {
  try {
    localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
};

const enqueueFeedback = (row: FeedbackRow) => {
  const queue = loadQueue();
  queue.push(row);
  saveQueue(queue);
};

const toRow = (input: QuestionFeedbackInput): FeedbackRow => ({
  user_id: input.userId,
  question_id: input.questionId,
  kind: input.kind,
  rating: input.rating ?? null,
  tags: input.tags ?? null,
  comment: input.comment ?? null,
  selected_option: input.selectedOption ?? null,
  is_correct: input.isCorrect ?? null,
  time_spent_ms: input.timeSpentMs ?? null,
  payload: input.payload
});

const insertFeedback = async (row: FeedbackRow) => {
  const { error } = await supabase
    .from('question_feedback')
    .upsert(row, { onConflict: 'user_id,question_id,kind' });

  if (error) throw error;
};

export const submitQuestionFeedback = async (input: QuestionFeedbackInput) => {
  const row = toRow(input);
  try {
    await insertFeedback(row);
    return { queued: false };
  } catch (error) {
    enqueueFeedback(row);
    return { queued: true, error };
  }
};

export const flushFeedbackQueue = async () => {
  const queue = loadQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const remaining: FeedbackRow[] = [];
  let flushed = 0;

  for (const row of queue) {
    try {
      await insertFeedback(row);
      flushed += 1;
    } catch {
      remaining.push(row);
    }
  }

  saveQueue(remaining);
  return { flushed, remaining: remaining.length };
};
