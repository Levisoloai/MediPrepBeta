import { supabase } from './supabaseClient';
import { PrefabQuestionSet, StudyGuideItem, UserPreferences, Question, QuestionType, DifficultyLevel, ExamFormat, CardStyle } from '../types';
import { generateQuestionsStaged } from './geminiService';
import { buildFingerprintSet, buildQuestionFingerprint, filterDuplicateQuestions } from '../utils/questionDedupe';

type PrefabRow = {
  guide_hash: string;
  guide_title: string;
  items: StudyGuideItem[];
  questions: Question[];
  model: string;
  prompt_version: string;
  created_at: string;
};

const PROMPT_VERSION = 'nbme-v1';

const REPLACEMENT_PREFS: UserPreferences = {
  generationMode: 'questions',
  questionType: QuestionType.MULTIPLE_CHOICE,
  difficulty: DifficultyLevel.CLINICAL_VIGNETTE,
  questionCount: 1,
  autoQuestionCount: false,
  customInstructions: '',
  focusedOnWeakness: false,
  examFormat: ExamFormat.NBME,
  cardStyle: CardStyle.BASIC
};

const buildFocusQueue = (total: number) => {
  const diagTarget = Math.round(total * 0.4);
  const manageTarget = Math.round(total * 0.4);
  const mechTarget = Math.max(0, total - diagTarget - manageTarget);

  const remaining = {
    diagnosis: diagTarget,
    management: manageTarget,
    mechanism: mechTarget
  };

  const pattern: Array<keyof typeof remaining> = ['diagnosis', 'management', 'diagnosis', 'management', 'mechanism'];
  const queue: string[] = [];
  while (queue.length < total) {
    for (const key of pattern) {
      if (queue.length >= total) break;
      if (remaining[key] > 0) {
        queue.push(key);
        remaining[key] -= 1;
      }
    }
    if (pattern.every((key) => remaining[key] <= 0)) break;
  }
  return queue;
};

const buildFocusInstruction = (focusTypes: string[]) => {
  if (focusTypes.length === 0) return '';
  if (focusTypes.length === 1) {
    return `Focus type: ${focusTypes[0]} (diagnosis / management / mechanism).`;
  }
  return `Generate ${focusTypes.length} questions in this order: ${focusTypes
    .map((type, idx) => `${idx + 1}) ${type}`)
    .join(' ')}`;
};

export const normalizePrefabQuestions = (questions: Question[]) => {
  return (questions || []).map((question, index) => {
    const prefabIndex = Number.isFinite(question.prefabIndex) ? question.prefabIndex : index;
    return {
      ...question,
      prefabIndex
    };
  });
};

export const getActivePrefabQuestions = (questions: Question[]) => {
  const normalized = normalizePrefabQuestions(questions);
  const activeByIndex = new Map<number, Question>();

  normalized.forEach((question) => {
    if (question.adminReview?.status === 'retired') return;
    const index = Number.isFinite(question.prefabIndex) ? question.prefabIndex : 0;
    activeByIndex.set(index, question);
  });

  return Array.from(activeByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, question]) => question);
};

export const updatePrefabQuestions = async (guideHash: string, questions: Question[]) => {
  const { error } = await supabase
    .from('study_guide_cache')
    .update({ questions })
    .eq('guide_hash', guideHash);

  if (error) {
    throw error;
  }
};

export const getPrefabSet = async (guideHash: string): Promise<PrefabQuestionSet | null> => {
  const { data, error } = await supabase
    .from('study_guide_cache')
    .select('*')
    .eq('guide_hash', guideHash)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as PrefabRow;
  return {
    guideHash: row.guide_hash,
    guideTitle: row.guide_title,
    items: row.items || [],
    questions: row.questions || [],
    createdAt: row.created_at,
    promptVersion: row.prompt_version,
    model: row.model
  };
};

export const listPrefabSets = async (): Promise<Array<{ guideHash: string; guideTitle: string; createdAt: string; itemCount: number }>> => {
  const { data, error } = await supabase
    .from('study_guide_cache')
    .select('guide_hash, guide_title, created_at, items')
    .order('created_at', { ascending: false });

  if (error || !data) {
    throw error || new Error('Failed to load prefab sets.');
  }

  return (data as PrefabRow[]).map((row) => ({
    guideHash: row.guide_hash,
    guideTitle: row.guide_title || 'Study Guide',
    createdAt: row.created_at,
    itemCount: Array.isArray(row.items) ? row.items.length : 0
  }));
};

