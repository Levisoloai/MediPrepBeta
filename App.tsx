import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from './components/Navigation';
import InputSection from './components/InputSection';
import QuestionCard from './components/QuestionCard';
import EmptyState from './components/EmptyState';
import DeepDiveView from './components/DeepDiveView';
import BetaAnalyticsView from './components/BetaAnalyticsView';
import AuthModal from './components/AuthModal';
import { generateQuestions, chatWithTutor } from './services/geminiService';
import { flushFeedbackQueue } from './services/feedbackService';
import { getPrefabSet, getActivePrefabQuestions } from './services/prefabService';
import { getApprovedGoldQuestions } from './services/goldQuestionService';
import { Question, UserPreferences, StudyFile, ChatMessage, QuestionState, StudyGuideItem, QuestionType, DifficultyLevel, ExamFormat, CardStyle } from './types';
import { normalizeOptions, resolveCorrectAnswer } from './utils/answerKey';
import { buildFingerprintSet, buildFingerprintVariants, filterDuplicateQuestions } from './utils/questionDedupe';
import { attachHistologyToQuestions } from './utils/histology';
import { buildHistologyReviewQuestions, selectHistologyEntries, HistologyReviewMode } from './utils/histologyReview';
import { SparklesIcon, XMarkIcon, ChatBubbleLeftRightIcon, PaperAirplaneIcon, ExclamationTriangleIcon, CheckIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/solid';
import katex from 'katex';
import { supabase } from './services/supabaseClient';
import { fetchSeenFingerprints, recordSeenQuestions } from './services/seenQuestionsService';
import { trackTutorUsage } from './services/tutorUsageService';
import { getHistologyVignettes } from './services/histologyReviewService';

type ViewMode = 'generate' | 'practice' | 'remediation' | 'deepdive' | 'histology' | 'analytics';

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

const normalizeQuestionShape = (question: Question): Question => {
  const normalizedOptions = normalizeOptions(question.options);
  return {
    ...question,
    options: normalizedOptions,
    correctAnswer: resolveCorrectAnswer({
      correctAnswer: question.correctAnswer,
      options: normalizedOptions,
      explanation: question.explanation
    }),
    studyConcepts: normalizeStudyConcepts(question.studyConcepts)
  };
};

const App: React.FC = () => {
  const LAST_GUIDE_CONTEXT_KEY = 'mediprep_last_guide_context';
  const allowedViews = new Set<ViewMode>(['generate', 'practice', 'remediation', 'deepdive', 'histology', 'analytics']);
  const loadBetaPrefs = (): UserPreferences => {
    const defaults: UserPreferences = {
      generationMode: 'questions',
      questionType: QuestionType.MULTIPLE_CHOICE,
      difficulty: DifficultyLevel.CLINICAL_VIGNETTE,
      questionCount: 10,
      autoQuestionCount: false,
      customInstructions: '',
      focusedOnWeakness: false,
      examFormat: ExamFormat.NBME,
      cardStyle: CardStyle.BASIC
    };
    try {
      const saved = localStorage.getItem('mediprep_beta_prefs');
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      const safeCount = Math.min(20, Math.max(3, Number(parsed.questionCount) || defaults.questionCount));
      return {
        ...defaults,
        ...parsed,
        questionCount: safeCount,
        autoQuestionCount: Boolean(parsed.autoQuestionCount)
      };
    } catch {
      return defaults;
    }
  };
  const onboardingSteps = [
    {
      title: 'Pick a module',
      body: 'Choose Hematology or Pulmonology to load the study guide.'
    },
    {
      title: 'Tune your session',
      body: 'Set question count, difficulty, and any custom focus before generating.'
    },
    {
      title: 'Practice + review',
      body: 'Answer, reveal explanations, and use the hover performance summary to spot weak concepts.'
    },
    {
      title: 'Try Deep Dive',
      body: 'Switch to Deep Dive for focused concept drills with instant feedback.'
    }
  ];

  const shuffleList = <T,>(items: T[]) => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const hasSeenFingerprint = useCallback((question: Question, set: Set<string>) => {
    const variants = buildFingerprintVariants(question);
    return variants.some((variant) => set.has(variant));
  }, []);

  const addFingerprintsToSet = useCallback((question: Question, set: Set<string>) => {
    const variants = buildFingerprintVariants(question);
    variants.forEach((variant) => set.add(variant));
  }, []);

  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('mediprep_current_view') as ViewMode | null;
    return saved && allowedViews.has(saved) ? saved : 'generate';
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [sessionToolsOpen, setSessionToolsOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('mediprep_session_tools_open');
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });
  const [emailConfirmState, setEmailConfirmState] = useState<{
    status: 'verifying' | 'success' | 'error';
    message?: string;
  } | null>(null);

  const [practiceQuestions, setPracticeQuestions] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem('mediprep_active_questions');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.map(normalizeQuestionShape) : [];
    } catch (e) {
      console.warn("Failed to restore questions from storage", e);
      return [];
    }
  });

  const [remediationQuestions, setRemediationQuestions] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem('mediprep_remediation_questions');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.map(normalizeQuestionShape) : [];
    } catch (e) {
      console.warn("Failed to restore remediation from storage", e);
      return [];
    }
  });

  const [practiceStates, setPracticeStates] = useState<Record<string, QuestionState>>(() => {
    try {
      const saved = localStorage.getItem('mediprep_practice_states');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [remediationStates, setRemediationStates] = useState<Record<string, QuestionState>>(() => {
    try {
      const saved = localStorage.getItem('mediprep_remediation_states');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<any>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isXaiConfigured, setIsXaiConfigured] = useState(true);
  const [prefabMeta, setPrefabMeta] = useState<{
    mode: 'prefab' | 'mixed';
    guideHash: string;
    guideTitle?: string;
    totalPrefab: number;
    remainingPrefab?: number;
  } | null>(null);
  const [prefabExhausted, setPrefabExhausted] = useState(false);
  const [remediationMeta, setRemediationMeta] = useState<{
    concepts: string[];
    generatedAt: string;
  } | null>(null);
  const [histologyQuestions, setHistologyQuestions] = useState<Question[]>([]);
  const [histologyStates, setHistologyStates] = useState<Record<string, QuestionState>>({});
  const [histologyMode, setHistologyMode] = useState<HistologyReviewMode>(() => {
    try {
      const saved = localStorage.getItem('mediprep_histology_mode');
      return saved === 'diagnosis' ? 'diagnosis' : 'vignette';
    } catch {
      return 'vignette';
    }
  });
  const [isHistologyLoading, setIsHistologyLoading] = useState(false);
  const [histologyError, setHistologyError] = useState<string | null>(null);
  const [lastGuideContext, setLastGuideContext] = useState<{
    content: string;
    prefs: UserPreferences;
    guideHash?: string;
    guideItems?: StudyGuideItem[];
    guideTitle?: string;
    moduleId?: 'heme' | 'pulm';
  } | null>(() => {
    try {
      const saved = localStorage.getItem(LAST_GUIDE_CONTEXT_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeQuestionForChat, setActiveQuestionForChat] = useState<Question | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatHistoryByQuestion, setChatHistoryByQuestion] = useState<Record<string, ChatMessage[]>>(() => {
    try {
      const saved = localStorage.getItem('mediprep_chat_history_by_question');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [tutorModel, setTutorModel] = useState<'flash' | 'pro'>('pro');
  const [tutorSessionId, setTutorSessionId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const seenFingerprintCache = useRef<Map<string, Set<string>>>(new Map());

  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const adminEmails = (import.meta.env.VITE_ADMIN_EMAILS || '')
    .split(',')
    .map((email: string) => email.trim().toLowerCase())
    .filter(Boolean);
  const adminDomain = (import.meta.env.VITE_ADMIN_DOMAIN || '').trim().toLowerCase();
  const adminMode = import.meta.env.VITE_ADMIN_MODE === 'true' || import.meta.env.DEV;
  const userEmail = user?.email?.toLowerCase() || '';
  const isAdmin = !!user && (
    adminEmails.includes(userEmail) ||
    (adminDomain ? userEmail.endsWith(`@${adminDomain}`) : false) ||
    (adminMode && adminEmails.length === 0 && !adminDomain)
  );

  const hashString = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  };

  const getGuideOverride = useCallback(
    (guideHash: string) => {
      if (!isAdmin) return null;
      const stored = localStorage.getItem(`mediprep_ab_override_${guideHash}`);
      if (stored === 'gold' || stored === 'guide' || stored === 'split') return stored;
      return null;
    },
    [isAdmin]
  );

  const getGuideVariant = useCallback(
    (guideHash: string) => {
      const override = getGuideOverride(guideHash);
      if (override) return override;
      const storageKey = `mediprep_ab_variant_${guideHash}`;
      if (!user?.id) {
        const stored = localStorage.getItem(storageKey);
        if (stored === 'gold' || stored === 'guide') return stored;
      }
      const seed = `${user?.id || 'anon'}:${guideHash}`;
      const variant = hashString(seed) % 2 === 0 ? 'gold' : 'guide';
      if (!user?.id) {
        localStorage.setItem(storageKey, variant);
      }
      return variant;
    },
    [getGuideOverride, user?.id]
  );

  const shortHash = (value?: string | null) => {
    if (!value) return 'n/a';
    if (value.length <= 10) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  };

  const getSeenKey = useCallback(
    (moduleId: string) => `mediprep_seen_${user?.id || 'anon'}_${moduleId}`,
    [user?.id]
  );

  const getSeenFingerprintKey = useCallback(
    (moduleId: string) => `mediprep_seen_fp_${user?.id || 'anon'}_${moduleId}`,
    [user?.id]
  );

  const loadSeenSet = useCallback(
    (moduleId: string) => {
      if (!moduleId) return new Set<string>();
      try {
        const raw = localStorage.getItem(getSeenKey(moduleId));
        const parsed = raw ? (JSON.parse(raw) as string[]) : [];
        return new Set(parsed);
      } catch (err) {
        return new Set<string>();
      }
    },
    [getSeenKey]
  );

  const saveSeenSet = useCallback(
    (moduleId: string, set: Set<string>) => {
      if (!moduleId) return;
      localStorage.setItem(getSeenKey(moduleId), JSON.stringify(Array.from(set)));
    },
    [getSeenKey]
  );

  const loadSeenFingerprintSet = useCallback(
    (moduleId: string) => {
      if (!moduleId) return new Set<string>();
      try {
        const raw = localStorage.getItem(getSeenFingerprintKey(moduleId));
        const parsed = raw ? (JSON.parse(raw) as string[]) : [];
        return new Set(parsed);
      } catch (err) {
        return new Set<string>();
      }
    },
    [getSeenFingerprintKey]
  );

  const saveSeenFingerprintSet = useCallback(
    (moduleId: string, set: Set<string>) => {
      if (!moduleId) return;
      localStorage.setItem(getSeenFingerprintKey(moduleId), JSON.stringify(Array.from(set)));
    },
    [getSeenFingerprintKey]
  );

  const ensureSeenFingerprints = useCallback(
    async (moduleId: string) => {
      if (!moduleId) return new Set<string>();
      const cached = seenFingerprintCache.current.get(moduleId);
      if (cached) return cached;

      const localSet = loadSeenFingerprintSet(moduleId);
      if (user?.id) {
        try {
          const server = await fetchSeenFingerprints(user.id, moduleId);
          server.forEach((fp) => localSet.add(fp));
          saveSeenFingerprintSet(moduleId, localSet);
        } catch {
          // ignore server errors
        }
      }
      seenFingerprintCache.current.set(moduleId, localSet);
      return localSet;
    },
    [loadSeenFingerprintSet, saveSeenFingerprintSet, user?.id]
  );

  const markQuestionsSeenByFingerprint = useCallback(
    async (moduleId: string, list: Question[]) => {
      if (!moduleId || list.length === 0) return;
      const set = await ensureSeenFingerprints(moduleId);
      const fresh: Question[] = [];
      list.forEach((q) => {
        const variants = buildFingerprintVariants(q);
        if (variants.some((variant) => set.has(variant))) return;
        variants.forEach((variant) => set.add(variant));
        fresh.push(q);
      });
      saveSeenFingerprintSet(moduleId, set);
      if (user?.id && fresh.length > 0) {
        try {
          await recordSeenQuestions(user.id, moduleId, fresh);
        } catch {
          // ignore write failures
        }
      }
    },
    [ensureSeenFingerprints, saveSeenFingerprintSet, user?.id]
  );

  const markQuestionsSeen = useCallback(
    (moduleId: string, list: Question[]) => {
      if (!moduleId || list.length === 0) return;
      const set = loadSeenSet(moduleId);
      list.forEach((q) => {
        if (q?.id) set.add(q.id);
      });
      saveSeenSet(moduleId, set);
    },
    [loadSeenSet, saveSeenSet]
  );

  const filterUnseenQuestions = useCallback(
    (moduleId: string, list: Question[]) => {
      if (!moduleId || list.length === 0) return list;
      const set = loadSeenSet(moduleId);
      return list.filter((q) => !set.has(q.id));
    },
    [loadSeenSet]
  );

  useEffect(() => {
    seenFingerprintCache.current = new Map();
  }, [user?.id]);

  useEffect(() => {
    localStorage.setItem('mediprep_current_view', view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem('mediprep_active_questions', JSON.stringify(practiceQuestions));
  }, [practiceQuestions]);

  useEffect(() => {
    localStorage.setItem('mediprep_remediation_questions', JSON.stringify(remediationQuestions));
  }, [remediationQuestions]);

  useEffect(() => {
    localStorage.setItem('mediprep_practice_states', JSON.stringify(practiceStates));
  }, [practiceStates]);

  useEffect(() => {
    localStorage.setItem('mediprep_remediation_states', JSON.stringify(remediationStates));
  }, [remediationStates]);

  useEffect(() => {
    try {
      if (lastGuideContext) {
        localStorage.setItem(LAST_GUIDE_CONTEXT_KEY, JSON.stringify(lastGuideContext));
      } else {
        localStorage.removeItem(LAST_GUIDE_CONTEXT_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, [lastGuideContext]);

  useEffect(() => {
    localStorage.setItem('mediprep_chat_history_by_question', JSON.stringify(chatHistoryByQuestion));
  }, [chatHistoryByQuestion]);

  useEffect(() => {
    try {
      localStorage.setItem('mediprep_session_tools_open', sessionToolsOpen ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [sessionToolsOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('mediprep_histology_mode', histologyMode);
    } catch {
      // ignore storage errors
    }
  }, [histologyMode]);

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const searchParams = new URLSearchParams(search);
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
    const type = searchParams.get('type') || hashParams.get('type');
    const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');
    const code = searchParams.get('code');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const isConfirmRoute =
      pathname === '/auth/confirm' ||
      type === 'signup' ||
      Boolean(tokenHash) ||
      Boolean(code) ||
      Boolean(accessToken) ||
      Boolean(refreshToken);

    if (!isConfirmRoute) return;

    setEmailConfirmState({ status: 'verifying' });

    const verify = async () => {
      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as any
          });
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          if (error) throw error;
        }
        setEmailConfirmState({ status: 'success' });
      } catch (err: any) {
        setEmailConfirmState({
          status: 'error',
          message: err?.message || 'Verification failed. Please try again from the email link.'
        });
      }
    };

    verify();
  }, []);

  useEffect(() => {
    setChatHistoryByQuestion(prev => {
      if (practiceQuestions.length === 0 && remediationQuestions.length === 0) {
        return Object.keys(prev).length > 0 ? {} : prev;
      }

      const activeIds = new Set([
        ...practiceQuestions.map(q => q.id),
        ...remediationQuestions.map(q => q.id)
      ]);
      let changed = false;
      const next: Record<string, ChatMessage[]> = {};
      Object.entries(prev).forEach(([id, history]) => {
        if (activeIds.has(id)) {
          next[id] = history;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [practiceQuestions, remediationQuestions]);

  const buildPerformanceSummary = (items: Question[], states: Record<string, QuestionState>) => {
    const stats = new Map<string, { attempts: number; correct: number }>();
    let totalAnswered = 0;
    let totalCorrect = 0;

    items.forEach((question) => {
      const state = states[question.id];
      if (!state?.selectedOption) return;
      totalAnswered += 1;
      const isCorrect = state.selectedOption === question.correctAnswer;
      if (isCorrect) totalCorrect += 1;
      const concepts = Array.isArray(question.studyConcepts) && question.studyConcepts.length > 0
        ? question.studyConcepts
        : ['General'];
      concepts.forEach((concept) => {
        const key = concept?.trim() || 'General';
        const current = stats.get(key) || { attempts: 0, correct: 0 };
        current.attempts += 1;
        if (isCorrect) current.correct += 1;
        stats.set(key, current);
      });
    });

    const conceptStats = Array.from(stats.entries()).map(([concept, data]) => ({
      concept,
      attempts: data.attempts,
      correct: data.correct,
      accuracy: data.attempts ? data.correct / data.attempts : 0
    }));

    conceptStats.sort((a, b) => {
      if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
      return b.attempts - a.attempts;
    });

    let weakConcepts = conceptStats.filter(stat => stat.attempts >= 2 && stat.accuracy < 0.6);
    if (weakConcepts.length === 0) {
      weakConcepts = conceptStats.filter(stat => stat.attempts > 0).slice(0, 3);
    }

    const overallAccuracy = totalAnswered ? totalCorrect / totalAnswered : 0;
    return {
      totalAnswered,
      totalCorrect,
      overallAccuracy,
      conceptStats,
      weakConcepts
    };
  };

  const practiceSummary = React.useMemo(
    () => buildPerformanceSummary(practiceQuestions, practiceStates),
    [practiceQuestions, practiceStates]
  );

  const remediationSummary = React.useMemo(
    () => buildPerformanceSummary(remediationQuestions, remediationStates),
    [remediationQuestions, remediationStates]
  );

  const histologySummary = React.useMemo(
    () => buildPerformanceSummary(histologyQuestions, histologyStates),
    [histologyQuestions, histologyStates]
  );

  const abDebug = React.useMemo(() => {
    const counts = {
      gold: 0,
      prefab: 0,
      generated: 0,
      other: 0
    };
    practiceQuestions.forEach((question) => {
      const src = question.sourceType || 'generated';
      if (src === 'gold') counts.gold += 1;
      else if (src === 'prefab') counts.prefab += 1;
      else if (src === 'generated') counts.generated += 1;
      else counts.other += 1;
    });

    const variant = practiceQuestions.find((q) => q.abVariant)?.abVariant || null;
    const guideHash = practiceQuestions.find((q) => q.guideHash)?.guideHash || lastGuideContext?.guideHash || null;
    const guideTitle = lastGuideContext?.guideTitle || null;

    return {
      variant,
      guideHash,
      guideTitle,
      counts
    };
  }, [practiceQuestions, lastGuideContext?.guideHash, lastGuideContext?.guideTitle]);

  const [abOverride, setAbOverride] = useState<'auto' | 'gold' | 'guide' | 'split'>('auto');

  useEffect(() => {
    if (!isAdmin) {
      setAbOverride('auto');
      return;
    }
    const activeGuideHash = lastGuideContext?.guideHash;
    if (!activeGuideHash) {
      setAbOverride('auto');
      return;
    }
    const stored = localStorage.getItem(`mediprep_ab_override_${activeGuideHash}`);
    if (stored === 'gold' || stored === 'guide' || stored === 'split') {
      setAbOverride(stored);
    } else {
      setAbOverride('auto');
    }
  }, [isAdmin, lastGuideContext?.guideHash]);

  const handleOverrideChange = (next: 'auto' | 'gold' | 'guide' | 'split') => {
    setAbOverride(next);
    const activeGuideHash = lastGuideContext?.guideHash;
    if (!activeGuideHash) return;
    const storageKey = `mediprep_ab_override_${activeGuideHash}`;
    if (next === 'auto') {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, next);
    }
  };

  useEffect(() => {
    if (!import.meta.env.VITE_XAI_API_KEY) {
      console.warn("xAI API Key missing in environment variables.");
      setIsXaiConfigured(false);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const seen = localStorage.getItem('mediprep_onboarding_seen');
    if (!seen) {
      setShowOnboarding(true);
      setOnboardingStep(0);
    }
  }, []);

  useEffect(() => {
    if (view === 'remediation' && remediationQuestions.length === 0) {
      setView('practice');
    }
  }, [remediationQuestions.length, view]);

  const closeOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem('mediprep_onboarding_seen', '1');
  };

  const advanceOnboarding = () => {
    if (onboardingStep >= onboardingSteps.length - 1) {
      closeOnboarding();
      return;
    }
    setOnboardingStep((prev) => Math.min(prev + 1, onboardingSteps.length - 1));
  };

  useEffect(() => {
    if (user) {
      flushFeedbackQueue();
    }
  }, [user]);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);
  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = document.body.clientWidth - mouseMoveEvent.clientX;
        if (newWidth > 320 && newWidth < 800) {
          setSidebarWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    if (isChatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isChatOpen]);

  const handleGenerate = async (
    content: string,
    _lectureFiles: StudyFile[],
    _studyGuideFile: StudyFile | null,
    prefs: UserPreferences,
    context?: {
      guideHash: string;
      guideItems: StudyGuideItem[];
      guideTitle: string;
      moduleId: 'heme' | 'pulm';
    }
  ) => {
    if (!isXaiConfigured) {
      setError("xAI API Key is missing. Please add 'VITE_XAI_API_KEY' to your environment variables.");
      return;
    }

    if (!content.trim()) {
      setError("Please select a module before generating questions.");
      return;
    }

    setIsLoading(true);
    setError(null);

    const guideHash = context?.guideHash;
    const guideItems = context?.guideItems;
    const guideTitle = context?.guideTitle;
    const guideModule = context?.moduleId;
    const moduleId = guideHash || 'custom';

    const seenFingerprintSet = await ensureSeenFingerprints(moduleId);

    const histologyInstruction =
      guideModule
        ? 'Include histology/morphology or imaging questions where appropriate. If you reference an image, say "A representative image is provided below.".'
        : '';
    const effectivePrefs: UserPreferences = histologyInstruction
      ? {
          ...prefs,
          customInstructions: [prefs.customInstructions, histologyInstruction].filter(Boolean).join('\n')
        }
      : prefs;

    setLastGuideContext({
      content,
      prefs: effectivePrefs,
      guideHash,
      guideItems,
      guideTitle,
      moduleId: guideModule
    });

    try {
      const workingFingerprints = new Set(seenFingerprintSet);
      const pickFromPool = (pool: Question[], count: number, shouldShuffle: boolean) => {
        const list = shouldShuffle ? shuffleList(pool) : pool;
        const picked: Question[] = [];
        for (const q of list) {
          if (hasSeenFingerprint(q, workingFingerprints)) continue;
          picked.push(q);
          addFingerprintsToSet(q, workingFingerprints);
          if (picked.length >= count) break;
        }
        return picked;
      };

      const takeGold = async (count: number) => {
        if (!guideModule || count <= 0) return [];
        const approvedGold = await getApprovedGoldQuestions(guideModule);
        const picked = pickFromPool(approvedGold, count, true);
        return picked.map((q) => ({
          ...q,
          sourceType: 'gold',
          cardStyle: effectivePrefs.cardStyle || q.cardStyle,
          guideHash
        }));
      };

      const takePrefab = async (count: number) => {
        if (!guideHash || count <= 0) {
          return { picked: [] as Question[], total: 0, remaining: 0, exhausted: false };
        }
        const prefab = await getPrefabSet(guideHash);
        if (!prefab) {
          return { picked: [] as Question[], total: 0, remaining: 0, exhausted: false };
        }
        const active = getActivePrefabQuestions(prefab.questions || []);
        const unseenActive = active.filter((q) => !hasSeenFingerprint(q, workingFingerprints));
        const picked = unseenActive.slice(0, count);
        picked.forEach((q) => addFingerprintsToSet(q, workingFingerprints));
        const remaining = Math.max(0, unseenActive.length - picked.length);
        return {
          picked: picked.map((q) => ({ ...q, sourceType: 'prefab', guideHash })),
          total: active.length,
          remaining,
          exhausted: remaining === 0
        };
      };

      const takeGenerated = async (count: number) => {
        if (count <= 0) return [];
        const generated = await generateQuestions(content, [], null, { ...effectivePrefs, questionCount: count });
        const { unique } = filterDuplicateQuestions(generated, workingFingerprints);
        const selected = unique.slice(0, count);
        selected.forEach((q) => addFingerprintsToSet(q, workingFingerprints));
        return selected.map((q) => ({ ...q, sourceType: 'generated', guideHash }));
      };

      let goldQuestions: Question[] = [];
      let guideQuestions: Question[] = [];
      let sessionVariant: 'gold' | 'guide' | 'mixed' | undefined;
      let prefabMetaNext: typeof prefabMeta = null;
      let prefabExhaustedNext = false;
      let usedFallback = false;

      if (guideModule && guideHash) {
        const primaryVariant = getGuideVariant(guideHash) as 'gold' | 'guide' | 'split';

        if (primaryVariant === 'split') {
          const goldTarget = Math.ceil(effectivePrefs.questionCount / 2);
          const prefabTarget = Math.max(0, effectivePrefs.questionCount - goldTarget);
          goldQuestions = await takeGold(goldTarget);
          const prefabResult = await takePrefab(prefabTarget);
          guideQuestions = prefabResult.picked;
          let remaining = effectivePrefs.questionCount - goldQuestions.length - guideQuestions.length;
          if (remaining > 0 && guideQuestions.length < prefabTarget) {
            const goldFallback = await takeGold(Math.min(remaining, goldTarget - goldQuestions.length));
            if (goldFallback.length > 0) {
              goldQuestions = [...goldQuestions, ...goldFallback];
              remaining = effectivePrefs.questionCount - goldQuestions.length - guideQuestions.length;
            }
          }
          if (remaining > 0 && goldQuestions.length < goldTarget) {
            const prefabFallback = await takePrefab(remaining);
            if (prefabFallback.picked.length > 0) {
              guideQuestions = [...guideQuestions, ...prefabFallback.picked];
              remaining = effectivePrefs.questionCount - goldQuestions.length - guideQuestions.length;
              if (prefabFallback.total > 0) {
                prefabExhaustedNext = prefabFallback.exhausted;
                prefabMetaNext = {
                  mode: 'mixed',
                  guideHash,
                  guideTitle,
                  totalPrefab: prefabFallback.total,
                  remainingPrefab: prefabFallback.remaining
                };
              }
            }
          }
          if (remaining > 0) {
            const generatedFallback = await takeGenerated(remaining);
            if (generatedFallback.length > 0) {
              guideQuestions = [...guideQuestions, ...generatedFallback];
            }
          }
          usedFallback = goldQuestions.length !== goldTarget || guideQuestions.length !== prefabTarget;
          if (prefabResult.total > 0) {
            prefabExhaustedNext = prefabResult.exhausted;
            prefabMetaNext = {
              mode: 'mixed',
              guideHash,
              guideTitle,
              totalPrefab: prefabResult.total,
              remainingPrefab: prefabResult.remaining
            };
          }
          sessionVariant = 'mixed';
        } else if (primaryVariant === 'gold') {
          goldQuestions = await takeGold(effectivePrefs.questionCount);
          let remaining = effectivePrefs.questionCount - goldQuestions.length;
          if (remaining > 0) {
            const prefabResult = await takePrefab(remaining);
            guideQuestions = prefabResult.picked;
            remaining -= guideQuestions.length;
            if (remaining > 0) {
              const generatedFallback = await takeGenerated(remaining);
              if (generatedFallback.length > 0) {
                guideQuestions = [...guideQuestions, ...generatedFallback];
              }
            }
            usedFallback = guideQuestions.length > 0;
            if (prefabResult.total > 0) {
              prefabExhaustedNext = prefabResult.exhausted;
              prefabMetaNext = {
                mode: usedFallback ? 'mixed' : 'prefab',
                guideHash,
                guideTitle,
                totalPrefab: prefabResult.total,
                remainingPrefab: prefabResult.remaining
              };
            }
          }
        } else {
          const prefabResult = await takePrefab(effectivePrefs.questionCount);
          guideQuestions = prefabResult.picked;
          let remaining = effectivePrefs.questionCount - guideQuestions.length;
          if (remaining > 0) {
            const generatedFallback = await takeGenerated(remaining);
            if (generatedFallback.length > 0) {
              guideQuestions = [...guideQuestions, ...generatedFallback];
              usedFallback = true;
            }
            remaining = effectivePrefs.questionCount - guideQuestions.length;
          }
          if (remaining > 0) {
            const goldFallback = await takeGold(remaining);
            if (goldFallback.length > 0) {
              goldQuestions = goldFallback;
              usedFallback = true;
            }
          }
          if (prefabResult.total > 0) {
            prefabExhaustedNext = prefabResult.exhausted;
            prefabMetaNext = {
              mode: usedFallback ? 'mixed' : 'prefab',
              guideHash,
              guideTitle,
              totalPrefab: prefabResult.total,
              remainingPrefab: prefabResult.remaining
            };
          }
          sessionVariant = usedFallback ? 'mixed' : primaryVariant;
        }

        if (!sessionVariant) {
          sessionVariant = usedFallback ? 'mixed' : primaryVariant;
        }
      } else {
        const generated = await generateQuestions(content, [], null, { ...effectivePrefs, questionCount: effectivePrefs.questionCount });
        const { unique } = filterDuplicateQuestions(generated, workingFingerprints);
        guideQuestions = unique.slice(0, effectivePrefs.questionCount).map((q) => ({
          ...q,
          sourceType: 'generated'
        }));
      }

      const combined = shuffleList([...goldQuestions, ...guideQuestions]).map((q) =>
        sessionVariant
          ? {
              ...q,
              abVariant: sessionVariant,
              guideHash
            }
          : q
      ).map(normalizeQuestionShape);
      const withHistology = attachHistologyToQuestions(combined, guideModule || guideTitle || '');
      const normalized = withHistology.map(normalizeQuestionShape);
      setPracticeQuestions(normalized);
      setRemediationQuestions([]);
      setRemediationStates({});
      setPrefabExhausted(prefabExhaustedNext);
      setRemediationMeta(null);
      markQuestionsSeen(moduleId, normalized);
      await markQuestionsSeenByFingerprint(moduleId, normalized);
      setPracticeStates({});
      setPrefabMeta(prefabMetaNext);
      setView('practice');
    } catch (err: any) {
      setError(err.message || "Failed to generate questions.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateHistology = async () => {
    setIsHistologyLoading(true);
    setHistologyError(null);
    try {
      const entries = selectHistologyEntries('heme', 10);
      const vignettes = histologyMode === 'vignette'
        ? await getHistologyVignettes(entries)
        : {};
      const questions = buildHistologyReviewQuestions({
        entries,
        vignettes,
        mode: histologyMode
      });
      setHistologyQuestions(questions);
      setHistologyStates({});
    } catch (err: any) {
      setHistologyError(err?.message || 'Failed to generate histology review.');
    } finally {
      setIsHistologyLoading(false);
    }
  };

  const handleFinishPractice = () => {
    setPracticeQuestions([]);
    setRemediationQuestions([]);
    setPracticeStates({});
    setRemediationStates({});
    setChatHistory([]);
    setChatHistoryByQuestion({});
    setActiveQuestionForChat(null);
    setIsChatOpen(false);
    setPrefabMeta(null);
    setLastGuideContext(null);
    setPrefabExhausted(false);
    setRemediationMeta(null);
    setView('generate');
  };

  const handleGenerateMore = async () => {
    if (!lastGuideContext) return;
    const moduleId = lastGuideContext.guideHash || 'custom';
    const seenFingerprintSet = await ensureSeenFingerprints(moduleId);
    const sessionVariant = practiceQuestions.find((q) => q.abVariant)?.abVariant;
    if (prefabMeta?.mode === 'prefab' && lastGuideContext.guideHash) {
      const cached = await getPrefabSet(lastGuideContext.guideHash);
      const activeQuestions = cached ? getActivePrefabQuestions(cached.questions) : [];
      const unseenQuestions = filterUnseenQuestions(moduleId, activeQuestions);
      if (cached && unseenQuestions.length > 0) {
        const limit = lastGuideContext.prefs.autoQuestionCount
          ? unseenQuestions.length
          : lastGuideContext.prefs.questionCount;
        const nextSlice = unseenQuestions.slice(0, limit).map((q) => ({
          ...q,
          abVariant: sessionVariant,
          guideHash: lastGuideContext.guideHash
        }));
        const normalizedNext = nextSlice.map(normalizeQuestionShape);
        setPracticeQuestions(prev => [...prev, ...normalizedNext]);
        markQuestionsSeen(moduleId, normalizedNext);
        await markQuestionsSeenByFingerprint(moduleId, normalizedNext);
        if (prefabMeta) {
          const remaining = Math.max(0, unseenQuestions.length - nextSlice.length);
          setPrefabMeta({ ...prefabMeta, remainingPrefab: remaining });
        }
        setPrefabExhausted(unseenQuestions.length <= limit);
        return;
      }
      if (cached) {
        setPrefabExhausted(true);
        if (prefabMeta) {
          setPrefabMeta({ ...prefabMeta, remainingPrefab: 0 });
        }
      }
    }
    setIsLoading(true);
    setError(null);
    try {
      const more = await generateQuestions(
        lastGuideContext.content,
        [],
        null,
        lastGuideContext.prefs
      );
      const existingSet = buildFingerprintSet(practiceQuestions);
      const union = new Set<string>([...existingSet, ...seenFingerprintSet]);
      const { unique } = filterDuplicateQuestions(more, union);
      const generatedTagged = unique.map((q) => ({
        ...q,
        sourceType: 'generated',
        abVariant: sessionVariant,
        guideHash: lastGuideContext.guideHash
      }));
      const withHistology = attachHistologyToQuestions(
        generatedTagged.map(normalizeQuestionShape),
        lastGuideContext.moduleId || lastGuideContext.guideTitle || '',
        { existingQuestions: practiceQuestions }
      );
      const normalizedMore = withHistology.map(normalizeQuestionShape);
      setPracticeQuestions(prev => [...prev, ...normalizedMore]);
      markQuestionsSeen(moduleId, normalizedMore);
      await markQuestionsSeenByFingerprint(moduleId, normalizedMore);
      if (prefabMeta) {
        setPrefabMeta({ ...prefabMeta, mode: 'mixed' });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate more questions.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateRemediation = async () => {
    const weakConcepts = practiceSummary.weakConcepts.map(stat => stat.concept);
    if (practiceSummary.totalAnswered === 0 || weakConcepts.length === 0) return;

    setIsLoading(true);
    setError(null);
    try {
      let context = lastGuideContext;
      if (!context) {
        const fallbackGuideHash = practiceQuestions.find((q) => q.guideHash)?.guideHash;
        if (fallbackGuideHash) {
          const cached = await getPrefabSet(fallbackGuideHash);
          if (cached?.items?.length) {
            const reconstructed = cached.items.map((item) => item.content || '').filter(Boolean).join('\n\n');
            context = {
              content: reconstructed,
              prefs: loadBetaPrefs(),
              guideHash: cached.guideHash,
              guideItems: cached.items,
              guideTitle: cached.guideTitle
            };
            setLastGuideContext(context);
          }
        }
      }

      if (!context || !context.content?.trim()) {
        setError('Remediation needs an active practice session. Generate a new set first.');
        return;
      }

      const focusLine = `Remediation focus: ${weakConcepts.join(', ')}. Emphasize these weaknesses with clear teaching points and NBME-style questions.`;
      const updatedPrefs: UserPreferences = {
        ...context.prefs,
        customInstructions: [context.prefs.customInstructions, focusLine].filter(Boolean).join('\n')
      };
      const remediation = await generateQuestions(
        context.content,
        [],
        null,
        updatedPrefs
      );
      const moduleKey = context.guideHash || 'custom';
      const seenFingerprintSet = await ensureSeenFingerprints(moduleKey);
      const existingSet = buildFingerprintSet(practiceQuestions);
      const union = new Set<string>([...existingSet, ...seenFingerprintSet]);
      const { unique } = filterDuplicateQuestions(remediation, union);
      const generatedTagged = unique.map((q) => ({ ...q, sourceType: 'generated' }));
      const withHistology = attachHistologyToQuestions(
        generatedTagged.map(normalizeQuestionShape),
        context.moduleId || context.guideTitle || ''
      );
      const normalizedRemediation = withHistology.map(normalizeQuestionShape);
      setRemediationQuestions(normalizedRemediation);
      setRemediationStates({});
      setRemediationMeta({
        concepts: weakConcepts,
        generatedAt: new Date().toISOString()
      });
      markQuestionsSeen(moduleKey, normalizedRemediation);
      await markQuestionsSeenByFingerprint(moduleKey, normalizedRemediation);
      setView('remediation');
    } catch (err: any) {
      setError(err.message || 'Failed to generate remediation questions.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCurrentQuestion = (id: string) => {
    if (view === 'remediation') {
      setRemediationQuestions(prev => prev.filter(q => q.id !== id));
    } else {
      setPracticeQuestions(prev => prev.filter(q => q.id !== id));
    }
    setChatHistoryByQuestion(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeQuestionForChat?.id === id) {
      setIsChatOpen(false);
      setActiveQuestionForChat(null);
    }
  };

  const openChatForQuestion = (q: Question) => {
    const sessionId = crypto.randomUUID();
    setActiveQuestionForChat(q);
    setChatHistory(chatHistoryByQuestion[q.id] || []);
    setChatInput('');
    setIsChatOpen(true);
    setTutorSessionId(sessionId);
    trackTutorUsage({
      userId: user?.id,
      sessionId,
      questionId: q.id,
      guideHash: q.guideHash || lastGuideContext?.guideHash || null,
      sourceType: q.sourceType || null,
      model: tutorModel,
      location: view === 'remediation' ? 'remediation' : 'practice',
      eventType: 'open'
    });
  };

  const getTutorTargetQuestion = (
    sourceQuestions: Question[],
    sourceStates: Record<string, QuestionState>
  ) => {
    if (sourceQuestions.length === 0) return null;
    const unanswered = sourceQuestions.find((q) => !sourceStates[q.id]?.selectedOption);
    return unanswered || sourceQuestions[0];
  };

  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading || !activeQuestionForChat) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    const nextHistory = [...chatHistory, userMsg];
    setChatHistory(nextHistory);
    setChatHistoryByQuestion(prev => ({
      ...prev,
      [activeQuestionForChat.id]: nextHistory
    }));
    setChatInput('');
    setIsChatLoading(true);

    try {
      trackTutorUsage({
        userId: user?.id,
        sessionId: tutorSessionId,
        questionId: activeQuestionForChat.id,
        guideHash: activeQuestionForChat.guideHash || lastGuideContext?.guideHash || null,
        sourceType: activeQuestionForChat.sourceType || null,
        model: tutorModel,
        location: view === 'remediation' ? 'remediation' : 'practice',
        eventType: 'message_sent'
      });
      const responseText = await chatWithTutor(activeQuestionForChat, chatHistory, userMsg.text, tutorModel);
      const updated = [...nextHistory, { role: 'model', text: responseText }];
      setChatHistory(updated);
      setChatHistoryByQuestion(prev => ({
        ...prev,
        [activeQuestionForChat.id]: updated
      }));
      trackTutorUsage({
        userId: user?.id,
        sessionId: tutorSessionId,
        questionId: activeQuestionForChat.id,
        guideHash: activeQuestionForChat.guideHash || lastGuideContext?.guideHash || null,
        sourceType: activeQuestionForChat.sourceType || null,
        model: tutorModel,
        location: view === 'remediation' ? 'remediation' : 'practice',
        eventType: 'response_received'
      });
    } catch (error) {
      const updated = [...nextHistory, { role: 'model', text: "Sorry, connection error." }];
      setChatHistory(updated);
      setChatHistoryByQuestion(prev => ({
        ...prev,
        [activeQuestionForChat.id]: updated
      }));
      trackTutorUsage({
        userId: user?.id,
        sessionId: tutorSessionId,
        questionId: activeQuestionForChat.id,
        guideHash: activeQuestionForChat.guideHash || lastGuideContext?.guideHash || null,
        sourceType: activeQuestionForChat.sourceType || null,
        model: tutorModel,
        location: view === 'remediation' ? 'remediation' : 'practice',
        eventType: 'error'
      });
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    const onboardingSeen = localStorage.getItem('mediprep_onboarding_seen');
    localStorage.clear();
    if (onboardingSeen) {
      localStorage.setItem('mediprep_onboarding_seen', onboardingSeen);
    }
    window.location.reload();
  };

  const renderMessageContent = (text: string) => {
    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts.map((part, index) => {
      if (part.startsWith('$$') && part.endsWith('$$')) {
        const math = part.slice(2, -2);
        try {
          const html = katex.renderToString(math, { displayMode: true, throwOnError: false });
          return <div key={index} dangerouslySetInnerHTML={{ __html: html }} className="my-2" />;
        } catch (e) {
          return <code key={index} className="block bg-slate-100 p-2 rounded">{math}</code>;
        }
      } else if (part.startsWith('$') && part.endsWith('$')) {
        const math = part.slice(1, -1);
        try {
          const html = katex.renderToString(math, { displayMode: false, throwOnError: false });
          return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch (e) {
          return <code key={index} className="bg-slate-100 px-1 rounded">{math}</code>;
        }
      } else {
        const boldParts = part.split(/(\*\*.*?\*\*)/g);
        return (
          <span key={index}>
            {boldParts.map((subPart, subIdx) => {
              if (subPart.startsWith('**') && subPart.endsWith('**')) {
                return <strong key={subIdx} className="font-bold text-slate-900">{subPart.slice(2, -2)}</strong>;
              }
              return <span key={subIdx}>{subPart}</span>;
            })}
          </span>
        );
      }
    });
  };

  if (emailConfirmState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900 p-6">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-xl text-center">
          <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center ${emailConfirmState.status === 'success' ? 'bg-emerald-50 text-emerald-600' : emailConfirmState.status === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
            {emailConfirmState.status === 'success' ? (
              <CheckIcon className="w-8 h-8" />
            ) : (
              <ExclamationTriangleIcon className="w-8 h-8" />
            )}
          </div>
          <h1 className="mt-5 text-2xl font-black text-slate-800">
            {emailConfirmState.status === 'success' ? "You're verified" : emailConfirmState.status === 'error' ? 'Verification issue' : 'Verifying...'}
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            {emailConfirmState.status === 'success'
              ? 'Welcome to MediPrep Beta. You can now log in and start practicing.'
              : emailConfirmState.message || 'Hang tight while we confirm your email.'}
          </p>
          <button
            onClick={() => {
              window.history.replaceState({}, '', '/');
              setEmailConfirmState(null);
              setIsAuthModalOpen(true);
            }}
            className="mt-6 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800"
          >
            Go to MediPrep
          </button>
        </div>
      </div>
    );
  }

  if (!user && !isAuthModalOpen) {
    return (
      <>
        <div className="h-screen w-full bg-slate-50 flex items-center justify-center">
           <div className="animate-pulse flex flex-col items-center">
              <SparklesIcon className="w-12 h-12 text-teal-500 mb-4" />
              <h1 className="text-xl font-black text-slate-800">MediPrep AI</h1>
           </div>
        </div>
        <AuthModal 
          isOpen={true} 
          onClose={() => {}} 
          onLoginSuccess={() => {}}
        />
      </>
    );
  }

  const canViewAnalytics = isAdmin;

  const isRemediationView = view === 'remediation';
  const isImmersiveView = view === 'practice' || view === 'deepdive' || view === 'remediation' || view === 'histology';
  const activeQuestions = isRemediationView ? remediationQuestions : practiceQuestions;
  const activeStates = isRemediationView ? remediationStates : practiceStates;
  const activeSummary = isRemediationView ? remediationSummary : practiceSummary;
  const setActiveStates = isRemediationView ? setRemediationStates : setPracticeStates;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row overflow-hidden relative selection:bg-teal-100">
      <div className="fixed top-0 left-0 w-full h-96 bg-gradient-to-b from-teal-50/50 to-transparent pointer-events-none z-0" />

      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
        onLoginSuccess={() => {}}
      />

      {showOnboarding && view === 'generate' && !isAuthModalOpen && (
        <div className="fixed inset-0 z-[220] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl p-6">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Getting Started</div>
            <div className="mt-2 text-xl font-black text-slate-900">{onboardingSteps[onboardingStep].title}</div>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{onboardingSteps[onboardingStep].body}</p>
            <div className="mt-4 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-indigo-500 transition-all"
                style={{ width: `${Math.round(((onboardingStep + 1) / onboardingSteps.length) * 100)}%` }}
              />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Step {onboardingStep + 1} of {onboardingSteps.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeOnboarding}
                  className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600"
                >
                  Skip
                </button>
                <button
                  onClick={advanceOnboarding}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
                >
                  {onboardingStep >= onboardingSteps.length - 1 ? 'Start Practicing' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Navigation 
        currentView={view} 
        setView={(v) => { setView(v as ViewMode); setIsChatOpen(false); }} 
        practiceCount={practiceQuestions.length}
        remediationCount={remediationQuestions.length}
        showRemediation={remediationQuestions.length > 0 || Boolean(remediationMeta)}
        user={user}
        showAnalytics={canViewAnalytics}
        onLoginClick={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      <main 
        className={`flex-1 md:ml-24 flex flex-col relative z-10 h-screen transition-all duration-300 ${
          isImmersiveView ? 'p-0' : 'max-w-[1200px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6'
        }`}
      >
        {!isXaiConfigured && !isImmersiveView && (
           <div className="mb-4 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-4">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-rose-600 text-white rounded-xl">
                    <ExclamationTriangleIcon className="w-5 h-5" />
                 </div>
                 <div>
                    <div className="text-xs font-black text-rose-800 uppercase tracking-tight">Deployment Warning</div>
                    <div className="text-[10px] text-rose-600 font-bold uppercase">xAI API Key missing in environment variables.</div>
                 </div>
              </div>
              <a href="https://x.ai/api" target="_blank" className="text-[10px] font-black uppercase text-rose-600 hover:underline">Get Key &rarr;</a>
           </div>
        )}

        {!isImmersiveView && (
          <div className="md:hidden flex items-center justify-between py-4 mb-4 border-b border-slate-200/60 sticky top-0 bg-slate-50/80 backdrop-blur-md z-20">
              <h1 className="text-sm font-black tracking-tighter bg-gradient-to-r from-teal-700 to-teal-500 bg-clip-text text-transparent">
                MEDIPREP AI
              </h1>
              {!user && (
                <button 
                  onClick={() => setIsAuthModalOpen(true)}
                  className="text-xs font-bold text-teal-600 bg-teal-50 px-3 py-1.5 rounded-lg"
                >
                  Log In
                </button>
              )}
          </div>
        )}

        <div className={`flex-1 flex flex-col ${!isImmersiveView ? 'overflow-y-auto no-scrollbar pb-24 md:pb-8' : 'h-full overflow-hidden'}`}>
          {view === 'generate' && (
            <div className="h-full flex flex-col items-center justify-center max-w-4xl mx-auto w-full animate-in fade-in zoom-in-95 duration-300">
              <div className="w-full h-full">
                 <InputSection 
                   onGenerate={handleGenerate} 
                   isLoading={isLoading}
                   mode="questions"
                   onOpenOnboarding={() => {
                     setOnboardingStep(0);
                     setShowOnboarding(true);
                   }}
                 />
              </div>
            </div>
          )}

          {view === 'deepdive' && <DeepDiveView />}
          {view === 'analytics' && (
            <div className="animate-in fade-in duration-300">
              {canViewAnalytics ? (
                <BetaAnalyticsView
                  abDebug={abDebug}
                  prefabMeta={prefabMeta ? {
                    guideHash: prefabMeta.guideHash,
                    guideTitle: prefabMeta.guideTitle,
                    totalPrefab: prefabMeta.totalPrefab,
                    remainingPrefab: prefabMeta.remainingPrefab
                  } : null}
                  prefabExhausted={prefabExhausted}
                  abOverride={abOverride}
                  onOverrideChange={handleOverrideChange}
                  lastGuideHash={lastGuideContext?.guideHash ?? null}
                />
              ) : (
                <div className="max-w-xl mx-auto mt-16 p-8 bg-white border border-slate-200 rounded-2xl text-center shadow-sm">
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Access Restricted</div>
                  <h3 className="text-lg font-black text-slate-800">Analytics is admin-only</h3>
                  <p className="text-sm text-slate-500 mt-2">Ask an admin to enable analytics access for your account.</p>
                </div>
              )}
            </div>
          )}

          {view === 'histology' && (
            <div
              className="h-full flex flex-col transition-all duration-300 ease-out p-6 md:p-10"
            >
              <div className="mb-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1">
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Histology Review</h2>
                  <p className="text-slate-500 text-sm font-medium">
                    Heme morphology drill with image-first vignettes.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl p-1">
                    <button
                      onClick={() => setHistologyMode('vignette')}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors ${
                        histologyMode === 'vignette'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      Vignette
                    </button>
                    <button
                      onClick={() => setHistologyMode('diagnosis')}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors ${
                        histologyMode === 'diagnosis'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      Diagnosis
                    </button>
                  </div>
                  <button
                    onClick={handleGenerateHistology}
                    disabled={isHistologyLoading}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {isHistologyLoading ? 'Generating…' : 'Generate 10'}
                  </button>
                </div>
              </div>

              {histologyError && (
                <div className="mb-4 p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-semibold">
                  {histologyError}
                </div>
              )}

              {histologyQuestions.length > 0 && (
                <div className="mb-6 p-4 rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Session Progress</div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-600 font-semibold">
                    <div>
                      Completed:{' '}
                      <span className="text-slate-900">
                        {histologySummary.totalAnswered}/{histologyQuestions.length}
                      </span>
                    </div>
                    {histologySummary.totalAnswered > 0 && (
                      <div className="text-slate-400">
                        {Math.round(histologySummary.overallAccuracy * 100)}% accuracy
                      </div>
                    )}
                  </div>
                  <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-teal-500 to-indigo-500"
                      style={{
                        width: `${histologyQuestions.length > 0
                          ? Math.min(100, Math.round((histologySummary.totalAnswered / Math.max(histologyQuestions.length, 1)) * 100))
                          : 0}%`
                      }}
                    />
                  </div>
                </div>
              )}

              {histologyQuestions.length > 0 ? (
                <div className="flex-1 overflow-y-auto space-y-8 pb-32 pr-2 custom-scrollbar">
                  {histologyQuestions.map((q, idx) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      index={idx}
                      userId={user?.id}
                      savedState={histologyStates[q.id]}
                      onStateChange={(s) => setHistologyStates((prev) => ({ ...prev, [q.id]: s }))}
                      defaultShowHistology
                      variant="flashcard"
                      revealLabel="Flip Card"
                    />
                  ))}
                </div>
              ) : !isHistologyLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center bg-white border border-slate-200 rounded-3xl p-10 text-center shadow-sm">
                  <div className="text-xs font-black uppercase tracking-widest text-indigo-500 mb-2">Heme only</div>
                  <h3 className="text-xl font-black text-slate-800 mb-3">Ready to drill morphology?</h3>
                  <p className="text-sm text-slate-500 mb-6 max-w-sm">
                    Generate a 10‑question set focused on high‑yield heme histology.
                  </p>
                  <button
                    onClick={handleGenerateHistology}
                    className="px-6 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                  >
                    Generate histology set
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
                  Generating histology set…
                </div>
              )}
            </div>
          )}
          
          {(view === 'practice' || view === 'remediation') && (
            <div 
              className="h-full flex flex-col transition-all duration-300 ease-out p-6 md:p-10"
              style={{ 
                marginRight: isChatOpen && window.innerWidth >= 1024 ? sidebarWidth : 0 
              }}
            >
               <div className="mb-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">
                      {isRemediationView ? 'Remediation Session' : 'Practice Session'}
                    </h2>
                    <p className="text-slate-500 text-sm font-medium">
                      {isRemediationView
                        ? 'Targeted questions based on your weak concepts.'
                        : 'Questions generated from the selected module.'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 w-full lg:w-auto lg:self-start">
                    {isRemediationView && (
                      <button
                        onClick={() => setView('practice')}
                        className="px-3 py-2 rounded-full border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 hover:border-indigo-200"
                      >
                        Back to Practice
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSessionToolsOpen((prev) => !prev)}
                      className="w-full lg:w-auto inline-flex items-center gap-3 px-4 py-2 rounded-full border border-slate-200 bg-white shadow-sm text-[11px] font-bold text-slate-600 hover:border-indigo-200 hover:shadow-md transition-all"
                    >
                      <span className="text-[10px] uppercase tracking-widest text-slate-400">Session Tools</span>
                      {activeSummary.totalAnswered > 0 && (
                        <>
                          <span className="text-slate-900 font-black">{Math.round(activeSummary.overallAccuracy * 100)}%</span>
                          <span className="text-slate-400">
                            {activeSummary.totalCorrect}/{activeSummary.totalAnswered}
                          </span>
                        </>
                      )}
                      <span className="text-[10px] text-indigo-600 font-black uppercase tracking-widest">
                        {sessionToolsOpen ? 'Hide' : 'Show'}
                      </span>
                    </button>
                  </div>
               </div>

               {sessionToolsOpen && activeQuestions.length > 0 && (
                 <div className="mb-6 p-4 rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
                   <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                     <div className="flex-1">
                       <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Practice Tracker</div>
                       <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-600 font-semibold">
                         <div>
                           Completed:{' '}
                           <span className="text-slate-900">
                             {activeSummary.totalAnswered}/{activeQuestions.length}
                           </span>
                         </div>
                         <div className="text-slate-400">
                           {activeQuestions.length > 0
                             ? `${Math.round((activeSummary.totalAnswered / Math.max(activeQuestions.length, 1)) * 100)}%`
                             : '0%'}
                         </div>
                       </div>
                       <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                         <div
                           className="h-full bg-gradient-to-r from-teal-500 to-indigo-500"
                           style={{
                             width: `${activeQuestions.length > 0
                               ? Math.min(100, Math.round((activeSummary.totalAnswered / Math.max(activeQuestions.length, 1)) * 100))
                               : 0}%`
                           }}
                         />
                       </div>
                       <div className="mt-2 text-[11px] text-slate-500 font-semibold">
                         Keep going — every question sharpens your pattern recognition.
                       </div>
                     </div>
                     <div className="w-full lg:w-[320px]">
                       <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">AI Tutor</div>
                       <div className="mt-1 text-sm font-semibold text-slate-700">
                         Socratic tutor with full question context.
                       </div>
                       <div className="mt-1 text-[11px] text-slate-500">
                         Ask for hints, next steps, or a deeper explanation.
                       </div>
                         <button
                           onClick={() => {
                             const target = getTutorTargetQuestion(activeQuestions, activeStates);
                             if (target) openChatForQuestion(target);
                           }}
                           className="mt-3 w-full px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-indigo-700"
                         >
                         Open Socratic Tutor
                       </button>
                     </div>
                   </div>
                 </div>
               )}

               {sessionToolsOpen && isRemediationView && remediationMeta && (
                 <div className="mb-6 p-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 text-indigo-800 shadow-sm">
                   <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Remediation Mode</div>
                   <div className="text-sm font-semibold mt-1">
                     Focused on: {remediationMeta.concepts.join(', ')}
                   </div>
                 </div>
               )}

               {sessionToolsOpen && activeSummary.totalAnswered > 0 && <div className="mb-2" />}

               {!isRemediationView && prefabExhausted && (
                 <div className="mb-6 p-4 rounded-2xl border border-amber-200 bg-amber-50/80 text-amber-800 shadow-sm">
                   <div className="text-[10px] font-black uppercase tracking-widest text-amber-600">Prefab Pool Exhausted</div>
                   <div className="text-sm font-semibold mt-1">
                     You’re at the end of the prefab pool for this module.
                   </div>
                   <div className="mt-3">
                     <button
                       onClick={handleGenerateMore}
                       className="px-3 py-2 rounded-lg bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest"
                     >
                       Generate more (uses credits)
                     </button>
                   </div>
                 </div>
               )}
               
               {activeQuestions.length > 0 ? (
                 <div className="flex-1 overflow-y-auto space-y-8 pb-32 pr-2 custom-scrollbar">
                   {activeQuestions.map((q, idx) => (
                     <QuestionCard 
                       key={q.id} 
                       question={q} 
                       index={idx} 
                       userId={user?.id}
                       onChat={openChatForQuestion} 
                       onDelete={handleDeleteCurrentQuestion}
                       savedState={activeStates[q.id]}
                       onStateChange={(s) => setActiveStates(prev => ({...prev, [q.id]: s}))}
                     />
                   ))}
                   
                   <div className="flex flex-col items-center justify-center p-8 bg-slate-100 rounded-[2rem] border border-slate-200 mt-12 mb-8">
                      <div className="w-16 h-16 bg-slate-900 text-white rounded-full flex items-center justify-center mb-4 shadow-lg">
                         <CheckIcon className="w-8 h-8" />
                      </div>
                      <h3 className="text-xl font-black text-slate-800 mb-2">
                        {isRemediationView ? 'Remediation Complete' : 'Session Complete'}
                      </h3>
                      <p className="text-slate-500 text-sm mb-6 max-w-sm text-center">
                        {isRemediationView
                          ? 'Nice work — switch back to Practice or start a new module.'
                          : 'Ready for another set? Choose another module or tweak your focus.'}
                      </p>
                      {!isRemediationView && prefabMeta?.mode === 'prefab' && lastGuideContext && (
                        <button
                          onClick={handleGenerateMore}
                          className="px-6 py-3 rounded-xl font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors flex items-center gap-2 mb-4"
                        >
                          Generate more (uses credits)
                        </button>
                      )}
                      {isRemediationView && (
                        <button
                          onClick={() => setView('practice')}
                          className="px-6 py-3 rounded-xl font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors flex items-center gap-2 mb-4"
                        >
                          Return to Practice
                        </button>
                      )}
                      <button 
                        onClick={handleFinishPractice}
                        className="px-6 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors flex items-center gap-2"
                      >
                        <ArrowRightOnRectangleIcon className="w-5 h-5" /> Return to Selection
                      </button>
                   </div>
                 </div>
               ) : prefabMeta && prefabExhausted ? (
                 <div className="flex-1 flex flex-col items-center justify-center bg-white border border-slate-200 rounded-3xl p-10 text-center shadow-sm">
                   <div className="text-xs font-black uppercase tracking-widest text-amber-500 mb-2">Prefab Pool Exhausted</div>
                   <h3 className="text-xl font-black text-slate-800 mb-3">You’ve completed all prefab questions</h3>
                   <p className="text-sm text-slate-500 mb-6 max-w-sm">
                     Generate more questions to keep practicing (uses credits).
                   </p>
                   <div className="flex flex-wrap gap-3 justify-center">
                     <button
                       onClick={handleGenerateMore}
                       className="px-6 py-3 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors"
                     >
                       Generate more (uses credits)
                     </button>
                     <button
                       onClick={handleFinishPractice}
                       className="px-6 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                     >
                       Return to Selection
                     </button>
                   </div>
                 </div>
               ) : (
                 <EmptyState onViewChange={(newView) => setView(newView as ViewMode)} />
               )}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center animate-in fade-in">
             <div className="w-20 h-20 relative">
               <div className="absolute inset-0 border-4 border-slate-200 rounded-full"></div>
               <div className="absolute inset-0 border-4 border-teal-500 rounded-full border-t-transparent animate-spin"></div>
             </div>
             <h3 className="text-xl font-bold text-slate-800 mt-6 animate-pulse uppercase tracking-widest">Analysing...</h3>
          </div>
        )}
        {error && (
           <div className="fixed top-10 right-1/2 translate-x-1/2 md:translate-x-0 md:right-10 max-w-sm bg-white border border-red-100 p-4 rounded-2xl shadow-xl shadow-red-500/10 z-[101] flex items-start gap-3 animate-in slide-in-from-right-8">
             <div className="bg-red-50 p-2 rounded-full text-red-500 shrink-0">
                <XMarkIcon className="w-5 h-5" />
             </div>
             <div>
               <p className="text-red-700 text-sm font-bold">Error</p>
               <p className="text-slate-500 text-xs mt-1">{error}</p>
               <button onClick={() => setError(null)} className="text-xs text-red-500 mt-2 font-bold hover:underline">Dismiss</button>
             </div>
           </div>
        )}

        <div 
          ref={sidebarRef}
          className={`fixed inset-y-0 right-0 bg-white/95 backdrop-blur-xl shadow-2xl transform transition-transform duration-300 ease-out z-[102] flex flex-col border-l border-slate-200 ${isChatOpen && (view === 'practice' || view === 'remediation') ? 'translate-x-0' : 'translate-x-full'}`}
          style={{ width: sidebarWidth }}
        >
          <div 
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-teal-500/50 transition-colors z-50"
            onMouseDown={startResizing}
          />
          <div className="p-5 border-b border-slate-100 bg-white/50">
            <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-teal-100 text-teal-600 rounded-lg">
                    <ChatBubbleLeftRightIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Socratic Tutor</h3>
                  </div>
               </div>
               <button onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <XMarkIcon className="w-5 h-5" />
               </button>
            </div>
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button onClick={() => setTutorModel('flash')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tutorModel === 'flash' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>Quick</button>
              <button onClick={() => setTutorModel('pro')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tutorModel === 'pro' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>Deep</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[90%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user' ? 'bg-teal-600 text-white rounded-br-sm' : 'bg-white text-slate-700 border border-slate-200 rounded-bl-sm'
                }`}>
                  {renderMessageContent(msg.text)}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                 <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-sm flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" />
                   <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                   <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                 </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={handleSendChatMessage} className="p-4 bg-white border-t border-slate-100 flex gap-3 shrink-0 items-center">
            <input 
              type="text" 
              value={chatInput} 
              onChange={(e) => setChatInput(e.target.value)} 
              placeholder="Ask a follow-up..."
              className="flex-1 px-4 py-3.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-teal-500 transition-all bg-slate-50" 
            />
            <button 
              type="submit" 
              className="bg-teal-600 text-white p-3.5 rounded-xl hover:bg-teal-700 active:scale-90 transition-transform"
            >
              <PaperAirplaneIcon className="w-5 h-5" />
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default App;
