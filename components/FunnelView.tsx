import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
import {
  BoltIcon,
  ChartBarIcon,
  FunnelIcon,
  PlayIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  XMarkIcon
} from '@heroicons/react/24/solid';
import { betaGuides } from '../utils/betaGuides';
import { buildStudyGuideItems } from '../utils/studyGuide';
import {
  buildGuideConceptUniverse,
  computePriority,
  getExpected,
  normalizeConceptKey,
  type FunnelBatchMeta,
  type FunnelState
} from '../utils/funnel';
import type { DifficultyLevel, Question, QuestionState, StudyGuideItem, UserPreferences } from '../types';
import QuestionCard from './QuestionCard';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type FunnelModuleChoice = 'heme' | 'pulm' | 'mixed';

type MixedModule = {
  content: string;
  guideHash: string;
  guideItems: StudyGuideItem[];
  guideTitle: string;
  moduleId: 'heme' | 'pulm';
};

export type FunnelGuideContext = {
  content: string;
  prefs: UserPreferences;
  guideHash: string;
  guideItems: StudyGuideItem[];
  guideTitle: string;
  moduleId: 'heme' | 'pulm' | 'mixed';
  mixedModules?: MixedModule[];
};

type FunnelPerformanceSummary = {
  totalAnswered: number;
  totalCorrect: number;
  overallAccuracy: number;
  conceptStats: Array<{ concept: string; attempts: number; correct: number; accuracy: number }>;
  weakConcepts: Array<{ concept: string; attempts: number; correct: number; accuracy: number }>;
};

type AnkiRating = 1 | 2 | 3 | 4;

type Props = {
  user?: any;
  isLoading: boolean;
  isXaiConfigured: boolean;
  funnelContext: FunnelGuideContext | null;
  funnelQuestions: Question[];
  funnelStates: Record<string, QuestionState>;
  setFunnelStates: React.Dispatch<React.SetStateAction<Record<string, QuestionState>>>;
  funnelSummary: FunnelPerformanceSummary;
  funnelState: FunnelState;
  funnelBatchMeta: FunnelBatchMeta | null;
  onStartFunnel: (next: FunnelGuideContext) => Promise<void>;
  onContinueFunnel: () => Promise<void>;
  onResetFunnel: () => void;
  onBackToGenerate: () => void;
  onChat: (q: Question) => void;
  onAnkiRate: (q: Question, rating: AnkiRating, meta?: { timeToAnswerMs: number | null; isCorrect: boolean | null }) => void;
};

const MAX_TEXT_CHARS = 120000;

const formatSeconds = (totalSeconds: number) => {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const hashToUnit = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // 0..1
  return (hash >>> 0) / 2 ** 32;
};

const getConceptDotStyle = (input: {
  key: string;
  index: number;
  total: number;
  category: 'focus' | 'explore' | 'other';
}) => {
  const { key, index, total, category } = input;
  const u1 = hashToUnit(`${key}:x:${index}`);
  const u2 = hashToUnit(`${key}:y:${total}`);
  const jitterX = (u1 - 0.5) * 6; // percentage points
  const jitterY = (u2 - 0.5) * 4;

  if (category === 'focus') {
    const x = 50 + (u1 - 0.5) * 28 + jitterX;
    const y = 80 + (u2 - 0.5) * 14 + jitterY;
    return { left: `${x}%`, top: `${y}%` };
  }
  if (category === 'explore') {
    const x = 50 + (u1 - 0.5) * 54 + jitterX;
    const y = 52 + (u2 - 0.5) * 18 + jitterY;
    return { left: `${x}%`, top: `${y}%` };
  }
  const x = 50 + (u1 - 0.5) * 82 + jitterX;
  const y = 18 + (u2 - 0.5) * 22 + jitterY;
  return { left: `${x}%`, top: `${y}%` };
};

