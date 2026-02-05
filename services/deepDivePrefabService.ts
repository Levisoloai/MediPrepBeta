import { supabase } from './supabaseClient';
import { hashText, normalizeText } from '../utils/studyGuide';
import { buildFingerprintSet, filterDuplicateQuestions } from '../utils/questionDedupe';
import { Question } from '../types';
import { extendDeepDiveQuiz, normalizeDeepDiveQuiz, regenerateDeepDiveLesson } from './geminiService';

type DeepDiveCacheRow = {
  topic_key: string;
  topic_context: string;
  concept: string;
  lesson_content: string;
  quiz: any[];
  model: string | null;
  created_at: string;
};

export const buildDeepDiveKey = async (topicContext: string, concept: string) => {
  const normalized = normalizeText(`${topicContext}||${concept}`).toLowerCase();
  return hashText(normalized);
};

export const getDeepDivePrefab = async (topicContext: string, concept: string) => {
  const topicKey = await buildDeepDiveKey(topicContext, concept);
  const { data, error } = await supabase
    .from('deep_dive_cache')
    .select('*')
    .eq('topic_key', topicKey)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as DeepDiveCacheRow;
  return {
    topicKey: row.topic_key,
    topicContext: row.topic_context,
    concept: row.concept,
    lessonContent: row.lesson_content,
    quiz: Array.isArray(row.quiz) ? row.quiz : [],
    createdAt: row.created_at,
    model: row.model || undefined
  };
};

