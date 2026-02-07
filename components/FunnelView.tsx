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
  selectTargets,
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
  onContinueFunnel: (nextCount?: number) => Promise<void>;
  onResetFunnel: () => void;
  onBackToGenerate: () => void;
  onChat: (q: Question) => void;
  onAnkiRate: (q: Question, rating: AnkiRating, meta?: { timeToAnswerMs: number | null; isCorrect: boolean | null }) => void;
};

const MAX_TEXT_CHARS = 120000;
const ANKI_RATINGS_KEY = 'mediprep_anki_ratings_v1';

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
  const [questionViewMode, setQuestionViewMode] = useState<'list' | 'focus'>('focus');
  const [focusQuestionId, setFocusQuestionId] = useState<string | null>(null);
  const focusWrapRef = useRef<HTMLDivElement | null>(null);
  const [ankiRatingsById, setAnkiRatingsById] = useState<Record<string, AnkiRating>>(() => {
    try {
      const raw = localStorage.getItem(ANKI_RATINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, AnkiRating>) : {};
    } catch {
      return {};
    }
  });
  const [nextBatchCount, setNextBatchCount] = useState<number>(() => {
    const base = Math.floor(Number(funnelContext?.prefs?.questionCount ?? 10) || 10);
    return Math.min(20, Math.max(3, base));
  });
  const syntheticKeyDispatchingRef = useRef(false);

  type FunnelUiState = {
    scrollTop?: number;
    lastQuestionId?: string;
    showStats?: boolean;
    questionViewMode?: 'list' | 'focus';
    focusQuestionId?: string;
  };

  const funnelUserId = user?.id ? String(user.id) : 'anon';
  const funnelGuideHash = funnelContext?.guideHash || 'custom';
  const uiKey = `mediprep_funnel_ui_v1_${funnelUserId}_${funnelGuideHash}`;
  const uiStateRef = useRef<FunnelUiState>({});
  const restoreDoneRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRafPendingRef = useRef(false);
  const lastScrollTopRef = useRef<number | null>(null);

  const readUiState = (): FunnelUiState => {
    try {
      const raw = localStorage.getItem(uiKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as FunnelUiState) : {};
    } catch {
      return {};
    }
  };

  const writeUiState = (patch: Partial<FunnelUiState>) => {
    try {
      const next = { ...(uiStateRef.current || {}), ...patch };
      uiStateRef.current = next;
      localStorage.setItem(uiKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    // Switching users/guide should allow a fresh restore.
    restoreDoneRef.current = false;
    const loaded = readUiState();
    uiStateRef.current = loaded;
    if (typeof loaded.showStats === 'boolean') {
      setShowStats(loaded.showStats);
    }
    if (loaded.questionViewMode === 'list' || loaded.questionViewMode === 'focus') {
      setQuestionViewMode(loaded.questionViewMode);
    } else {
      setQuestionViewMode('focus');
    }
    if (typeof loaded.focusQuestionId === 'string' && loaded.focusQuestionId.trim().length > 0) {
      setFocusQuestionId(loaded.focusQuestionId);
    } else if (typeof loaded.lastQuestionId === 'string' && loaded.lastQuestionId.trim().length > 0) {
      setFocusQuestionId(loaded.lastQuestionId);
    } else {
      setFocusQuestionId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiKey]);

  useEffect(() => {
    const base = Math.floor(Number(funnelContext?.prefs?.questionCount ?? 10) || 10);
    setNextBatchCount(Math.min(20, Math.max(3, base)));
  }, [funnelContext?.prefs?.questionCount, funnelGuideHash]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ANKI_RATINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      setAnkiRatingsById(parsed && typeof parsed === 'object' ? (parsed as Record<string, AnkiRating>) : {});
    } catch {
      setAnkiRatingsById({});
    }
  }, [funnelGuideHash]);

  useEffect(() => {
    return () => {
      const node = scrollRef.current;
      if (node) writeUiState({ scrollTop: node.scrollTop });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiKey]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    lastScrollTopRef.current = node.scrollTop;
    if (scrollRafPendingRef.current) return;
    scrollRafPendingRef.current = true;
    window.requestAnimationFrame(() => {
      scrollRafPendingRef.current = false;
      const top = lastScrollTopRef.current;
      if (typeof top === 'number' && Number.isFinite(top)) {
        writeUiState({ scrollTop: top });
      }
    });
  };

  useEffect(() => {
    if (restoreDoneRef.current) return;
    const container = scrollRef.current;
    if (!container) return;

    // Wait until content is present.
    if (!showStats && funnelQuestions.length === 0) return;

    const doRestore = () => {
      const state = uiStateRef.current || {};
      if (!showStats) {
        const preferredId = state.focusQuestionId || state.lastQuestionId;
        if (preferredId && funnelQuestions.some((q) => q.id === preferredId)) {
          if (scrollToQuestionId(preferredId, 'auto')) {
            restoreDoneRef.current = true;
            return;
          }
        }
      }

      const top = state.scrollTop;
      if (typeof top === 'number' && Number.isFinite(top)) {
        const max = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.max(0, Math.min(top, max));
      }
      restoreDoneRef.current = true;
    };

    const id = window.requestAnimationFrame(doRestore);
    return () => window.cancelAnimationFrame(id);
  }, [funnelQuestions.length, showStats]);

  const markLastActive = (questionId: string) => {
    writeUiState({ lastQuestionId: questionId });
  };

  const scrollToQuestionId = (questionId: string, behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current;
    if (!container) return false;

    const cssEscape =
      typeof (globalThis as any).CSS?.escape === 'function'
        ? (value: string) => (CSS as any).escape(value)
        : (value: string) => value.replace(/["\\\\]/g, '\\\\$&');
    const el = container.querySelector(`[data-funnel-qid=\"${cssEscape(questionId)}\"]`);
    if (!el) return false;

    const target = el as HTMLElement;
    const elRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const currentScrollTop = container.scrollTop;
    const elTopInContainer = elRect.top - containerRect.top + currentScrollTop;
    const centeredTop = elTopInContainer - container.clientHeight / 2 + target.offsetHeight / 2;
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextTop = Math.max(0, Math.min(centeredTop, max));
    try {
      container.scrollTo({ top: nextTop, behavior });
    } catch {
      container.scrollTop = nextTop;
    }
    return true;
  };

  const isAnswered = (questionId: string) => {
    const state = funnelStates[questionId];
    return typeof state?.selectedOption === 'string' && state.selectedOption.trim().length > 0;
  };

  const firstUnansweredId = useMemo(() => {
    const found = funnelQuestions.find((q) => !isAnswered(q.id));
    return found?.id || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnelQuestions, funnelStates]);

  const resolveJumpTargetId = () => {
    if (funnelQuestions.length === 0) return null;
    const lastId = uiStateRef.current?.lastQuestionId;
    const validLastId = lastId && funnelQuestions.some((q) => q.id === lastId) ? lastId : null;

    const lastIsUnanswered = validLastId ? !isAnswered(validLastId) : false;
    return (lastIsUnanswered ? validLastId : null) || firstUnansweredId || validLastId || funnelQuestions[funnelQuestions.length - 1]?.id || null;
  };

  const handleJumpToCurrentQuestion = () => {
    if (showStats) return;
    const targetId = resolveJumpTargetId();
    if (!targetId) return;

    markLastActive(targetId);
    if (questionViewMode === 'focus') {
      setFocusQuestionId(targetId);
      writeUiState({ focusQuestionId: targetId });
    }
    scrollToQuestionId(targetId, 'smooth');
  };
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
    writeUiState({ questionViewMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionViewMode]);

  useEffect(() => {
    if (questionViewMode !== 'focus') return;
    if (!focusQuestionId) return;
    if (!funnelQuestions.some((q) => q.id === focusQuestionId)) return;
    writeUiState({ focusQuestionId });
    markLastActive(focusQuestionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionViewMode, focusQuestionId, funnelQuestions.length]);

  useEffect(() => {
    if (questionViewMode !== 'focus') return;
    if (showStats) return;
    if (funnelQuestions.length === 0) return;
    if (focusQuestionId && funnelQuestions.some((q) => q.id === focusQuestionId)) return;
    const fallback = resolveJumpTargetId() || funnelQuestions[0]?.id || null;
    if (!fallback) return;
    setFocusQuestionId(fallback);
    writeUiState({ focusQuestionId: fallback });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionViewMode, showStats, funnelQuestions.length]);

  const focusCurrentCard = () => {
    const wrap = focusWrapRef.current;
    if (!wrap) return;
    const el = wrap.querySelector<HTMLElement>('[tabindex="0"]');
    el?.focus();
  };

  const isTextInputTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean((el as any).isContentEditable);
  };

  const getActiveQuestionCardRoot = (): HTMLElement | null => {
    if (showStats) return null;
    if (questionViewMode === 'focus') {
      return focusWrapRef.current?.querySelector<HTMLElement>('[tabindex="0"]') || null;
    }
    const container = scrollRef.current;
    if (!container) return null;
    const targetId = resolveJumpTargetId();
    if (!targetId) return null;
    const cssEscape =
      typeof (globalThis as any).CSS?.escape === 'function'
        ? (value: string) => (CSS as any).escape(value)
        : (value: string) => value.replace(/["\\\\]/g, '\\\\$&');
    const wrap = container.querySelector(`[data-funnel-qid=\"${cssEscape(targetId)}\"]`);
    if (!wrap) return null;
    return (wrap as HTMLElement).querySelector<HTMLElement>('[tabindex="0"]') || null;
  };

  useEffect(() => {
    // Make shortcuts "just work" without requiring the user to click the card first.
    const handler = (e: KeyboardEvent) => {
      if (syntheticKeyDispatchingRef.current) return;
      if (showStats) return;
      if (isTextInputTarget(e.target)) return;
      if (e.altKey) return;

      const key = String(e.key || '');
      const lower = key.toLowerCase();

      const isUndo = (e.metaKey || e.ctrlKey) && lower === 'z';
      const isEnter = lower === 'enter';
      const isOptionOrRating = /^[1-5]$/.test(lower) || /^[a-e]$/.test(lower);

      if (!isUndo && !isEnter && !isOptionOrRating) return;

      const root = getActiveQuestionCardRoot();
      if (!root) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        root.focus();
      } catch {
        // ignore
      }

      syntheticKeyDispatchingRef.current = true;
      try {
        const synthetic = new KeyboardEvent('keydown', {
          key,
          code: (e as any).code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          bubbles: true,
          cancelable: true
        });
        root.dispatchEvent(synthetic);
      } finally {
        syntheticKeyDispatchingRef.current = false;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showStats, questionViewMode, focusQuestionId, funnelQuestions.length, funnelStates]);

  useEffect(() => {
    if (questionViewMode !== 'focus') return;
    if (showStats) return;
    if (!focusQuestionId) return;
    const id = window.requestAnimationFrame(() => focusCurrentCard());
    return () => window.cancelAnimationFrame(id);
  }, [questionViewMode, showStats, focusQuestionId]);

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

  const liveTargets = useMemo(() => {
    if (!conceptUniverse) return null;
    const total = Math.max(1, Math.floor(Number(funnelContext?.prefs?.questionCount ?? 20) || 20));
    return selectTargets({ guideConcepts: conceptUniverse, funnel: funnelState, total });
  }, [conceptUniverse, funnelState, funnelContext?.prefs?.questionCount]);

  const currentBatchIds = useMemo(() => {
    const ids = Object.keys(funnelBatchMeta?.targetByQuestionId || {});
    if (ids.length > 0) return ids;
    const fallbackCount = Math.min(
      funnelQuestions.length,
      Math.max(1, Math.floor(Number(funnelContext?.prefs?.questionCount ?? 20) || 20))
    );
    return funnelQuestions.slice(-fallbackCount).map((q) => q.id);
  }, [funnelBatchMeta?.createdAt, funnelQuestions.length, funnelContext?.prefs?.questionCount]);

  const batchRatedCount = useMemo(() => {
    if (currentBatchIds.length === 0) return 0;
    let count = 0;
    currentBatchIds.forEach((id) => {
      const r = ankiRatingsById[id];
      if (r === 1 || r === 2 || r === 3 || r === 4) count += 1;
    });
    return count;
  }, [currentBatchIds, ankiRatingsById]);

  const isBatchComplete = currentBatchIds.length > 0 && batchRatedCount >= currentBatchIds.length;

  const conceptDots = useMemo(() => {
    if (!conceptUniverse) return [];
    const keys = Array.from(conceptUniverse.keys());
    const maxDots = 120;
    const limited = keys.slice(0, Math.min(keys.length, maxDots));
    const focus = new Set((liveTargets?.focusTargetsDistinct || []).map((k) => normalizeConceptKey(k)));
    const explore = new Set((liveTargets?.exploreTargets || []).map((k) => normalizeConceptKey(k)));
    return limited.map((key, index) => {
      const norm = normalizeConceptKey(key);
      const category = focus.has(norm) ? 'focus' : explore.has(norm) ? 'explore' : 'other';
      const display = conceptUniverse.get(key) || key;
      return { key, norm, display, index, category };
    });
  }, [conceptUniverse, liveTargets?.focusTargetsDistinct, liveTargets?.exploreTargets, vizTick]);

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
    if (!user) {
      setPrepError('Log in to start Funnel Mode.');
      return;
    }
    if (!isXaiConfigured) {
      setPrepError('AI service unavailable. Please try again later.');
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
            onClick={() =>
              setShowStats((prev) => {
                const next = !prev;
                writeUiState({ showStats: next });
                return next;
              })
            }
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-6 pb-32 pr-2 custom-scrollbar"
      >
        <div className="rounded-3xl border border-white/50 bg-white/35 backdrop-blur-xl shadow-[0_22px_70px_-55px_rgba(15,23,42,0.55)] overflow-hidden">
          <div className="p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Topic narrowing</div>
                <div className="mt-2 text-sm font-semibold text-slate-800">
                  Focus targets shift as you answer and rate questions.
                </div>
                {liveTargets?.focusTargetsDistinct?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {liveTargets.focusTargetsDistinct.slice(0, 8).map((key) => (
                      <span
                        key={key}
                        className="px-3 py-1.5 rounded-full bg-slate-900/85 text-white text-[10px] font-black uppercase tracking-widest shadow-sm"
                      >
                        {(conceptUniverse?.get(key) || key).slice(0, 52)}
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
                  onClick={() => onContinueFunnel(nextBatchCount)}
                  disabled={isLoading || !isBatchComplete}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                    isLoading || !isBatchComplete
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  <ArrowPathIcon className="w-4 h-4" />
                  Continue Funnel
                </button>
                <div className="mt-2 text-[10px] text-slate-600 font-semibold">
                  Batch progress: <span className="text-slate-900 font-black">{batchRatedCount}/{currentBatchIds.length}</span> rated
                </div>
                {!isBatchComplete ? (
                  <div className="mt-2 text-[10px] text-slate-500 font-semibold">
                    Finish rating this batch to unlock Continue.
                  </div>
                ) : (
                  <div className="mt-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Next batch size</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[5, 10, 15, 20].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setNextBatchCount(n)}
                          className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                            nextBatchCount === n
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white/70 text-slate-700 border-slate-200 hover:bg-white'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {funnelBatchMeta && (
                  <div className="mt-2 text-[11px] text-slate-700 font-semibold">
                    <span className="text-slate-500">
                      Last batch: gold {funnelBatchMeta.sourceCounts.gold} · prefab {funnelBatchMeta.sourceCounts.prefab} · gen{' '}
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
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Progress</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setQuestionViewMode((prev) => {
                        const next = prev === 'focus' ? 'list' : 'focus';
                        writeUiState({ questionViewMode: next });
                        return next;
                      })
                    }
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-white/50 bg-white/45 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm hover:bg-white/60"
                    title={questionViewMode === 'focus' ? 'Switch to list view' : 'Switch to focus view'}
                  >
                    {questionViewMode === 'focus' ? 'List view' : 'Focus view'}
                  </button>

                  <button
                    type="button"
                    onClick={handleJumpToCurrentQuestion}
                    disabled={funnelQuestions.length === 0}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm transition-colors ${
                      funnelQuestions.length === 0
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    Jump to current
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-700 font-semibold">
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

              {questionViewMode === 'focus' && funnelQuestions.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-600 font-semibold">
                    Current:{' '}
                    <span className="text-slate-900 font-black">
                      {Math.max(1, funnelQuestions.findIndex((q) => q.id === focusQuestionId) + 1)}/{funnelQuestions.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const idx = funnelQuestions.findIndex((q) => q.id === focusQuestionId);
                        if (idx <= 0) return;
                        const nextId = funnelQuestions[idx - 1]?.id;
                        if (!nextId) return;
                        setFocusQuestionId(nextId);
                        writeUiState({ focusQuestionId: nextId });
                        markLastActive(nextId);
                      }}
                      disabled={funnelQuestions.findIndex((q) => q.id === focusQuestionId) <= 0}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white/70 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = funnelQuestions.findIndex((q) => q.id === focusQuestionId);
                        if (idx < 0) return;
                        const nextId = funnelQuestions[idx + 1]?.id;
                        if (!nextId) return;
                        setFocusQuestionId(nextId);
                        writeUiState({ focusQuestionId: nextId });
                        markLastActive(nextId);
                      }}
                      disabled={funnelQuestions.findIndex((q) => q.id === focusQuestionId) >= funnelQuestions.length - 1}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white/70 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = funnelQuestions.findIndex((q) => q.id === focusQuestionId);
                        const start = idx >= 0 ? idx + 1 : 0;
                        const nextUnanswered =
                          funnelQuestions.slice(start).find((q) => !isAnswered(q.id)) ||
                          funnelQuestions.find((q) => !isAnswered(q.id)) ||
                          null;
                        if (!nextUnanswered) return;
                        setFocusQuestionId(nextUnanswered.id);
                        writeUiState({ focusQuestionId: nextUnanswered.id });
                        markLastActive(nextUnanswered.id);
                        scrollToQuestionId(nextUnanswered.id, 'smooth');
                      }}
                      className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-[10px] font-black uppercase tracking-widest text-indigo-700 hover:bg-indigo-100"
                      title="Jump to the next unanswered question"
                    >
                      Next unanswered
                    </button>
                  </div>
                </div>
              )}
            </div>

            {questionViewMode === 'list' ? (
              funnelQuestions.map((q, idx) => (
                <div
                  key={q.id}
                  data-funnel-qid={q.id}
                  onFocusCapture={() => markLastActive(q.id)}
                  className="rounded-[2rem] focus-within:ring-2 focus-within:ring-indigo-200/80 focus-within:ring-offset-4 focus-within:ring-offset-slate-50"
                >
                  <QuestionCard
                    question={q}
                    index={idx}
                    userId={user?.id}
                    onChat={(question) => {
                      markLastActive(question?.id || q.id);
                      onChat(question);
                    }}
                    savedState={funnelStates[q.id]}
                    onStateChange={(s) => {
                      markLastActive(q.id);
                      setFunnelStates((prev) => ({ ...prev, [q.id]: s }));
                    }}
                    keyboardShortcutsEnabled={true}
                    ankiRatingEnabled={true}
                    onAnkiRate={(rating, meta) => {
                      setAnkiRatingsById((prev) => ({ ...prev, [q.id]: rating }));
                      onAnkiRate(q, rating, meta);
                    }}
                  />
                </div>
              ))
            ) : (
              (() => {
                const idx = funnelQuestions.findIndex((q) => q.id === focusQuestionId);
                const current = idx >= 0 ? funnelQuestions[idx] : funnelQuestions[0];
                if (!current) return null;
                return (
                  <div
                    ref={focusWrapRef}
                    key={current.id}
                    data-funnel-qid={current.id}
                    onFocusCapture={() => markLastActive(current.id)}
                    className="rounded-[2rem] focus-within:ring-2 focus-within:ring-indigo-200/80 focus-within:ring-offset-4 focus-within:ring-offset-slate-50"
                  >
                    <QuestionCard
                      question={current}
                      index={idx >= 0 ? idx : 0}
                      userId={user?.id}
                      onChat={(question) => {
                        markLastActive(question?.id || current.id);
                        onChat(question);
                      }}
                      savedState={funnelStates[current.id]}
                      onStateChange={(s) => {
                        markLastActive(current.id);
                        setFunnelStates((prev) => ({ ...prev, [current.id]: s }));
                      }}
                      keyboardShortcutsEnabled={true}
                      ankiRatingEnabled={true}
                      onAnkiRate={(rating, meta) => {
                        setAnkiRatingsById((prev) => ({ ...prev, [current.id]: rating }));
                        onAnkiRate(current, rating, meta);
                        // Anki-like flow: advance after rating.
                        const start = idx >= 0 ? idx + 1 : 0;
                        const nextUnanswered =
                          funnelQuestions.slice(start).find((q) => !isAnswered(q.id)) ||
                          funnelQuestions.find((q) => !isAnswered(q.id)) ||
                          funnelQuestions[start]?.id ||
                          null;
                        const nextId = typeof nextUnanswered === 'string' ? nextUnanswered : nextUnanswered?.id;
                        if (nextId && nextId !== current.id) {
                          setFocusQuestionId(nextId);
                          writeUiState({ focusQuestionId: nextId });
                          markLastActive(nextId);
                        }
                      }}
                    />
                  </div>
                );
              })()
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FunnelView;