const FunnelView: React.FC<Props> = ({
  user,
  isLoading,
  isXaiConfigured,
  funnelContext,
  funnelQuestions,
  funnelStates,
  setFunnelStates,
  funnelSummary,
  funnelState,
  funnelBatchMeta,
  onStartFunnel,
  onContinueFunnel,
  onResetFunnel,
  onBackToGenerate,
  onChat,
  onAnkiRate
}) => {
  const [mode, setMode] = useState<FunnelModuleChoice>('heme');
  const [showStats, setShowStats] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepProgress, setPrepProgress] = useState(0);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    const defaults: UserPreferences = {
      generationMode: 'questions',
      questionType: 'MULTIPLE_CHOICE' as any,
      difficulty: 'Clinical Vignette (USMLE Style)' as any,
      questionCount: 10,
      autoQuestionCount: false,
      sessionStyle: 'practice',
      sessionMode: 'standard',
      customInstructions: '',
      focusedOnWeakness: false,
      examFormat: 'NBME' as any,
      cardStyle: 'BASIC' as any
    };
    try {
      const saved = localStorage.getItem('mediprep_beta_prefs');
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      const safeCount = Math.min(20, Math.max(3, Number(parsed.questionCount) || defaults.questionCount));
      return { ...defaults, ...parsed, questionCount: safeCount };
    } catch {
      return defaults;
    }
  });

  const vizTickRef = useRef(0);
  const [vizTick, setVizTick] = useState(0);

  useEffect(() => {
    // Re-run dot transitions when a new batch arrives.
    if (!funnelBatchMeta?.createdAt) return;
    vizTickRef.current += 1;
    setVizTick(vizTickRef.current);
  }, [funnelBatchMeta?.createdAt]);

  useEffect(() => {
    try {
      if (preferences) {
        localStorage.setItem('mediprep_beta_prefs', JSON.stringify(preferences));
      }
    } catch {
      // ignore
    }
  }, [preferences]);

  const difficultyOptions: DifficultyLevel[] = useMemo(
    () => [
      // Order matters in the UI.
      ('Clinical Vignette (USMLE Style)' as DifficultyLevel),
      ('Hard' as DifficultyLevel),
      ('Medium' as DifficultyLevel),
      ('Easy' as DifficultyLevel)
    ],
    []
  );

  const selectedGuideTitle = mode === 'heme' ? 'Hematology' : mode === 'pulm' ? 'Pulmonology' : 'Pulm + Heme';

  const computeFunnelStageLabel = (answered: number) => {
    if (answered <= 0) return { label: 'Calibration', hint: 'Start broad, map blind spots.' };
    if (answered < 10) return { label: 'Narrowing', hint: 'Shifting toward weaknesses.' };
    if (answered < 25) return { label: 'Pressure', hint: 'Hardest concepts surface.' };
    return { label: 'Polish', hint: 'Stabilize and speed up.' };
  };

  const stage = computeFunnelStageLabel(funnelSummary.totalAnswered);

  const conceptUniverse = useMemo(() => {
    if (!funnelContext?.guideItems) return null;
    const map = buildGuideConceptUniverse(funnelContext.guideItems, funnelState);
    return map;
  }, [funnelContext?.guideItems, funnelState]);

  const conceptDots = useMemo(() => {
    if (!conceptUniverse) return [];
    const keys = Array.from(conceptUniverse.keys());
    const maxDots = 120;
    const limited = keys.slice(0, Math.min(keys.length, maxDots));
    const focus = new Set((funnelBatchMeta?.focusTargets || []).map((k) => normalizeConceptKey(k)));
    const explore = new Set((funnelBatchMeta?.exploreTargets || []).map((k) => normalizeConceptKey(k)));
    return limited.map((key, index) => {
      const norm = normalizeConceptKey(key);
      const category = focus.has(norm) ? 'focus' : explore.has(norm) ? 'explore' : 'other';
      const display = conceptUniverse.get(key) || key;
      return { key, norm, display, index, category };
    });
  }, [conceptUniverse, funnelBatchMeta?.focusTargets, funnelBatchMeta?.exploreTargets, vizTick]);

  const masterySnapshot = useMemo(() => {
    const entries = Object.entries(funnelState?.concepts || {}).map(([key, state]) => {
      const expected = getExpected(state);
      const priority = computePriority(state);
      return {
        key,
        display: state.display || key,
        attempts: state.attempts || 0,
        expected,
        priority
      };
    });
    entries.sort((a, b) => b.priority - a.priority);
    const hardest = entries.slice(0, 6);
    const weakest = [...entries].sort((a, b) => a.expected - b.expected).slice(0, 6);
    const tracked = entries.length;
    const avgExpected = tracked
      ? entries.reduce((acc, item) => acc + item.expected, 0) / tracked
      : 0;
    return { hardest, weakest, tracked, avgExpected };
  }, [funnelState]);

  const extractPdfTextFromUrl = async (pdfUrl: string, onProgress?: (pct: number) => void) => {
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error('Guide PDF not found. Make sure it exists in public/beta-guides.');
    }
    const arrayBuffer = await response.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;

    let fullText = '';
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      // eslint-disable-next-line no-await-in-loop
      const page = await pdf.getPage(pageNum);
      // eslint-disable-next-line no-await-in-loop
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');
      fullText += pageText + '\n';
      if (onProgress) onProgress(Math.round((pageNum / totalPages) * 100));
      if (fullText.length >= MAX_TEXT_CHARS) {
        fullText = fullText.slice(0, MAX_TEXT_CHARS);
        break;
      }
    }
    return fullText.trim();
  };

  const loadGuideTextCached = async (id: 'heme' | 'pulm', pdfUrl: string) => {
    const key = `mediprep_funnel_guide_text_${id}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached && cached.trim().length > 0) return cached;
    } catch {
      // ignore
    }
    const text = await extractPdfTextFromUrl(pdfUrl);
    try {
      localStorage.setItem(key, text);
    } catch {
      // ignore
    }
    return text;
  };

  const handleStart = async () => {
    if (!isXaiConfigured) {
      setPrepError("xAI API Key is missing. Please add 'VITE_XAI_API_KEY' to your environment variables.");
      return;
    }
    setPrepError(null);
    setIsPreparing(true);
    setPrepProgress(0);
    try {
      const basePrefs: UserPreferences = {
        ...(preferences || {}),
        generationMode: 'questions',
        sessionStyle: 'practice',
        sessionMode: 'funnel',
        focusedOnWeakness: false,
        autoQuestionCount: false
      };
      const safeCount = Math.min(20, Math.max(3, Number(basePrefs.questionCount) || 10));
      basePrefs.questionCount = safeCount;

      if (mode === 'mixed') {
        const heme = betaGuides.find((g) => g.id === 'heme');
        const pulm = betaGuides.find((g) => g.id === 'pulm');
        if (!heme || !pulm) throw new Error('Mixed mode requires both Hematology and Pulmonology guides.');

        const hemeText = await loadGuideTextCached('heme', heme.pdfUrl);
        setPrepProgress(25);
        const pulmText = await loadGuideTextCached('pulm', pulm.pdfUrl);
        setPrepProgress(50);

        const [{ guideHash: hemeHash, guideItems: hemeItemsRaw }, { guideHash: pulmHash, guideItems: pulmItemsRaw }] =
          await Promise.all([buildStudyGuideItems(hemeText), buildStudyGuideItems(pulmText)]);

        const hemeItems = hemeItemsRaw.map((item) => ({ ...item, id: `heme-${item.id}` }));
        const pulmItems = pulmItemsRaw.map((item) => ({ ...item, id: `pulm-${item.id}` }));
        const mixedHash = `mixed_${hemeHash}_${pulmHash}`;
        const combinedContent = `${hemeText}\n\n${pulmText}`;
        setPrepProgress(75);

        const ctx: FunnelGuideContext = {
          content: combinedContent,
          prefs: basePrefs,
          guideHash: mixedHash,
          guideItems: [...hemeItems, ...pulmItems],
          guideTitle: 'Pulm + Heme (Funnel)',
          moduleId: 'mixed',
          mixedModules: [
            {
              content: hemeText,
              guideHash: hemeHash,
              guideItems: hemeItems,
              guideTitle: 'Hematology',
              moduleId: 'heme'
            },
            {
              content: pulmText,
              guideHash: pulmHash,
              guideItems: pulmItems,
              guideTitle: 'Pulmonology',
              moduleId: 'pulm'
            }
          ]
        };
        await onStartFunnel(ctx);
        setPrepProgress(100);
        return;
      }

      const guide = betaGuides.find((g) => g.id === mode);
      if (!guide) throw new Error('Selected guide not found.');

      const text = await loadGuideTextCached(mode, guide.pdfUrl);
      setPrepProgress(60);
      const { guideHash, guideItems } = await buildStudyGuideItems(text);
      setPrepProgress(85);

      const ctx: FunnelGuideContext = {
        content: text,
        prefs: basePrefs,
        guideHash,
        guideItems,
        guideTitle: guide.title,
        moduleId: mode
      };
      await onStartFunnel(ctx);
      setPrepProgress(100);
    } catch (err: any) {
      console.error('Funnel start failed', err);
      setPrepError(err?.message || 'Failed to start Funnel.');
    } finally {
      setIsPreparing(false);
      setTimeout(() => setPrepProgress(0), 300);
    }
  };

  const showEntry = funnelQuestions.length === 0;

  if (showEntry) {
    const questionCount = Math.min(20, Math.max(3, Number(preferences?.questionCount) || 10));
    const timeHint = formatSeconds(questionCount * 90);
    return (
      <div className="h-full flex flex-col p-6 md:p-10">
        <div className="mb-8 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
              <FunnelIcon className="w-4 h-4" />
              Funnel Mode
            </div>
            <h2 className="mt-4 text-3xl md:text-4xl font-black tracking-tight text-slate-900">
              Enter the funnel.
            </h2>
            <p className="mt-3 text-slate-600 text-sm md:text-base font-medium max-w-2xl leading-relaxed">
              Start broad, then narrow automatically based on your performance. Uses gold and prefab first, generates only when the bank is short.
            </p>
          </div>

          <div className="w-full lg:w-[360px] p-4 rounded-3xl border border-slate-200 bg-white/90 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Session setup</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <div className="text-[11px] font-semibold text-slate-600">Batch size</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[10, 15, 20].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() =>
                        setPreferences((prev) => ({
                          ...(prev || {}),
                          questionCount: n
                        }))
                      }
                      className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-colors ${
                        questionCount === n
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-slate-500 font-semibold">
                  Timer equivalent: {timeHint} (NBME pacing).
                </div>
              </div>

              <div className="col-span-2">
                <div className="text-[11px] font-semibold text-slate-600">Difficulty</div>
                <select
                  value={String(preferences?.difficulty || 'Clinical Vignette (USMLE Style)')}
                  onChange={(e) =>
                    setPreferences((prev) => ({
                      ...(prev || {}),
                      difficulty: e.target.value as DifficultyLevel
                    }))
                  }
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-700"
                >
                  {difficultyOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {String(opt)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              disabled={isLoading || isPreparing}
              onClick={handleStart}
              className={`mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-colors ${
                isLoading || isPreparing
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              <PlayIcon className="w-4 h-4" />
              Start Funnel
              <ArrowRightIcon className="w-4 h-4" />
            </button>

            {prepError && (
              <div className="mt-3 p-3 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold">
                {prepError}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {(['heme', 'pulm', 'mixed'] as FunnelModuleChoice[]).map((id) => {
            const active = mode === id;
            const label = id === 'heme' ? 'Hematology' : id === 'pulm' ? 'Pulmonology' : 'Pulm + Heme';
            const blurb =
              id === 'heme'
                ? 'Anemias, hemostasis, transfusion, malignancies.'
                : id === 'pulm'
                ? 'Obstructive/restrictive, imaging patterns, ICU basics.'
                : 'Best simulation of NBME conditions.';
            const icon = id === 'mixed' ? BoltIcon : FunnelIcon;
            const Icon = icon;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`text-left p-5 rounded-3xl border transition-all shadow-sm ${
                  active
                    ? 'border-indigo-300 bg-indigo-50/60 shadow-indigo-200/40'
                    : 'border-slate-200 bg-white/90 hover:bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                      active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-slate-900">{label}</div>
                      <div className="mt-1 text-xs text-slate-500 font-semibold">{blurb}</div>
                    </div>
                  </div>
                  {active && (
                    <span className="px-2 py-1 rounded-full bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
                      Selected
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {isPreparing && (
          <div className="fixed inset-0 z-[210] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Preparing funnel</div>
                  <div className="mt-1 text-lg font-black text-slate-900">{selectedGuideTitle}</div>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                  <FunnelIcon className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-600 to-teal-500 transition-all"
                  style={{ width: `${Math.max(4, Math.min(100, prepProgress))}%` }}
                />
              </div>
              <div className="mt-3 text-[11px] text-slate-500 font-semibold">
                Building topics and calibrating your first batch…
              </div>
              <button
                type="button"
                onClick={() => {}}
                className="mt-4 w-full px-4 py-2 rounded-xl bg-slate-100 text-slate-400 text-[11px] font-black uppercase tracking-widest cursor-not-allowed"
              >
                Working…
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col transition-all duration-300 ease-out p-6 md:p-10">
      <div className="mb-5 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
              <FunnelIcon className="w-4 h-4" />
              Funnel Active
            </div>
            <div className="px-3 py-1.5 rounded-full border border-white/50 bg-white/35 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm">
              {funnelContext?.guideTitle || 'Custom'}
            </div>
            <div className="px-3 py-1.5 rounded-full border border-white/50 bg-white/35 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm">
              Stage: <span className="text-slate-900">{stage.label}</span>
            </div>
          </div>
          <p className="mt-2 text-slate-500 text-sm font-medium">
            {stage.hint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => setShowStats((prev) => !prev)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/50 bg-white/35 backdrop-blur-md text-[11px] font-black uppercase tracking-widest text-slate-700 shadow-sm hover:bg-white/45"
          >
            <ChartBarIcon className="w-4 h-4" />
            {showStats ? 'Session' : 'Stats'}
          </button>

          <button
            type="button"
            onClick={onResetFunnel}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-rose-200 bg-rose-50 text-[11px] font-black uppercase tracking-widest text-rose-700 hover:bg-rose-100"
          >
            <XMarkIcon className="w-4 h-4" />
            Reset
          </button>

          <button
            type="button"
            onClick={onBackToGenerate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/50 bg-white/35 backdrop-blur-md text-[11px] font-black uppercase tracking-widest text-slate-700 shadow-sm hover:bg-white/45"
          >
            Back to selection
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 pb-32 pr-2 custom-scrollbar">
        <div className="rounded-3xl border border-white/50 bg-white/35 backdrop-blur-xl shadow-[0_22px_70px_-55px_rgba(15,23,42,0.55)] overflow-hidden">
          <div className="p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Topic narrowing</div>
                <div className="mt-2 text-sm font-semibold text-slate-800">
                  Focus targets shift as you answer and rate questions.
                </div>
                {funnelBatchMeta?.focusTargets?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {funnelBatchMeta.focusTargets.slice(0, 8).map((key) => (
                      <span
                        key={key}
                        className="px-3 py-1.5 rounded-full bg-slate-900/85 text-white text-[10px] font-black uppercase tracking-widest shadow-sm"
                      >
                        {(funnelBatchMeta.displayByKey?.[key] || key).slice(0, 52)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-[11px] text-slate-600 font-semibold">No focus targets yet.</div>
                )}
              </div>

              <div className="w-full md:w-[260px]">
                <button
                  type="button"
                  onClick={onContinueFunnel}
                  disabled={isLoading}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                    isLoading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  <ArrowPathIcon className="w-4 h-4" />
                  Continue Funnel
                </button>
                <div className="mt-2 text-[10px] text-slate-500 font-semibold">
                  Bank first, generation only as needed.
                </div>
                {funnelBatchMeta && (
                  <div className="mt-2 text-[11px] text-slate-700 font-semibold">
                    Explore {funnelBatchMeta.exploreCount}/{funnelBatchMeta.total}{' '}
                    <span className="text-slate-500">
                      · gold {funnelBatchMeta.sourceCounts.gold} · prefab {funnelBatchMeta.sourceCounts.prefab} · gen{' '}
                      {funnelBatchMeta.sourceCounts.generated}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="relative h-[240px] md:h-[280px] bg-gradient-to-b from-indigo-50/40 via-white/20 to-teal-50/40 border-t border-white/40 overflow-hidden">
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none opacity-35"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <path
                d="M5 10 H95 L65 60 Q50 80 50 95 Q50 80 35 60 L5 10 Z"
                fill="none"
                stroke="rgb(15 23 42)"
                strokeWidth="0.6"
              />
              <path
                d="M10 14 H90 L62 58 Q50 74 50 92 Q50 74 38 58 L10 14 Z"
                fill="none"
                stroke="rgb(99 102 241)"
                strokeWidth="0.5"
                strokeDasharray="1 1.5"
                opacity="0.6"
              />
            </svg>

            {conceptDots.map((dot) => {
              const style = getConceptDotStyle({
                key: dot.key,
                index: dot.index,
                total: conceptDots.length,
                category: dot.category
              });
              const cls =
                dot.category === 'focus'
                  ? 'bg-indigo-600/75 text-white border-white/50'
                  : dot.category === 'explore'
                  ? 'bg-amber-100/55 text-amber-900 border-white/50'
                  : 'bg-white/40 text-slate-700 border-white/55';
              const size = dot.category === 'focus' ? 'px-3 py-1.5 text-[10px]' : 'px-2 py-1 text-[9px]';
              return (
                <div
                  key={dot.key}
                  className={`absolute rounded-full border ${cls} ${size} font-black uppercase tracking-widest shadow-sm backdrop-blur-md transition-all duration-700 ease-out`}
                  style={{
                    ...style,
                    transform: 'translate(-50%, -50%)'
                  }}
                  title={dot.display}
                >
                  {dot.display.slice(0, dot.category === 'focus' ? 22 : 18)}
                </div>
              );
            })}
          </div>
        </div>

        {showStats ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 p-5 rounded-3xl border border-white/50 bg-white/35 backdrop-blur-xl shadow-[0_22px_70px_-55px_rgba(15,23,42,0.55)]">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Mastery snapshot</div>
              <div className="mt-3 text-sm font-semibold text-slate-800">
                Tracked concepts: <span className="text-slate-900 font-black">{masterySnapshot.tracked}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-800">
                Avg mastery: <span className="text-slate-900 font-black">{Math.round(masterySnapshot.avgExpected * 100)}%</span>
              </div>
              <div className="mt-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Hardest now</div>
              <div className="mt-2 space-y-2">
                {masterySnapshot.hardest.length === 0 ? (
                  <div className="text-sm text-slate-600 font-semibold">Answer a few questions to calibrate.</div>
                ) : (
                  masterySnapshot.hardest.map((row) => (
                    <div key={row.key} className="flex items-center justify-between gap-3 text-[11px] text-slate-700 font-semibold">
                      <div className="truncate">
                        <span className="text-slate-900 font-black">{row.display}</span>
                      </div>
                      <div className="shrink-0 text-slate-600">{Math.round(row.expected * 100)}%</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="lg:col-span-2 p-5 rounded-3xl border border-white/50 bg-white/35 backdrop-blur-xl shadow-[0_22px_70px_-55px_rgba(15,23,42,0.55)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Performance</div>
                  <div className="mt-2 text-3xl font-black text-slate-900">
                    {Math.round(funnelSummary.overallAccuracy * 100)}%
                  </div>
                  <div className="mt-1 text-sm text-slate-700 font-semibold">
                    {funnelSummary.totalCorrect} correct out of {funnelSummary.totalAnswered} answered
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl border border-white/50 bg-white/40 backdrop-blur-md shadow-sm">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Weak concepts</div>
                  <div className="mt-2 space-y-2">
                    {funnelSummary.weakConcepts.length === 0 ? (
                      <div className="text-sm text-slate-600 font-semibold">No weak concepts yet.</div>
                    ) : (
                      funnelSummary.weakConcepts.slice(0, 6).map((stat) => (
                        <div
                          key={stat.concept}
                          className="flex items-center justify-between gap-3 text-[11px] text-slate-700 font-semibold"
                        >
                          <div className="truncate">
                            <span className="text-slate-900 font-black">{stat.concept}</span>
                          </div>
                          <div className="shrink-0 text-slate-600">
                            {Math.round(stat.accuracy * 100)}% • {stat.correct}/{stat.attempts}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-white/50 bg-white/40 backdrop-blur-md shadow-sm">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lowest mastery</div>
                  <div className="mt-2 space-y-2">
                    {masterySnapshot.weakest.length === 0 ? (
                      <div className="text-sm text-slate-600 font-semibold">No mastery data yet.</div>
                    ) : (
                      masterySnapshot.weakest.map((row) => (
                        <div key={row.key} className="flex items-center justify-between gap-3 text-[11px] text-slate-700 font-semibold">
                          <div className="truncate">
                            <span className="text-slate-900 font-black">{row.display}</span>
                          </div>
                          <div className="shrink-0 text-slate-600">
                            {Math.round(row.expected * 100)}% • {row.attempts}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 rounded-2xl border border-white/50 bg-white/35 backdrop-blur-xl shadow-[0_22px_70px_-55px_rgba(15,23,42,0.55)]">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Progress</div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-700 font-semibold">
                <div>
                  Completed:{' '}
                  <span className="text-slate-900">
                    {funnelSummary.totalAnswered}/{funnelQuestions.length}
                  </span>
                </div>
                {funnelSummary.totalAnswered > 0 && (
                  <div className="text-slate-600">{Math.round(funnelSummary.overallAccuracy * 100)}% accuracy</div>
                )}
              </div>
              <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-600 to-teal-500"
                  style={{
                    width: `${funnelQuestions.length > 0
                      ? Math.min(100, Math.round((funnelSummary.totalAnswered / Math.max(funnelQuestions.length, 1)) * 100))
                      : 0}%`
                  }}
                />
              </div>
            </div>

            {funnelQuestions.map((q, idx) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={idx}
                userId={user?.id}
                onChat={onChat}
                savedState={funnelStates[q.id]}
                onStateChange={(s) => setFunnelStates((prev) => ({ ...prev, [q.id]: s }))}
                ankiRatingEnabled={true}
                onAnkiRate={(rating, meta) => onAnkiRate(q, rating, meta)}
              />
            ))}

            <div className="flex flex-col items-center justify-center p-8 rounded-[2rem] border border-white/50 bg-white/35 backdrop-blur-xl shadow-[0_22px_70px_-55px_rgba(15,23,42,0.55)] mt-12 mb-8">
              <div className="w-16 h-16 bg-slate-900 text-white rounded-full flex items-center justify-center mb-4 shadow-lg">
                <BoltIcon className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">Keep narrowing?</h3>
              <p className="text-slate-600 text-sm mb-6 max-w-sm text-center">
                Continue Funnel to pull the next batch based on your ratings and weak concepts.
              </p>
              <button
                type="button"
                onClick={onContinueFunnel}
                disabled={isLoading}
                className={`px-6 py-3 rounded-xl font-black uppercase tracking-widest text-[11px] transition-colors ${
                  isLoading ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                Continue Funnel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FunnelView;
