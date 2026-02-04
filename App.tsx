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
import { Question, UserPreferences, StudyFile, ChatMessage, QuestionState, StudyGuideItem } from './types';
import { buildFingerprintSet, buildQuestionFingerprint, filterDuplicateQuestions } from './utils/questionDedupe';
import { attachHistologyToQuestions } from './utils/histology';
import { SparklesIcon, XMarkIcon, ChatBubbleLeftRightIcon, PaperAirplaneIcon, ExclamationTriangleIcon, CheckIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/solid';
import katex from 'katex';
import { supabase } from './services/supabaseClient';
import { fetchSeenFingerprints, recordSeenQuestions } from './services/seenQuestionsService';

type ViewMode = 'generate' | 'practice' | 'deepdive' | 'analytics';

const App: React.FC = () => {
  const allowedViews = new Set<ViewMode>(['generate', 'practice', 'deepdive', 'analytics']);

  const shuffleList = <T,>(items: T[]) => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('mediprep_current_view') as ViewMode | null;
    return saved && allowedViews.has(saved) ? saved : 'generate';
  });

  const [questions, setQuestions] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem('mediprep_active_questions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Failed to restore questions from storage", e);
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
  } | null>(null);
  const [prefabExhausted, setPrefabExhausted] = useState(false);
  const [remediationMeta, setRemediationMeta] = useState<{
    concepts: string[];
    generatedAt: string;
  } | null>(null);
  const [lastGuideContext, setLastGuideContext] = useState<{
    content: string;
    prefs: UserPreferences;
    guideHash?: string;
    guideItems?: StudyGuideItem[];
    guideTitle?: string;
    moduleId?: 'heme' | 'pulm';
  } | null>(null);

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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const seenFingerprintCache = useRef<Map<string, Set<string>>>(new Map());

  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

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
        const fingerprint = buildQuestionFingerprint(q);
        if (set.has(fingerprint)) return;
        set.add(fingerprint);
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
    localStorage.setItem('mediprep_active_questions', JSON.stringify(questions));
  }, [questions]);

  useEffect(() => {
    localStorage.setItem('mediprep_practice_states', JSON.stringify(practiceStates));
  }, [practiceStates]);

  useEffect(() => {
    localStorage.setItem('mediprep_chat_history_by_question', JSON.stringify(chatHistoryByQuestion));
  }, [chatHistoryByQuestion]);

  useEffect(() => {
    setChatHistoryByQuestion(prev => {
      if (questions.length === 0) {
        return Object.keys(prev).length > 0 ? {} : prev;
      }

      const activeIds = new Set(questions.map(q => q.id));
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
  }, [questions]);

  const performanceSummary = React.useMemo(() => {
    const stats = new Map<string, { attempts: number; correct: number }>();
    let totalAnswered = 0;
    let totalCorrect = 0;

    questions.forEach((question) => {
      const state = practiceStates[question.id];
      if (!state?.selectedOption) return;
      totalAnswered += 1;
      const isCorrect = state.selectedOption === question.correctAnswer;
      if (isCorrect) totalCorrect += 1;
      const concepts = question.studyConcepts?.length ? question.studyConcepts : ['General'];
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
  }, [questions, practiceStates]);

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
    const filterByFingerprint = (list: Question[]) =>
      list.filter((q) => !seenFingerprintSet.has(buildQuestionFingerprint(q)));

    const histologyInstruction =
      guideModule ? 'Include histology/morphology questions where appropriate. If you reference an image, say "A representative histology image is provided below.".' : '';
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
      let goldQuestions: Question[] = [];
      let generatedCount = effectivePrefs.questionCount;

      if (guideModule) {
        try {
          const approvedGold = await getApprovedGoldQuestions(guideModule);
          const unseenGold = filterByFingerprint(approvedGold);
          const targetGold = Math.min(Math.round(effectivePrefs.questionCount / 2), unseenGold.length);
          goldQuestions = shuffleList(unseenGold)
            .slice(0, targetGold)
            .map((q) => ({
              ...q,
              sourceType: 'gold',
              cardStyle: effectivePrefs.cardStyle || q.cardStyle
            }));
          generatedCount = Math.max(effectivePrefs.questionCount - goldQuestions.length, 0);
        } catch {
          goldQuestions = [];
          generatedCount = effectivePrefs.questionCount;
        }
      }

      const generatedQuestions =
        generatedCount > 0
          ? await generateQuestions(content, [], null, { ...effectivePrefs, questionCount: generatedCount })
          : [];
      const goldFingerprints = buildFingerprintSet(goldQuestions);
      const unionFingerprints = new Set<string>([...goldFingerprints, ...seenFingerprintSet]);
      const { unique } = filterDuplicateQuestions(generatedQuestions, unionFingerprints);
      const combined = shuffleList([
        ...goldQuestions,
        ...unique.map((q) => ({ ...q, sourceType: 'generated' }))
      ]);
      const withHistology = attachHistologyToQuestions(combined, guideModule || guideTitle || '');
      setQuestions(withHistology);
      setPrefabExhausted(false);
      setRemediationMeta(null);
      markQuestionsSeen(moduleId, withHistology);
      await markQuestionsSeenByFingerprint(moduleId, withHistology);
      setPracticeStates({});
      setPrefabMeta(null);
      setView('practice');
    } catch (err: any) {
      setError(err.message || "Failed to generate questions.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinishPractice = () => {
    setQuestions([]);
    setPracticeStates({});
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
    if (prefabMeta?.mode === 'prefab' && lastGuideContext.guideHash) {
      const cached = await getPrefabSet(lastGuideContext.guideHash);
      const activeQuestions = cached ? getActivePrefabQuestions(cached.questions) : [];
      const unseenQuestions = filterUnseenQuestions(moduleId, activeQuestions);
      if (cached && unseenQuestions.length > 0) {
        const limit = lastGuideContext.prefs.autoQuestionCount
          ? unseenQuestions.length
          : lastGuideContext.prefs.questionCount;
        const nextSlice = unseenQuestions.slice(0, limit);
        setQuestions(prev => [...prev, ...nextSlice]);
        markQuestionsSeen(moduleId, nextSlice);
        setPrefabExhausted(unseenQuestions.length <= limit);
        return;
      }
      if (cached) {
        setPrefabExhausted(true);
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
      const existingSet = buildFingerprintSet(questions);
      const union = new Set<string>([...existingSet, ...seenFingerprintSet]);
      const { unique } = filterDuplicateQuestions(more, union);
      const generatedTagged = unique.map((q) => ({ ...q, sourceType: 'generated' }));
      const withHistology = attachHistologyToQuestions(
        generatedTagged,
        lastGuideContext.moduleId || lastGuideContext.guideTitle || '',
        { existingQuestions: questions }
      );
      setQuestions(prev => [...prev, ...withHistology]);
      markQuestionsSeen(moduleId, withHistology);
      await markQuestionsSeenByFingerprint(moduleId, withHistology);
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
    if (!lastGuideContext) return;
    const weakConcepts = performanceSummary.weakConcepts.map(stat => stat.concept);
    if (weakConcepts.length === 0) return;

    setIsLoading(true);
    setError(null);
    try {
      const focusLine = `Remediation focus: ${weakConcepts.join(', ')}. Emphasize these weaknesses with clear teaching points and NBME-style questions.`;
      const updatedPrefs: UserPreferences = {
        ...lastGuideContext.prefs,
        customInstructions: [lastGuideContext.prefs.customInstructions, focusLine].filter(Boolean).join('\n')
      };
      const remediation = await generateQuestions(
        lastGuideContext.content,
        [],
        null,
        updatedPrefs
      );
      const seenFingerprintSet = await ensureSeenFingerprints(lastGuideContext.guideHash || 'custom');
      const existingSet = buildFingerprintSet(questions);
      const union = new Set<string>([...existingSet, ...seenFingerprintSet]);
      const { unique } = filterDuplicateQuestions(remediation, union);
      const generatedTagged = unique.map((q) => ({ ...q, sourceType: 'generated' }));
      const withHistology = attachHistologyToQuestions(
        generatedTagged,
        lastGuideContext.moduleId || lastGuideContext.guideTitle || ''
      );
      setQuestions(withHistology);
      setPracticeStates({});
      setPrefabMeta(null);
      setPrefabExhausted(false);
      setRemediationMeta({
        concepts: weakConcepts,
        generatedAt: new Date().toISOString()
      });
      markQuestionsSeen(lastGuideContext.guideHash || 'custom', withHistology);
      await markQuestionsSeenByFingerprint(lastGuideContext.guideHash || 'custom', withHistology);
      setView('practice');
    } catch (err: any) {
      setError(err.message || 'Failed to generate remediation questions.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCurrentQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
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
    setActiveQuestionForChat(q);
    setChatHistory(chatHistoryByQuestion[q.id] || []);
    setChatInput('');
    setIsChatOpen(true);
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
      const responseText = await chatWithTutor(activeQuestionForChat, chatHistory, userMsg.text, tutorModel);
      const updated = [...nextHistory, { role: 'model', text: responseText }];
      setChatHistory(updated);
      setChatHistoryByQuestion(prev => ({
        ...prev,
        [activeQuestionForChat.id]: updated
      }));
    } catch (error) {
      const updated = [...nextHistory, { role: 'model', text: "Sorry, connection error." }];
      setChatHistory(updated);
      setChatHistoryByQuestion(prev => ({
        ...prev,
        [activeQuestionForChat.id]: updated
      }));
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
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
  const canViewAnalytics = isAdmin;

  const isImmersiveView = view === 'practice' || view === 'deepdive';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row overflow-hidden relative selection:bg-teal-100">
      <div className="fixed top-0 left-0 w-full h-96 bg-gradient-to-b from-teal-50/50 to-transparent pointer-events-none z-0" />

      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
        onLoginSuccess={() => {}}
      />

      <Navigation 
        currentView={view} 
        setView={(v) => { setView(v as ViewMode); setIsChatOpen(false); }} 
        activeQuestionCount={questions.length}
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
                 />
              </div>
            </div>
          )}

          {view === 'deepdive' && <DeepDiveView />}
          {view === 'analytics' && (
            <div className="animate-in fade-in duration-300">
              {canViewAnalytics ? (
                <BetaAnalyticsView />
              ) : (
                <div className="max-w-xl mx-auto mt-16 p-8 bg-white border border-slate-200 rounded-2xl text-center shadow-sm">
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Access Restricted</div>
                  <h3 className="text-lg font-black text-slate-800">Analytics is admin-only</h3>
                  <p className="text-sm text-slate-500 mt-2">Ask an admin to enable analytics access for your account.</p>
                </div>
              )}
            </div>
          )}
          
          {view === 'practice' && (
            <div 
              className="h-full flex flex-col transition-all duration-300 ease-out p-6 md:p-10"
              style={{ 
                marginRight: isChatOpen && window.innerWidth >= 1024 ? sidebarWidth : 0 
              }}
            >
               <div className="mb-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Practice Session</h2>
                    <p className="text-slate-500 text-sm font-medium">Questions generated from the selected module.</p>
                  </div>
                  {performanceSummary.totalAnswered > 0 && (
                    <div className="group w-full lg:w-auto lg:self-start flex flex-col items-end">
                      <button
                        type="button"
                        tabIndex={0}
                        className="w-full lg:w-auto inline-flex items-center gap-3 px-4 py-2 rounded-full border border-slate-200 bg-white shadow-sm text-[11px] font-bold text-slate-600 hover:border-indigo-200 hover:shadow-md transition-all"
                      >
                        <span className="text-[10px] uppercase tracking-widest text-slate-400">Performance</span>
                        <span className="text-slate-900 font-black">{Math.round(performanceSummary.overallAccuracy * 100)}%</span>
                        <span className="text-slate-400">
                          {performanceSummary.totalCorrect}/{performanceSummary.totalAnswered}
                        </span>
                        <span className="text-[10px] text-indigo-600 font-black uppercase tracking-widest">Hover</span>
                      </button>

                      <div className="w-full lg:w-[340px] mt-0 group-hover:mt-3 group-focus-within:mt-3 max-h-0 opacity-0 pointer-events-none overflow-hidden transition-all duration-200 group-hover:max-h-[480px] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:max-h-[480px] group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl p-4">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Performance Snapshot</div>
                          <div className="mt-1 text-2xl font-black text-slate-800">
                            {Math.round(performanceSummary.overallAccuracy * 100)}%
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {performanceSummary.totalCorrect} correct out of {performanceSummary.totalAnswered} answered
                          </div>
                          <div className="mt-2">
                            <button
                              onClick={handleGenerateRemediation}
                              disabled={isLoading || performanceSummary.weakConcepts.length === 0}
                              className="w-full px-2 py-2 rounded-xl bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest disabled:opacity-50"
                            >
                              Generate remediation
                            </button>
                          </div>
                          <div className="mt-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Needs Review</div>
                            {performanceSummary.weakConcepts.length === 0 ? (
                              <div className="text-[11px] text-slate-500">Keep going to unlock targeted remediation.</div>
                            ) : (
                              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1 custom-scrollbar">
                                {performanceSummary.weakConcepts.map((concept) => (
                                  <div key={concept.concept} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                                    <div className="text-[11px] font-semibold text-slate-700">{concept.concept}</div>
                                    <div className="text-[10px] text-slate-500">
                                      {Math.round(concept.accuracy * 100)}% • {concept.correct}/{concept.attempts}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
               </div>

               {remediationMeta && (
                 <div className="mb-6 p-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 text-indigo-800 shadow-sm">
                   <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Remediation Mode</div>
                   <div className="text-sm font-semibold mt-1">
                     Focused on: {remediationMeta.concepts.join(', ')}
                   </div>
                 </div>
               )}

               {performanceSummary.totalAnswered > 0 && <div className="mb-2" />}

               {prefabExhausted && (
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
               
               {questions.length > 0 ? (
                 <div className="flex-1 overflow-y-auto space-y-8 pb-32 pr-2 custom-scrollbar">
                   {questions.map((q, idx) => (
                     <QuestionCard 
                       key={q.id} 
                       question={q} 
                       index={idx} 
                       userId={user?.id}
                       onChat={openChatForQuestion} 
                       onDelete={handleDeleteCurrentQuestion}
                       savedState={practiceStates[q.id]}
                       onStateChange={(s) => setPracticeStates(prev => ({...prev, [q.id]: s}))}
                     />
                   ))}
                   
                   <div className="flex flex-col items-center justify-center p-8 bg-slate-100 rounded-[2rem] border border-slate-200 mt-12 mb-8">
                      <div className="w-16 h-16 bg-slate-900 text-white rounded-full flex items-center justify-center mb-4 shadow-lg">
                         <CheckIcon className="w-8 h-8" />
                      </div>
                      <h3 className="text-xl font-black text-slate-800 mb-2">Session Complete</h3>
                      <p className="text-slate-500 text-sm mb-6 max-w-sm text-center">Ready for another set? Choose another module or tweak your focus.</p>
                      {prefabMeta?.mode === 'prefab' && lastGuideContext && (
                        <button
                          onClick={handleGenerateMore}
                          className="px-6 py-3 rounded-xl font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors flex items-center gap-2 mb-4"
                        >
                          Generate more (uses credits)
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
          className={`fixed inset-y-0 right-0 bg-white/95 backdrop-blur-xl shadow-2xl transform transition-transform duration-300 ease-out z-[102] flex flex-col border-l border-slate-200 ${isChatOpen && view === 'practice' ? 'translate-x-0' : 'translate-x-full'}`}
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
