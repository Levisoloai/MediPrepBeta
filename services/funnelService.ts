import type { Question, StudyGuideItem, UserPreferences } from '../types';
import { getApprovedGoldQuestions } from './goldQuestionService';
import { getActivePrefabQuestions, getPrefabSet } from './prefabService';
import { generateQuestionsStaged } from './geminiService';
import { buildFingerprintSet, buildFingerprintVariants, filterDuplicateQuestions } from '../utils/questionDedupe';
import {
  buildGuideConceptUniverse,
  normalizeConceptKey,
  scoreQuestionForConcept,
  selectTargets,
  type FunnelBatchMeta,
  type FunnelState
} from '../utils/funnel';

type ModuleId = 'heme' | 'pulm';

type MixedModule = {
  content: string;
  guideHash: string;
  guideItems: StudyGuideItem[];
  guideTitle: string;
  moduleId: ModuleId;
};

type GenerateContext = {
  guideHash?: string;
  guideItems?: StudyGuideItem[];
  guideTitle?: string;
  moduleId?: ModuleId | 'mixed';
  mixedModules?: MixedModule[];
};

type Candidate = {
  question: Question;
  sourceType: 'gold' | 'prefab';
  moduleId: ModuleId;
  guideHash: string;
};

const hasSeenFingerprint = (question: Question, set: Set<string>) =>
  buildFingerprintVariants(question).some((variant) => set.has(variant));

const addFingerprintsToSet = (question: Question, set: Set<string>) => {
  buildFingerprintVariants(question).forEach((variant) => set.add(variant));
};

const getModuleHintFromItemId = (value?: string): ModuleId | null => {
  if (!value) return null;
  if (value.startsWith('heme-')) return 'heme';
  if (value.startsWith('pulm-')) return 'pulm';
  return null;
};

const buildConceptModuleMap = (guideItems: StudyGuideItem[] | undefined, fallback: ModuleId | null) => {
  const map = new Map<string, ModuleId>();
  (guideItems || []).forEach((item) => {
    const title = String(item?.title ?? '').trim();
    if (!title) return;
    const key = normalizeConceptKey(title);
    if (!key) return;
    const hint = getModuleHintFromItemId(String(item?.id ?? ''));
    if (hint) map.set(key, hint);
    else if (fallback) map.set(key, fallback);
  });
  return map;
};

const buildGenerationInstruction = (targets: string[], displayByKey: Record<string, string>) => {
  const ordered = targets
    .map((key) => displayByKey[key] || key)
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0);
  if (ordered.length === 0) return '';
  if (ordered.length === 1) {
    return [
      `Target concept: ${ordered[0]}.`,
      'Generate exactly 1 question primarily about this concept.',
      `The question MUST include "${ordered[0]}" in studyConcepts.`
    ].join('\n');
  }
  return [
    `Generate exactly ${ordered.length} questions in this order: ${ordered
      .map((concept, idx) => `${idx + 1}) ${concept}`)
      .join(' ')}`,
    'Each question MUST include its target concept in studyConcepts and be primarily about it.',
    'Avoid repeating stems/phrasing from prior questions.'
  ].join('\n');
};

const pickBestForTarget = (pool: Candidate[], targetKey: string, workingFingerprints: Set<string>) => {
  let best: { score: number; candidate: Candidate } | null = null;
  for (const candidate of pool) {
    if (hasSeenFingerprint(candidate.question, workingFingerprints)) continue;
    const score = scoreQuestionForConcept(candidate.question, targetKey);
    if (!best || score > best.score) {
      best = { score, candidate };
    }
  }
  return best?.candidate ?? null;
};