type SeedConfig = {
  totalQuestions?: number;
  perItemCount?: number;
  maxQuestions?: number;
  preferLongestItems?: boolean;
};

const pickItemsForTarget = (items: StudyGuideItem[], target: number, preferLongestItems: boolean) => {
  if (items.length <= target) return items;
  if (!preferLongestItems) return items.slice(0, target);
  const withIndex = items.map((item, index) => ({ item, index }));
  const selected = [...withIndex]
    .sort((a, b) => (b.item.content?.length || 0) - (a.item.content?.length || 0))
    .slice(0, target)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item);
  return selected;
};

const distributeCounts = (itemCount: number, totalQuestions: number) => {
  if (itemCount === 0) return [];
  const base = Math.floor(totalQuestions / itemCount);
  const remainder = totalQuestions % itemCount;
  return Array.from({ length: itemCount }, (_, idx) => base + (idx < remainder ? 1 : 0));
};

export const seedPrefabSet = async (
  guideTitle: string,
  guideHash: string,
  items: StudyGuideItem[],
  preferences: UserPreferences,
  perItemCountOrConfig: number | SeedConfig = 2,
  maxQuestions: number = 20
): Promise<PrefabQuestionSet> => {
  const config: SeedConfig =
    typeof perItemCountOrConfig === 'number'
      ? { perItemCount: perItemCountOrConfig, maxQuestions }
      : perItemCountOrConfig;

  const perItemCount = config.perItemCount ?? 2;
  const maxTotal = config.maxQuestions ?? config.totalQuestions ?? 20;
  const totalQuestions = Math.max(
    1,
    Math.min(
      config.totalQuestions ?? items.length * perItemCount,
      maxTotal
    )
  );

  const itemsToUse = pickItemsForTarget(items, totalQuestions, Boolean(config.preferLongestItems));
  const counts = distributeCounts(itemsToUse.length, totalQuestions);
  const focusQueue = buildFocusQueue(totalQuestions);

  const questions: Question[] = [];
  let fingerprintSet = new Set<string>();
  let focusIndex = 0;

  for (let idx = 0; idx < itemsToUse.length; idx += 1) {
    const item = itemsToUse[idx];
    const remaining = totalQuestions - questions.length;
    if (remaining <= 0) break;
    const count = Math.min(counts[idx] || 0, remaining);
    if (count <= 0) continue;
    const focusTypes = focusQueue.slice(focusIndex, focusIndex + count);
    focusIndex += count;

    const focusInstruction = buildFocusInstruction(focusTypes);
    const itemInstruction = `Item Title: ${item.title}\nUse ONLY the provided item content.`;

    const prefs: UserPreferences = {
      ...preferences,
      questionCount: count,
      autoQuestionCount: false,
      customInstructions: [preferences.customInstructions, itemInstruction, focusInstruction]
        .filter(Boolean)
        .join('\n')
    };

    const generated = await generateQuestionsStaged(item.content, prefs);
    const tagged = generated.map(q => ({
      ...q,
      sourceItemId: item.id,
      sourceItemTitle: item.title
    }));
    const { unique, fingerprints } = filterDuplicateQuestions(tagged, fingerprintSet);
    fingerprintSet = fingerprints;
    questions.push(...unique);
  }

  const normalizedQuestions = normalizePrefabQuestions(questions);

  const model = import.meta.env.VITE_XAI_MODEL || 'grok-4';
  const payload: PrefabQuestionSet = {
    guideHash,
    guideTitle,
    items: itemsToUse,
    questions: normalizedQuestions,
    createdAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    model
  };

  const row: PrefabRow = {
    guide_hash: guideHash,
    guide_title: guideTitle,
    items: itemsToUse,
    questions: normalizedQuestions,
    created_at: payload.createdAt,
    prompt_version: payload.promptVersion,
    model: payload.model
  };

  const { error } = await supabase
    .from('study_guide_cache')
    .upsert(row, { onConflict: 'guide_hash' });

  if (error) {
    throw error;
  }

  return payload;
};