export const seedDeepDivePrefab = async (topicContext: string, concept: string, lessonContent: string, quiz: any[]) => {
  const topicKey = await buildDeepDiveKey(topicContext, concept);
  const row: DeepDiveCacheRow = {
    topic_key: topicKey,
    topic_context: topicContext,
    concept,
    lesson_content: lessonContent,
    quiz,
    model: import.meta.env.VITE_XAI_MODEL || 'grok-4-1-fast-reasoning',
    created_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('deep_dive_cache')
    .upsert(row, { onConflict: 'topic_key' });

  if (error) {
    throw error;
  }

  return row;
};

export const appendDeepDivePrefab = async (
  topicContext: string,
  concept: string,
  lessonContent: string,
  quiz: any[]
) => {
  const existing = await getDeepDivePrefab(topicContext, concept);
  if (!existing) {
    throw new Error('Deep dive prefab not found for append.');
  }

  const existingQuiz = Array.isArray(existing.quiz) ? existing.quiz : [];
  const existingSet = buildFingerprintSet(existingQuiz);
  const { unique } = filterDuplicateQuestions(quiz, existingSet);
  const merged = [...existingQuiz, ...unique];

  const topicKey = await buildDeepDiveKey(topicContext, concept);
  const row: DeepDiveCacheRow = {
    topic_key: topicKey,
    topic_context: topicContext,
    concept,
    lesson_content: existing.lessonContent || lessonContent,
    quiz: merged,
    model: import.meta.env.VITE_XAI_MODEL || 'grok-4-1-fast-reasoning',
    created_at: existing.createdAt || new Date().toISOString()
  };

  const { error } = await supabase
    .from('deep_dive_cache')
    .upsert(row, { onConflict: 'topic_key' });

  if (error) {
    throw error;
  }

  return row;
};

const updateDeepDiveQuiz = async (topicKey: string, quiz: Question[]) => {
  const { error } = await supabase
    .from('deep_dive_cache')
    .update({ quiz })
    .eq('topic_key', topicKey);

  if (error) {
    throw error;
  }
};

const updateDeepDiveLessonContent = async (topicKey: string, lessonContent: string) => {
  const { error } = await supabase
    .from('deep_dive_cache')
    .update({
      lesson_content: lessonContent,
      model: import.meta.env.VITE_XAI_MODEL || 'grok-4-1-fast-reasoning'
    })
    .eq('topic_key', topicKey);

  if (error) {
    throw error;
  }
};

const primerReasonInstructions: Record<string, string> = {
  'Too short':
    'Expand with more explanation, include key mechanisms and pitfalls, but keep it concise.',
  'Too long':
    'Condense the primer: keep only the highest-yield facts and avoid redundancy.',
  'Needs clearer structure':
    'Use tighter headings and a short comparison table if helpful.',
  'Missing key topics':
    'Include the essential differential diagnosis and hallmark clues.',
  'Too advanced':
    'Simplify to core exam-level concepts and remove overly granular details.',
  'Too basic':
    'Add nuance, thresholds, and decision points to make it more board-relevant.',
  Other:
    'Follow reviewer note exactly.'
};

export const regenerateDeepDivePrimer = async (
  topicContext: string,
  concept: string,
  reason: string,
  note?: string
) => {
  const existing = await getDeepDivePrefab(topicContext, concept);
  if (!existing) {
    throw new Error('Deep dive prefab not found.');
  }

  const instructionParts: string[] = [];
  if (reason && primerReasonInstructions[reason]) {
    instructionParts.push(primerReasonInstructions[reason]);
  }
  if (note) {
    instructionParts.push(`Reviewer note: ${note}`);
  }

  const lessonContent = await regenerateDeepDiveLesson(topicContext, concept, instructionParts.join('\n'));
  if (!lessonContent.trim()) {
    throw new Error('Generated primer was empty. Please try again.');
  }
  await updateDeepDiveLessonContent(existing.topicKey, lessonContent);
  return lessonContent;
};

export const replaceDeepDivePrefabQuestion = async (
  topicContext: string,
  concept: string,
  questionId: string,
  reason: string,
  note?: string,
  adminId?: string
) => {
  const existing = await getDeepDivePrefab(topicContext, concept);
  if (!existing) {
    throw new Error('Deep dive prefab not found.');
  }

  const normalized = normalizeDeepDiveQuiz(existing.quiz, concept);
  const index = normalized.findIndex((q) => q.id === questionId);
  if (index === -1) {
    throw new Error('Question not found in deep dive prefab.');
  }

  const target = normalized[index];
  const reviewedAt = new Date().toISOString();
  const retiredTarget: Question = {
    ...target,
    adminReview: {
      ...(target.adminReview || {}),
      status: 'retired',
      reason,
      note,
      reviewedAt,
      reviewedBy: adminId || target.adminReview?.reviewedBy
    }
  };

  normalized[index] = retiredTarget;

  const reviewerNote = [reason, note].filter(Boolean).join(' • ');
  const candidates = await extendDeepDiveQuiz(null, topicContext, concept, 1, undefined, 'same', reviewerNote || undefined);
  const existingSet = buildFingerprintSet(normalized);
  const { unique } = filterDuplicateQuestions(candidates, existingSet);
  if (!unique.length) {
    throw new Error('Replacement matched an existing question. Please try again.');
  }

  const replacement = unique[0];
  const replacementQuestion: Question = {
    ...replacement,
    adminReview: {
      status: 'active',
      reviewedAt,
      reviewedBy: adminId || target.adminReview?.reviewedBy,
      replacedFromId: target.id
    }
  };

  normalized[index] = {
    ...retiredTarget,
    adminReview: {
      ...(retiredTarget.adminReview || {}),
      replacedById: replacementQuestion.id
    }
  };

  normalized.splice(index + 1, 0, replacementQuestion);
  await updateDeepDiveQuiz(existing.topicKey, normalized);
  return normalized;
};

export const restoreDeepDivePrefabQuestion = async (
  topicContext: string,
  concept: string,
  questionId: string,
  adminId?: string
) => {
  const existing = await getDeepDivePrefab(topicContext, concept);
  if (!existing) {
    throw new Error('Deep dive prefab not found.');
  }

  const normalized = normalizeDeepDiveQuiz(existing.quiz, concept);
  const index = normalized.findIndex((q) => q.id === questionId);
  if (index === -1) {
    throw new Error('Question not found in deep dive prefab.');
  }

  const target = normalized[index];
  const reviewedAt = new Date().toISOString();
  normalized[index] = {
    ...target,
    adminReview: {
      ...(target.adminReview || {}),
      status: 'active',
      reviewedAt,
      reviewedBy: adminId || target.adminReview?.reviewedBy
    }
  };

  const replacementId = target.adminReview?.replacedById;
  if (replacementId) {
    const replacementIndex = normalized.findIndex((q) => q.id === replacementId);
    if (replacementIndex !== -1) {
      const replacement = normalized[replacementIndex];
      normalized[replacementIndex] = {
        ...replacement,
        adminReview: {
          ...(replacement.adminReview || {}),
          status: 'retired',
          reviewedAt,
          reviewedBy: adminId || replacement.adminReview?.reviewedBy,
          reason: replacement.adminReview?.reason || 'Restored original'
        }
      };
    }
  }

  await updateDeepDiveQuiz(existing.topicKey, normalized);
  return normalized;
};