export const buildFunnelBatch = async (input: {
  content: string;
  preferences: UserPreferences;
  context?: GenerateContext;
  funnel: FunnelState;
  seenFingerprints: Set<string>;
  existingQuestions?: Question[];
  extraConcepts?: string[];
}): Promise<{ questions: Question[]; meta: FunnelBatchMeta; warning?: string }> => {
  const totalRequested = Math.max(1, Math.min(20, Math.floor(Number(input.preferences.questionCount) || 10)));

  const guideHash = input.context?.guideHash || 'custom';
  const guideTitle = input.context?.guideTitle || undefined;
  const guideItems = input.context?.guideItems || [];
  const moduleId = input.context?.moduleId;
  const mixedModules = moduleId === 'mixed' ? input.context?.mixedModules : undefined;
  const isMixed = moduleId === 'mixed' && Array.isArray(mixedModules) && mixedModules.length >= 2;

  const baseFingerprints = new Set<string>(input.seenFingerprints);
  const existingSet = buildFingerprintSet(input.existingQuestions || []);
  existingSet.forEach((fp) => baseFingerprints.add(fp));

  const guideConcepts = buildGuideConceptUniverse(guideItems, input.funnel);
  (input.extraConcepts || []).forEach((concept) => {
    const display = String(concept ?? '').trim();
    if (!display) return;
    const key = normalizeConceptKey(display);
    if (!key) return;
    if (!guideConcepts.has(key)) guideConcepts.set(key, display);
  });

  const { focusCount, exploreCount, focusTargetsDistinct, exploreTargets, targetsPerQuestion } = selectTargets({
    guideConcepts,
    funnel: input.funnel,
    total: totalRequested,
    exploreRatio: 0.2
  });

  const displayByKey: Record<string, string> = {};
  guideConcepts.forEach((display, key) => {
    displayByKey[key] = display;
  });

  const conceptModuleMap = buildConceptModuleMap(
    guideItems,
    moduleId === 'heme' || moduleId === 'pulm' ? moduleId : null
  );

  const goldCandidates: Candidate[] = [];
  const prefabCandidates: Candidate[] = [];

  if (isMixed && mixedModules) {
    const modules = mixedModules.filter((m): m is MixedModule => Boolean(m?.guideHash && m?.moduleId));
    const [hemeMod] = modules.filter((m) => m.moduleId === 'heme');
    const [pulmMod] = modules.filter((m) => m.moduleId === 'pulm');
    const resolved = [hemeMod, pulmMod].filter(Boolean) as MixedModule[];
    for (const mod of resolved) {
      const gold = await getApprovedGoldQuestions(mod.moduleId);
      gold.forEach((q) =>
        goldCandidates.push({
          question: { ...q, sourceType: 'gold', guideHash: mod.guideHash },
          sourceType: 'gold',
          moduleId: mod.moduleId,
          guideHash: mod.guideHash
        })
      );
      const prefab = await getPrefabSet(mod.guideHash);
      if (prefab) {
        const active = getActivePrefabQuestions(prefab.questions || []);
        active.forEach((q) =>
          prefabCandidates.push({
            question: { ...q, sourceType: 'prefab', guideHash: mod.guideHash },
            sourceType: 'prefab',
            moduleId: mod.moduleId,
            guideHash: mod.guideHash
          })
        );
      }
    }
  } else if (moduleId === 'heme' || moduleId === 'pulm') {
    const gold = await getApprovedGoldQuestions(moduleId);
    gold.forEach((q) =>
      goldCandidates.push({
        question: { ...q, sourceType: 'gold', guideHash },
        sourceType: 'gold',
        moduleId,
        guideHash
      })
    );
    const prefab = await getPrefabSet(guideHash);
    if (prefab) {
      const active = getActivePrefabQuestions(prefab.questions || []);
      active.forEach((q) =>
        prefabCandidates.push({
          question: { ...q, sourceType: 'prefab', guideHash },
          sourceType: 'prefab',
          moduleId,
          guideHash
        })
      );
    }
  }

  const workingFingerprints = new Set<string>(baseFingerprints);
  const selected: Question[] = [];
  const targetByQuestionId: Record<string, string> = {};
  const missingTargets: string[] = [];
  const sourceCounts = { gold: 0, prefab: 0, generated: 0 };

  for (const targetKey of targetsPerQuestion) {
    const fromGold = pickBestForTarget(goldCandidates, targetKey, workingFingerprints);
    const fromPrefab = fromGold ? null : pickBestForTarget(prefabCandidates, targetKey, workingFingerprints);
    const chosen = fromGold || fromPrefab;
    if (!chosen) {
      missingTargets.push(targetKey);
      continue;
    }

    const q: Question = {
      ...chosen.question,
      sourceType: chosen.sourceType,
      guideHash: chosen.guideHash
    };
    selected.push(q);
    targetByQuestionId[q.id] = targetKey;
    sourceCounts[chosen.sourceType] += 1;
    addFingerprintsToSet(q, workingFingerprints);
  }

  let backfillAttempts = 0;
  let droppedGenerated = 0;

  const removeTargetsOnce = (haystack: string[], needles: string[]) => {
    const counts = new Map<string, number>();
    needles.forEach((needle) => {
      counts.set(needle, (counts.get(needle) || 0) + 1);
    });
    const next: string[] = [];
    haystack.forEach((value) => {
      const remaining = counts.get(value) || 0;
      if (remaining > 0) {
        counts.set(value, remaining - 1);
      } else {
        next.push(value);
      }
    });
    return next;
  };

  const appendGenerated = (generated: Question[], targets: string[], guideHashOverride: string) => {
    const tagged = generated.map((q) => ({ ...q, sourceType: 'generated' as const, guideHash: guideHashOverride }));
    const before = tagged.length;
    const { unique, fingerprints } = filterDuplicateQuestions(tagged, workingFingerprints);
    workingFingerprints.clear();
    fingerprints.forEach((fp) => workingFingerprints.add(fp));
    droppedGenerated += Math.max(0, before - unique.length);
    const remaining = Math.max(0, targets.length);
    const slice = unique.slice(0, remaining);
    slice.forEach((q, idx) => {
      selected.push(q);
      sourceCounts.generated += 1;
      targetByQuestionId[q.id] = targets[idx] || 'general';
      addFingerprintsToSet(q, workingFingerprints);
    });
    return slice.length;
  };

  const effectiveCustomInstructionsBase = String(input.preferences.customInstructions || '').trim();

  let remainingTargets = [...missingTargets];
  while (remainingTargets.length > 0 && backfillAttempts < 3) {
    backfillAttempts += 1;
    const attemptTargets = [...remainingTargets];

    if (isMixed && mixedModules) {
      const modules = mixedModules.filter((m): m is MixedModule => Boolean(m?.content && m?.guideHash && m?.moduleId));
      const byModule: Record<ModuleId, string[]> = { heme: [], pulm: [] };
      attemptTargets.forEach((target) => {
        const mod = conceptModuleMap.get(target);
        if (mod === 'pulm') byModule.pulm.push(target);
        else byModule.heme.push(target);
      });

      for (const mod of modules) {
        const targets = byModule[mod.moduleId];
        if (!targets || targets.length === 0) continue;

        const instruction = buildGenerationInstruction(targets, displayByKey);
        const prefs: UserPreferences = {
          ...input.preferences,
          autoQuestionCount: false,
          questionCount: targets.length,
          customInstructions: [effectiveCustomInstructionsBase, instruction].filter(Boolean).join('\n')
        };
        const generated = await generateQuestionsStaged(mod.content, prefs);
        const consumed = appendGenerated(generated, targets, mod.guideHash);
        const consumedTargets = targets.slice(0, consumed);
        remainingTargets = removeTargetsOnce(remainingTargets, consumedTargets);
      }
    } else {
      const instruction = buildGenerationInstruction(attemptTargets, displayByKey);
      const prefs: UserPreferences = {
        ...input.preferences,
        autoQuestionCount: false,
        questionCount: attemptTargets.length,
        customInstructions: [effectiveCustomInstructionsBase, instruction].filter(Boolean).join('\n')
      };
      const generated = await generateQuestionsStaged(input.content, prefs);
      const consumed = appendGenerated(generated, attemptTargets, guideHash);
      remainingTargets = remainingTargets.slice(consumed);
    }

    if (remainingTargets.length === attemptTargets.length) {
      break;
    }
  }

  const shortfall = Math.max(0, totalRequested - selected.length);
  const warning = shortfall > 0 ? 'Some questions failed validation; try again.' : undefined;

  const meta: FunnelBatchMeta = {
    guideHash,
    guideTitle,
    createdAt: new Date().toISOString(),
    total: totalRequested,
    focusCount,
    exploreCount,
    focusTargets: focusTargetsDistinct,
    exploreTargets,
    targetsPerQuestion,
    targetByQuestionId,
    sourceCounts,
    backfillAttempts,
    droppedGenerated,
    shortfall,
    displayByKey
  };

  return { questions: selected.slice(0, totalRequested), meta, warning };
};