const buildGuideFallbackContent = (items: StudyGuideItem[]) => {
  if (!items || items.length === 0) return '';
  return items
    .map((item) => {
      const title = item.title ? `${item.title}\n` : '';
      return `${title}${item.content}`;
    })
    .join('\n\n');
};

const buildReplacementPrefs = (instruction: string) => {
  return {
    ...REPLACEMENT_PREFS,
    customInstructions: instruction
  };
};

const reasonInstructions: Record<string, string> = {
  'Too hard':
    'Make the question simpler: fewer steps, fewer extraneous details, straightforward cues; keep one-best-answer.',
  'Too easy':
    'Make it more challenging: add a key lab/imaging nuance and require multi-step reasoning; keep it fair (no trickery).',
  'Not related to study guide':
    'Strictly align to the provided item content; use item keywords and avoid off-topic topics.',
  Ambiguous:
    'Clarify stem and lead-in, remove ambiguous wording, ensure one best answer.',
  Incorrect:
    'Fix the correct answer and explanation; ensure internal consistency.',
  'Poor explanation':
    'Provide clearer rationale for all options; contrast key differentiators.',
  'Formatting/typo':
    'Clean formatting, fix typos, consistent units and labels.',
  Duplicate:
    'Cover a different angle or sub-concept from the same item; avoid repeating the same key clue.',
  Other:
    'Follow reviewer note exactly.'
};

export const replacePrefabQuestion = async (
  prefab: PrefabQuestionSet,
  questionId: string,
  reason: string,
  note?: string,
  adminId?: string
) => {
  const normalized = normalizePrefabQuestions(prefab.questions || []);
  const index = normalized.findIndex((q) => q.id === questionId);
  if (index === -1) {
    throw new Error('Question not found in prefab set.');
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

  const sourceItem =
    prefab.items?.find((item) => item.id === target.sourceItemId) ||
    prefab.items?.find((item) => item.title === target.sourceItemTitle) ||
    null;

  const sourceContent = sourceItem?.content || buildGuideFallbackContent(prefab.items || []);
  if (!sourceContent.trim()) {
    throw new Error('No source content available to generate a replacement question.');
  }

  const instructionParts: string[] = [];
  instructionParts.push(
    sourceItem
      ? `Item Title: ${sourceItem.title}\nUse ONLY the provided item content.`
      : 'Use ONLY the provided guide content.'
  );

  if (reason && reasonInstructions[reason]) {
    instructionParts.push(reasonInstructions[reason]);
  }

  if (reason === 'Other' && note) {
    instructionParts.push(`Reviewer note: ${note}`);
  } else if (note) {
    instructionParts.push(`Reviewer note: ${note}`);
  }

  const prefs = buildReplacementPrefs(instructionParts.join('\n'));
  const generated = await generateQuestionsStaged(sourceContent, prefs);
  if (!generated || generated.length === 0) {
    throw new Error('Failed to generate a replacement question.');
  }

  const replacement = generated[0];
  const existingFingerprints = buildFingerprintSet(normalized);
  const replacementFingerprint = buildQuestionFingerprint(replacement);
  if (existingFingerprints.has(replacementFingerprint)) {
    throw new Error('Replacement matched an existing question. Please try again.');
  }
  const replacementQuestion: Question = {
    ...replacement,
    sourceItemId: sourceItem?.id || target.sourceItemId,
    sourceItemTitle: sourceItem?.title || target.sourceItemTitle,
    prefabIndex: target.prefabIndex,
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

  await updatePrefabQuestions(prefab.guideHash, normalized);
  return normalized;
};

export const restorePrefabQuestion = async (
  prefab: PrefabQuestionSet,
  questionId: string,
  adminId?: string
) => {
  const normalized = normalizePrefabQuestions(prefab.questions || []);
  const index = normalized.findIndex((q) => q.id === questionId);
  if (index === -1) {
    throw new Error('Question not found in prefab set.');
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

  await updatePrefabQuestions(prefab.guideHash, normalized);
  return normalized;
};
