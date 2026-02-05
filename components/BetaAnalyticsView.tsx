import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getPrefabSet, listPrefabSets, seedPrefabSet, replacePrefabQuestion, restorePrefabQuestion, getActivePrefabQuestions } from '../services/prefabService';
import { deepDivePrefabTopics } from '../utils/deepDivePrefabs';
import { getDeepDivePrefab, seedDeepDivePrefab, appendDeepDivePrefab } from '../services/deepDivePrefabService';
import { startDeepDive, extendDeepDiveQuiz } from '../services/geminiService';
import { buildStudyGuideItems } from '../utils/studyGuide';
import { CardStyle, DifficultyLevel, ExamFormat, GoldQuestionRow, Question, QuestionType, StudyGuideItem, UserPreferences } from '../types';
import { listGoldQuestions, createGoldQuestion, updateGoldQuestion, approveGoldQuestion, revokeGoldApproval, deleteGoldQuestion } from '../services/goldQuestionService';
import { fetchTutorUsageSummary, TutorUsageSummary } from '../services/tutorUsageService';
import { ArrowDownTrayIcon, ArrowPathIcon, ChartBarIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/solid';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';

type FeedbackRow = {
  id: string;
  user_id: string;
  question_id: string;
  kind: 'rating' | 'bug';
  rating: number | null;
  tags: string[] | null;
  comment: string | null;
  selected_option: string | null;
  is_correct: boolean | null;
  time_spent_ms: number | null;
  payload: any;
  created_at: string;
};

type TimeRange = '7d' | '30d' | 'all';

type SeederStatus = 'parsing' | 'cached' | 'missing' | 'seeding' | 'done' | 'error';

type SeederGuide = {
  id: string;
  fileName: string;
  guideTitle: string;
  guideHash: string;
  items: StudyGuideItem[];
  targetTotal: number;
  questionCount: number;
  status: SeederStatus;
  error?: string;
};

type PrefabSummary = {
  guideHash: string;
  guideTitle: string;
  createdAt: string;
  itemCount: number;
};

type DeepDiveSeedStatus = 'cached' | 'missing' | 'seeding' | 'done' | 'error';

type DeepDiveSeedRow = {
  id: string;
  concept: string;
  source: 'Hematology' | 'Pulmonology';
  targetCount: number;
  seededCount: number;
  status: DeepDiveSeedStatus;
  error?: string;
};

type DeepDivePrefabDetail = {
  topicKey: string;
  topicContext: string;
  concept: string;
  lessonContent: string;
  quiz: Question[];
  createdAt?: string;
  model?: string;
};

type AbDebugData = {
  variant: string | null;
  guideHash: string | null;
  guideTitle: string | null;
  counts: {
    gold: number;
    prefab: number;
    generated: number;
    other: number;
  };
};

type AbOverrideOption = 'auto' | 'gold' | 'guide' | 'split';

type AbDebugProps = {
  abDebug?: AbDebugData | null;
  prefabMeta?: {
    guideHash: string;
    guideTitle?: string;
    totalPrefab: number;
    remainingPrefab?: number;
  } | null;
  prefabExhausted?: boolean;
  abOverride?: AbOverrideOption;
  onOverrideChange?: (value: AbOverrideOption) => void;
  lastGuideHash?: string | null;
};

const timeRanges: { id: TimeRange; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' }
];

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const formatMs = (value: number | null) => {
  if (!value || value <= 0) return '—';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  return `${mins}m`;
};

const maskId = (id?: string) => {
  if (!id) return 'unknown';
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
};

const isAppBug = (tags: string[] | null) => (tags || []).includes('App bug');
const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const formatDateForFile = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const formatCurrency = (value: number) => {
  if (!Number.isFinite(value)) return '$0.00';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
};

const escapeCsvValue = (value: unknown) => {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
};

const csvHeaders = [
  'created_at',
  'kind',
  'rating',
  'tags',
  'comment',
  'selected_option',
  'is_correct',
  'time_spent_ms',
  'question_id',
  'user_id',
  'question_text_excerpt'
];

const DEFAULT_TARGET_TOTAL = 35;
const DEFAULT_DEEP_DIVE_COUNT = 5;

const removalReasons = [
  'Too hard',
  'Too easy',
  'Not related to study guide',
  'Ambiguous',
  'Incorrect',
  'Poor explanation',
  'Formatting/typo',
  'Duplicate',
  'Other'
];

const SEED_PREFS: UserPreferences = {
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

const statusStyles: Record<SeederStatus, string> = {
  parsing: 'bg-slate-100 text-slate-500',
  cached: 'bg-emerald-50 text-emerald-700',
  missing: 'bg-amber-50 text-amber-700',
  seeding: 'bg-indigo-50 text-indigo-700',
  done: 'bg-emerald-50 text-emerald-700',
  error: 'bg-rose-50 text-rose-700'
};

const statusLabel: Record<SeederStatus, string> = {
  parsing: 'Parsing',
  cached: 'Cached',
  missing: 'Missing',
  seeding: 'Seeding',
  done: 'Done',
  error: 'Error'
};

const deepDiveStatusStyles: Record<DeepDiveSeedStatus, string> = {
  cached: 'bg-emerald-50 text-emerald-700',
  missing: 'bg-amber-50 text-amber-700',
  seeding: 'bg-indigo-50 text-indigo-700',
  done: 'bg-emerald-50 text-emerald-700',
  error: 'bg-rose-50 text-rose-700'
};

const deepDiveStatusLabel: Record<DeepDiveSeedStatus, string> = {
  cached: 'Cached',
  missing: 'Missing',
  seeding: 'Seeding',
  done: 'Done',
  error: 'Error'
};

const extractPdfText = async (file: File, maxChars: number = 120000) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  let fullText = '';
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    fullText += pageText + '\n';
    if (fullText.length >= maxChars) {
      fullText = fullText.slice(0, maxChars);
      break;
    }
  }

  return fullText.trim();
};

const BetaAnalyticsView: React.FC<AbDebugProps> = ({
  abDebug,
  prefabMeta,
  prefabExhausted,
  abOverride = 'auto',
  onOverrideChange,
  lastGuideHash
}) => {
  const debugCounts = abDebug?.counts ?? { gold: 0, prefab: 0, generated: 0, other: 0 };
  const debugGuideTitle = abDebug?.guideTitle ?? 'n/a';
  const debugGuideHash = abDebug?.guideHash ?? null;
  const showDebugPanel = Boolean(abDebug || prefabMeta || onOverrideChange);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>('7d');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [seedGuides, setSeedGuides] = useState<SeederGuide[]>([]);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);
  const [isSeedQueueRunning, setIsSeedQueueRunning] = useState(false);
  const seedQueueRef = useRef<string[]>([]);
  const seedQueueRunningRef = useRef(false);
  const seedGuidesRef = useRef<SeederGuide[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prefabSummaries, setPrefabSummaries] = useState<PrefabSummary[]>([]);
  const [prefabSearch, setPrefabSearch] = useState('');
  const [isPrefabLoading, setIsPrefabLoading] = useState(false);
  const [prefabError, setPrefabError] = useState<string | null>(null);
  const [goldQuestions, setGoldQuestions] = useState<GoldQuestionRow[]>([]);
  const [goldLoading, setGoldLoading] = useState(false);
  const [goldError, setGoldError] = useState<string | null>(null);
  const [goldModuleFilter, setGoldModuleFilter] = useState<'all' | 'heme' | 'pulm'>('all');
  const [goldStatusFilter, setGoldStatusFilter] = useState<'all' | 'draft' | 'approved'>('all');
  const [goldSearch, setGoldSearch] = useState('');
  const [isGoldFormOpen, setIsGoldFormOpen] = useState(false);
  const [goldFormSaving, setGoldFormSaving] = useState(false);
  const [goldFormError, setGoldFormError] = useState<string | null>(null);
  const [editingGoldId, setEditingGoldId] = useState<string | null>(null);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportStatus, setBulkImportStatus] = useState<string | null>(null);
  const [bulkImportRunning, setBulkImportRunning] = useState(false);
  const [bulkImportModule, setBulkImportModule] = useState<'heme' | 'pulm'>('heme');
  const [tutorSummary, setTutorSummary] = useState<TutorUsageSummary | null>(null);
  const [tutorSummaryError, setTutorSummaryError] = useState<string | null>(null);
  const [goldForm, setGoldForm] = useState({
    module: 'heme' as 'heme' | 'pulm',
    questionText: '',
    optionsText: '',
    correctAnswer: '',
    explanation: '',
    studyConceptsText: '',
    difficulty: 'Clinical vignette',
    status: 'draft' as 'draft' | 'approved'
  });
  const [isReseedAllRunning, setIsReseedAllRunning] = useState(false);
  const [reseedNotice, setReseedNotice] = useState<string | null>(null);
  const [selectedPrefabHash, setSelectedPrefabHash] = useState<string | null>(null);
  const [selectedPrefab, setSelectedPrefab] = useState<Awaited<ReturnType<typeof getPrefabSet>>>(null);
  const [isPrefabDrawerOpen, setIsPrefabDrawerOpen] = useState(false);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState<Record<string, boolean>>({});
  const [deepDiveSeeds, setDeepDiveSeeds] = useState<DeepDiveSeedRow[]>([]);
  const [isDeepDiveLoading, setIsDeepDiveLoading] = useState(false);
  const [deepDiveNotice, setDeepDiveNotice] = useState<string | null>(null);
  const [isDeepDiveQueueRunning, setIsDeepDiveQueueRunning] = useState(false);
  const [deepDiveGlobalCount, setDeepDiveGlobalCount] = useState(DEFAULT_DEEP_DIVE_COUNT);
  const [deepDiveSelected, setDeepDiveSelected] = useState<Record<string, boolean>>({});
  const [deepDiveCostPerQuestion, setDeepDiveCostPerQuestion] = useState(0.0002);
  const [deepDiveCostPerLesson, setDeepDiveCostPerLesson] = useState(0.0025);
  const [isDeepDiveDrawerOpen, setIsDeepDiveDrawerOpen] = useState(false);
  const [selectedDeepDiveMeta, setSelectedDeepDiveMeta] = useState<{ source: DeepDiveSeedRow['source']; concept: string } | null>(null);
  const [selectedDeepDive, setSelectedDeepDive] = useState<DeepDivePrefabDetail | null>(null);
  const [deepDiveDrawerError, setDeepDiveDrawerError] = useState<string | null>(null);
  const [isDeepDiveDrawerLoading, setIsDeepDiveDrawerLoading] = useState(false);
  const deepDiveQueueRef = useRef<string[]>([]);
  const deepDiveQueueRunningRef = useRef(false);
  const deepDiveSeedsRef = useRef<DeepDiveSeedRow[]>([]);
  const bulkImportInputRef = useRef<HTMLInputElement>(null);

  const loadFeedback = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('question_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data || []) as FeedbackRow[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load feedback.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPrefabSummaries = async () => {
    setIsPrefabLoading(true);
    setPrefabError(null);
    try {
      const data = await listPrefabSets();
      setPrefabSummaries(data);
    } catch (err: any) {
      setPrefabError(err?.message || 'Failed to load prefab sets.');
    } finally {
      setIsPrefabLoading(false);
    }
  };

  const loadGoldQuestions = async () => {
    setGoldLoading(true);
    setGoldError(null);
    try {
      const data = await listGoldQuestions();
      setGoldQuestions(data);
    } catch (err: any) {
      setGoldError(err?.message || 'Failed to load gold questions.');
    } finally {
      setGoldLoading(false);
    }
  };

  const loadTutorUsage = async (days?: number) => {
    setTutorSummaryError(null);
    try {
      const summary = await fetchTutorUsageSummary(days);
      setTutorSummary(summary);
    } catch (err: any) {
      setTutorSummary(null);
      setTutorSummaryError(err?.message || 'Failed to load tutor usage.');
    }
  };

  useEffect(() => {
    loadFeedback();
    loadPrefabSummaries();
    loadDeepDiveSeeds();
    loadGoldQuestions();
    loadTutorUsage(range === 'all' ? undefined : range === '30d' ? 30 : 7);
  }, []);

  useEffect(() => {
    loadTutorUsage(range === 'all' ? undefined : range === '30d' ? 30 : 7);
  }, [range]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setAdminUserId(data.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAdminUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    seedGuidesRef.current = seedGuides;
  }, [seedGuides]);

  useEffect(() => {
    deepDiveSeedsRef.current = deepDiveSeeds;
  }, [deepDiveSeeds]);

  useEffect(() => {
    setReviewReasons({});
    setReviewNotes({});
    setReviewLoading({});
  }, [selectedPrefabHash]);

  const updateSeedGuide = (id: string, patch: Partial<SeederGuide>) => {
    setSeedGuides((prev) => prev.map((guide) => (guide.id === id ? { ...guide, ...patch } : guide)));
  };

  const normalizeOption = (value: string) =>
    value
      .trim()
      .replace(/^[A-E][.)]\s*/i, '')
      .trim();

  const parseCsv = (text: string) => {
    const rows: string[][] = [];
    let current = '';
    let row: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
        continue;
      }
      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (current.length > 0 || row.length > 0) {
          row.push(current);
          rows.push(row.map((cell) => cell.trim()));
          row = [];
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (current.length > 0 || row.length > 0) {
      row.push(current);
      rows.push(row.map((cell) => cell.trim()));
    }
    return rows.filter((r) => r.some((cell) => cell.length > 0));
  };

  const buildGoldQuestionFromEntry = (entry: any, fallbackModule: 'heme' | 'pulm') => {
    const module = (entry.module || entry.Module || fallbackModule) as 'heme' | 'pulm';
    const directQuestion = entry.question || entry.Question;
    if (directQuestion && typeof directQuestion === 'object') {
      const question: Question = {
        ...directQuestion,
        id: crypto.randomUUID(),
        sourceType: 'gold',
        cardStyle: directQuestion.cardStyle || CardStyle.UWORLD
      };
      const status = (entry.status || entry.Status || 'draft').toString().toLowerCase() === 'approved'
        ? 'approved'
        : 'draft';
      return { module, question, status };
    }

    const questionText = entry.questionText || entry.stem || entry.question || '';
    const options =
      entry.options && Array.isArray(entry.options)
        ? entry.options.map((opt: string) => normalizeOption(String(opt)))
        : [
            entry.optionA,
            entry.optionB,
            entry.optionC,
            entry.optionD,
            entry.optionE
          ]
            .filter(Boolean)
            .map((opt: string) => normalizeOption(String(opt)));

    const optionsFromText =
      !options.length && entry.optionsText
        ? String(entry.optionsText)
            .split('\n')
            .map((line) => normalizeOption(line))
            .filter(Boolean)
        : options;

    let correctAnswer = entry.correctAnswer || entry.correct || entry.answer || '';
    const normalizedOptions = optionsFromText;
    if (typeof correctAnswer === 'string') {
      const letter = correctAnswer.trim().toUpperCase();
      if (letter.length === 1 && letter >= 'A' && letter <= 'E') {
        const idx = letter.charCodeAt(0) - 65;
        if (normalizedOptions[idx]) {
          correctAnswer = normalizedOptions[idx];
        }
      }
    }

    const studyConceptsRaw = entry.studyConcepts || entry.concepts || entry.tags || '';
    const studyConcepts = Array.isArray(studyConceptsRaw)
      ? studyConceptsRaw.map((c: string) => c.trim()).filter(Boolean)
      : String(studyConceptsRaw || '')
          .split(/[|,]/)
          .map((c) => c.trim())
          .filter(Boolean);

    const question: Question = {
      id: crypto.randomUUID(),
      type: QuestionType.MULTIPLE_CHOICE,
      questionText: String(questionText || '').trim(),
      options: normalizedOptions,
      correctAnswer: normalizeOption(String(correctAnswer || '')),
      explanation: String(entry.explanation || entry.rationale || '').trim(),
      studyConcepts,
      difficulty: String(entry.difficulty || 'Clinical vignette'),
      cardStyle: CardStyle.UWORLD,
      sourceType: 'gold'
    };

    const status = (entry.status || entry.Status || 'draft').toString().toLowerCase() === 'approved'
      ? 'approved'
      : 'draft';

    return { module, question, status };
  };

  const buildGoldQuestionFromForm = () => {
    const options = goldForm.optionsText
      .split('\n')
      .map((line) => normalizeOption(line))
      .filter((line) => line.length > 0);

    const studyConcepts = goldForm.studyConceptsText
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const question: Question = {
      id: crypto.randomUUID(),
      type: QuestionType.MULTIPLE_CHOICE,
      questionText: goldForm.questionText.trim(),
      options,
      correctAnswer: normalizeOption(goldForm.correctAnswer),
      explanation: goldForm.explanation.trim(),
      studyConcepts,
      difficulty: goldForm.difficulty.trim(),
      cardStyle: CardStyle.UWORLD,
      sourceType: 'gold'
    };

    return question;
  };

  const handleSaveGoldQuestion = async () => {
    setGoldFormError(null);
    const question = buildGoldQuestionFromForm();
    if (!question.questionText || !question.explanation || !question.correctAnswer || !question.options?.length) {
      setGoldFormError('Please fill out the stem, options, correct answer, and explanation.');
      return;
    }
    if (!question.options?.includes(question.correctAnswer)) {
      setGoldFormError('Correct answer must match one of the options.');
      return;
    }
    setGoldFormSaving(true);
    try {
      if (editingGoldId) {
        await updateGoldQuestion(editingGoldId, {
          module: goldForm.module,
          status: goldForm.status,
          question,
          approved_by: goldForm.status === 'approved' ? adminUserId : null,
          approved_at: goldForm.status === 'approved' ? new Date().toISOString() : null
        });
      } else {
        await createGoldQuestion({
          module: goldForm.module,
          question,
          status: goldForm.status,
          authorId: adminUserId,
          approvedBy: goldForm.status === 'approved' ? adminUserId : null
        });
      }
      setGoldForm({
        module: goldForm.module,
        questionText: '',
        optionsText: '',
        correctAnswer: '',
        explanation: '',
        studyConceptsText: '',
        difficulty: goldForm.difficulty || 'Clinical vignette',
        status: 'draft'
      });
      setEditingGoldId(null);
      setIsGoldFormOpen(false);
      await loadGoldQuestions();
    } catch (err: any) {
      setGoldFormError(err?.message || 'Failed to save gold question.');
    } finally {
      setGoldFormSaving(false);
    }
  };

  const handleApproveGoldQuestion = async (id: string) => {
    try {
      await approveGoldQuestion(id, adminUserId);
      await loadGoldQuestions();
    } catch (err: any) {
      setGoldError(err?.message || 'Failed to approve gold question.');
    }
  };

  const handleRevokeGoldQuestion = async (id: string) => {
    try {
      await revokeGoldApproval(id);
      await loadGoldQuestions();
    } catch (err: any) {
      setGoldError(err?.message || 'Failed to revert approval.');
    }
  };

  const handleDeleteGoldQuestion = async (id: string) => {
    if (!window.confirm('Delete this gold question? This cannot be undone.')) return;
    try {
      await deleteGoldQuestion(id);
      if (editingGoldId === id) {
        setEditingGoldId(null);
        setIsGoldFormOpen(false);
      }
      await loadGoldQuestions();
    } catch (err: any) {
      setGoldError(err?.message || 'Failed to delete gold question.');
    }
  };

  const openGoldEditor = (row: GoldQuestionRow) => {
    const q = row.question || ({} as Question);
    const rawOptions = q.options;
    const optionsList = Array.isArray(rawOptions)
      ? rawOptions
      : typeof rawOptions === 'string'
        ? rawOptions
            .split(/\r?\n/)
            .map((line) => String(line ?? '').trim())
            .filter((line) => line.length > 0)
        : rawOptions && typeof rawOptions === 'object'
          ? Object.values(rawOptions)
              .map((opt) => String(opt ?? '').trim())
              .filter((opt) => opt.length > 0)
          : [];
    const optionsText = optionsList
      .map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`)
      .join('\n');
    const rawConcepts = q.studyConcepts;
    const studyConceptsText = (
      Array.isArray(rawConcepts)
        ? rawConcepts
        : typeof rawConcepts === 'string'
          ? rawConcepts.split(/[|,]/)
          : []
    )
      .map((concept) => String(concept ?? '').trim())
      .filter((concept) => concept.length > 0)
      .join(', ');
    setGoldForm({
      module: row.module,
      questionText: q.questionText || '',
      optionsText,
      correctAnswer: q.correctAnswer || '',
      explanation: q.explanation || '',
      studyConceptsText,
      difficulty: q.difficulty || 'Clinical vignette',
      status: row.status
    });
    setEditingGoldId(row.id);
    setIsGoldFormOpen(true);
  };

  const handleBulkImport = async () => {
    setBulkImportStatus(null);
    if (!bulkImportText.trim()) {
      setBulkImportStatus('Paste JSON or CSV to import.');
      return;
    }
    setBulkImportRunning(true);
    try {
      let entries: any[] = [];
      const trimmed = bulkImportText.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          entries = parsed;
        } else if (parsed?.questions && Array.isArray(parsed.questions)) {
          entries = parsed.questions;
        } else {
          entries = [parsed];
        }
      } else {
        const rows = parseCsv(trimmed);
        if (rows.length < 2) {
          setBulkImportStatus('CSV needs a header row and at least one data row.');
          setBulkImportRunning(false);
          return;
        }
        const headers = rows[0].map((h) => h.trim());
        entries = rows.slice(1).map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((header, idx) => {
            obj[header] = row[idx] ?? '';
          });
          return obj;
        });
      }

      let success = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          const { module, question, status } = buildGoldQuestionFromEntry(entry, bulkImportModule);
          if (!question.questionText || !question.explanation || !question.options?.length || !question.correctAnswer) {
            failed += 1;
            continue;
          }
          if (!question.options.includes(question.correctAnswer)) {
            failed += 1;
            continue;
          }
          await createGoldQuestion({
            module,
            question,
            status,
            authorId: adminUserId,
            approvedBy: status === 'approved' ? adminUserId : null
          });
          success += 1;
        } catch {
          failed += 1;
        }
      }
      await loadGoldQuestions();
      setBulkImportStatus(`Imported ${success} questions. ${failed} failed.`);
    } catch (err: any) {
      setBulkImportStatus(err?.message || 'Failed to import questions.');
    } finally {
      setBulkImportRunning(false);
    }
  };

  const handleSeederFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSeedNotice(null);
    const list = Array.from(files).filter((file) => file.type === 'application/pdf');
    if (list.length === 0) {
      setSeedNotice('Only PDF files are supported.');
      return;
    }

    for (const file of list) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const baseGuide: SeederGuide = {
        id,
        fileName: file.name,
        guideTitle: file.name,
        guideHash: '',
        items: [],
        targetTotal: DEFAULT_TARGET_TOTAL,
        questionCount: 0,
        status: 'parsing'
      };
      setSeedGuides((prev) => [...prev, baseGuide]);

      try {
        const text = await extractPdfText(file);
        const { guideHash, guideItems } = await buildStudyGuideItems(text);
        const current = seedGuidesRef.current.find((g) => g.id === id);
        const targetTotal = current?.targetTotal ?? DEFAULT_TARGET_TOTAL;
        const plannedQuestions = guideItems.length === 0 ? 0 : Math.max(1, targetTotal);

        let status: SeederStatus = 'missing';
        try {
          const cached = await getPrefabSet(guideHash);
          status = cached ? 'cached' : 'missing';
        } catch {
          status = 'error';
        }

        updateSeedGuide(id, {
          guideHash,
          items: guideItems,
          targetTotal,
          questionCount: plannedQuestions,
          status
        });
      } catch (err: any) {
        updateSeedGuide(id, {
          status: 'error',
          error: err?.message || 'Failed to parse PDF.'
        });
      }
    }
  };

  const enqueueSeeds = (ids: string[]) => {
    const queue = seedQueueRef.current;
    ids.forEach((id) => {
      if (!queue.includes(id)) queue.push(id);
    });
    seedQueueRef.current = queue;
    if (!seedQueueRunningRef.current) {
      processSeedQueue();
    }
  };

  const processSeedQueue = async () => {
    if (seedQueueRunningRef.current) return;
    seedQueueRunningRef.current = true;
    setIsSeedQueueRunning(true);
    while (seedQueueRef.current.length > 0) {
      const nextId = seedQueueRef.current.shift();
      if (!nextId) break;
      await seedGuide(nextId);
    }
    seedQueueRunningRef.current = false;
    setIsSeedQueueRunning(false);
  };

  const seedGuide = async (id: string) => {
    const guide = seedGuidesRef.current.find((g) => g.id === id);
    if (!guide || guide.status === 'seeding') return;
    if (!guide.items || guide.items.length === 0) {
      updateSeedGuide(id, { status: 'error', error: 'No items found for this guide.' });
      return;
    }

    updateSeedGuide(id, { status: 'seeding', error: undefined });
    try {
      await seedPrefabSet(
        guide.guideTitle,
        guide.guideHash,
        guide.items,
        SEED_PREFS,
        {
          totalQuestions: guide.targetTotal,
          preferLongestItems: true
        }
      );
      updateSeedGuide(id, { status: 'done' });
    } catch (err: any) {
      updateSeedGuide(id, { status: 'error', error: err?.message || 'Seeding failed.' });
    }
  };

  const handleSeedMissing = () => {
    const ids = seedGuides
      .filter((guide) => guide.status === 'missing' || guide.status === 'error')
      .map((guide) => guide.id);
    enqueueSeeds(ids);
  };

  const handleSeedAll = () => {
    if (!window.confirm('This will rebuild all guides, including cached ones. Continue?')) return;
    const ids = seedGuides.map((guide) => guide.id);
    enqueueSeeds(ids);
  };

  const handleRemoveGuide = (id: string) => {
    setSeedGuides((prev) => prev.filter((guide) => guide.id !== id));
  };

  const handleClearGuides = () => {
    setSeedGuides([]);
    seedQueueRef.current = [];
  };

  const loadDeepDiveSeeds = async () => {
    setIsDeepDiveLoading(true);
    setDeepDiveNotice(null);
    try {
      const base = deepDivePrefabTopics.map((topic) => ({
        id: `${topic.source}::${topic.concept}`,
        concept: topic.concept,
        source: topic.source,
        targetCount: DEFAULT_DEEP_DIVE_COUNT,
        seededCount: 0,
        status: 'missing' as DeepDiveSeedStatus
      }));
      const statuses = await Promise.all(
        base.map(async (row) => {
          try {
            const cached = await getDeepDivePrefab(row.source, row.concept);
            return {
              ...row,
              status: cached ? 'cached' : 'missing',
              seededCount: cached ? (Array.isArray(cached.quiz) ? cached.quiz.length : 0) : 0
            };
          } catch (err: any) {
            return { ...row, status: 'error', error: err?.message || 'Lookup failed' };
          }
        })
      );
      const sorted = statuses.sort((a, b) => {
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        return a.concept.localeCompare(b.concept);
      });
      setDeepDiveSeeds(sorted);
      setDeepDiveSelected((prev) => {
        const next = { ...prev };
        sorted.forEach((row) => {
          if (typeof next[row.id] === 'undefined') {
            next[row.id] = false;
          }
        });
        return next;
      });
    } finally {
      setIsDeepDiveLoading(false);
    }
  };

  const openDeepDiveDrawer = async (source: DeepDiveSeedRow['source'], concept: string) => {
    setSelectedDeepDiveMeta({ source, concept });
    setSelectedDeepDive(null);
    setDeepDiveDrawerError(null);
    setIsDeepDiveDrawerLoading(true);
    setIsDeepDiveDrawerOpen(true);
    try {
      const cached = await getDeepDivePrefab(source, concept);
      if (!cached) {
        setDeepDiveDrawerError('No cached deep dive found for this topic.');
        return;
      }
      setSelectedDeepDive({
        topicKey: cached.topicKey,
        topicContext: cached.topicContext,
        concept: cached.concept,
        lessonContent: cached.lessonContent || '',
        quiz: Array.isArray(cached.quiz) ? cached.quiz : [],
        createdAt: cached.createdAt,
        model: cached.model
      });
    } catch (err: any) {
      setDeepDiveDrawerError(err?.message || 'Failed to load deep dive prefab.');
    } finally {
      setIsDeepDiveDrawerLoading(false);
    }
  };

  const closeDeepDiveDrawer = () => {
    setIsDeepDiveDrawerOpen(false);
    setSelectedDeepDiveMeta(null);
    setSelectedDeepDive(null);
    setDeepDiveDrawerError(null);
    setIsDeepDiveDrawerLoading(false);
  };

  const enqueueDeepDiveSeeds = (ids: string[]) => {
    const queue = deepDiveQueueRef.current;
    ids.forEach((id) => {
      if (!queue.includes(id)) queue.push(id);
    });
    deepDiveQueueRef.current = queue;
    if (!deepDiveQueueRunningRef.current) {
      processDeepDiveQueue();
    }
  };

  const processDeepDiveQueue = async () => {
    if (deepDiveQueueRunningRef.current) return;
    deepDiveQueueRunningRef.current = true;
    setIsDeepDiveQueueRunning(true);
    while (deepDiveQueueRef.current.length > 0) {
      const nextId = deepDiveQueueRef.current.shift();
      if (!nextId) break;
      await seedDeepDive(nextId);
    }
    deepDiveQueueRunningRef.current = false;
    setIsDeepDiveQueueRunning(false);
  };

  const seedDeepDive = async (id: string) => {
    const row = deepDiveSeedsRef.current.find((seed) => seed.id === id);
    if (!row || row.status === 'seeding') return;
    setDeepDiveSeeds((prev) =>
      prev.map((seed) =>
        seed.id === id ? { ...seed, status: 'seeding', error: undefined } : seed
      )
    );
    try {
      const count = Math.max(1, row.targetCount || DEFAULT_DEEP_DIVE_COUNT);
      const existing = await getDeepDivePrefab(row.source, row.concept);
      if (existing) {
        const extraQuiz = await extendDeepDiveQuiz(null, row.source, row.concept, count);
        const merged = await appendDeepDivePrefab(row.source, row.concept, existing.lessonContent, extraQuiz);
        const mergedCount = Array.isArray(merged.quiz) ? merged.quiz.length : row.seededCount;
        setDeepDiveSeeds((prev) =>
          prev.map((seed) =>
            seed.id === id ? { ...seed, status: 'done', seededCount: mergedCount } : seed
          )
        );
        return;
      }

      const data = await startDeepDive(null, row.source, row.concept, count);
      await seedDeepDivePrefab(row.source, row.concept, data.lessonContent, data.quiz);
      setDeepDiveSeeds((prev) =>
        prev.map((seed) =>
          seed.id === id ? { ...seed, status: 'done', seededCount: data.quiz.length } : seed
        )
      );
    } catch (err: any) {
      setDeepDiveSeeds((prev) =>
        prev.map((seed) =>
          seed.id === id
            ? { ...seed, status: 'error', error: err?.message || 'Seeding failed.' }
            : seed
        )
      );
    }
  };

  const handleSeedDeepDiveMissing = () => {
    const ids = deepDiveSeeds
      .filter((seed) => seed.status === 'missing' || seed.status === 'error')
      .map((seed) => seed.id);
    enqueueDeepDiveSeeds(ids);
  };

  const handleSeedDeepDiveAll = () => {
    if (!window.confirm('This will add questions to all deep dive prefabs and use credits. Continue?')) return;
    enqueueDeepDiveSeeds(deepDiveSeeds.map((seed) => seed.id));
  };

  const handleSeedDeepDiveSelected = () => {
    const selectedIds = deepDiveSeeds
      .filter((seed) => deepDiveSelected[seed.id])
      .map((seed) => seed.id);
    if (selectedIds.length === 0) return;
    enqueueDeepDiveSeeds(selectedIds);
  };

  const toggleDeepDiveSelection = (id: string) => {
    setDeepDiveSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSelectAllDeepDives = (checked: boolean) => {
    setDeepDiveSelected((prev) => {
      const next = { ...prev };
      deepDiveSeeds.forEach((seed) => {
        next[seed.id] = checked;
      });
      return next;
    });
  };

  const handleDeepDiveCountChange = (id: string, value: number) => {
    const nextValue = Math.max(1, Math.min(value, 25));
    setDeepDiveSeeds((prev) =>
      prev.map((seed) =>
        seed.id === id
          ? {
              ...seed,
              targetCount: nextValue
            }
          : seed
      )
    );
  };

  const applyDeepDiveCountToAll = () => {
    setDeepDiveSeeds((prev) => prev.map((seed) => ({ ...seed, targetCount: deepDiveGlobalCount })));
  };

  const estimateDeepDiveCost = (rows: DeepDiveSeedRow[]) => {
    const totalQuestions = rows.reduce((sum, row) => sum + (row.targetCount || 0), 0);
    const lessonCount = rows.filter((row) => row.status === 'missing' || row.status === 'error').length;
    const estimate = totalQuestions * deepDiveCostPerQuestion + lessonCount * deepDiveCostPerLesson;
    return {
      totalQuestions,
      lessonCount,
      estimate
    };
  };

  const selectedDeepDives = deepDiveSeeds.filter((seed) => deepDiveSelected[seed.id]);
  const missingDeepDives = deepDiveSeeds.filter((seed) => seed.status === 'missing' || seed.status === 'error');

  const getReasonValue = (questionId: string) => {
    const existing = selectedPrefab?.questions?.find((question) => question.id === questionId)?.adminReview?.reason;
    return reviewReasons[questionId] || existing || removalReasons[0];
  };

  const refreshSelectedPrefab = async () => {
    if (!selectedPrefabHash) return;
    try {
      const data = await getPrefabSet(selectedPrefabHash);
      setSelectedPrefab(data);
    } catch (err: any) {
      setSelectedPrefab(null);
      setPrefabError(err?.message || 'Failed to load prefab questions.');
    }
  };

  const handleReseedAllPrefabs = async () => {
    if (isReseedAllRunning) return;
    const shouldProceed = window.confirm('This will reseed all cached prefab sets and use credits. Continue?');
    if (!shouldProceed) return;

    setIsReseedAllRunning(true);
    setReseedNotice('Reseeding all prefab sets…');
    setPrefabError(null);

    try {
      const summaries = prefabSummaries.length > 0 ? prefabSummaries : await listPrefabSets();
      for (const summary of summaries) {
        setReseedNotice(`Reseeding ${summary.guideTitle}…`);
        const full = await getPrefabSet(summary.guideHash);
        if (!full) continue;
        const targetTotal = full.questions?.length || DEFAULT_TARGET_TOTAL;
        await seedPrefabSet(
          full.guideTitle || 'Study Guide',
          full.guideHash,
          full.items || [],
          SEED_PREFS,
          {
            totalQuestions: targetTotal,
            preferLongestItems: true
          }
        );
      }
      setReseedNotice('Reseed complete.');
      await loadPrefabSummaries();
    } catch (err: any) {
      setPrefabError(err?.message || 'Failed to reseed prefab sets.');
    } finally {
      setIsReseedAllRunning(false);
      setTimeout(() => setReseedNotice(null), 3000);
    }
  };

  const handleRetireReplace = async (questionId: string) => {
    if (!selectedPrefab) return;
    const reason = getReasonValue(questionId);
    const existingNote = selectedPrefab?.questions?.find((question) => question.id === questionId)?.adminReview?.note;
    const note = (reviewNotes[questionId] ?? existingNote ?? '').trim();
    if (reason === 'Other' && !note) {
      alert('Please add a note when selecting "Other".');
      return;
    }

    setReviewLoading((prev) => ({ ...prev, [questionId]: true }));
    try {
      await replacePrefabQuestion(selectedPrefab, questionId, reason, note, adminUserId || undefined);
      await refreshSelectedPrefab();
    } catch (err: any) {
      alert(err?.message || 'Failed to replace the question.');
    } finally {
      setReviewLoading((prev) => ({ ...prev, [questionId]: false }));
    }
  };

  const handleRestoreQuestion = async (questionId: string) => {
    if (!selectedPrefab) return;
    setReviewLoading((prev) => ({ ...prev, [questionId]: true }));
    try {
      await restorePrefabQuestion(selectedPrefab, questionId, adminUserId || undefined);
      await refreshSelectedPrefab();
    } catch (err: any) {
      alert(err?.message || 'Failed to restore the question.');
    } finally {
      setReviewLoading((prev) => ({ ...prev, [questionId]: false }));
    }
  };

  const openPrefabDrawer = async (guideHash: string) => {
    setSelectedPrefabHash(guideHash);
    setIsPrefabDrawerOpen(true);
    setSelectedPrefab(null);
    try {
      const data = await getPrefabSet(guideHash);
      setSelectedPrefab(data);
    } catch (err: any) {
      setSelectedPrefab(null);
      setPrefabError(err?.message || 'Failed to load prefab questions.');
    }
  };

  const closePrefabDrawer = () => {
    setIsPrefabDrawerOpen(false);
  };

  const handleTargetChange = (id: string, value: number) => {
    const nextValue = Math.max(1, Math.min(value, 200));
    setSeedGuides((prev) =>
      prev.map((guide) =>
        guide.id === id
          ? {
              ...guide,
              targetTotal: nextValue,
              questionCount: guide.items.length === 0 ? 0 : nextValue
            }
          : guide
      )
    );
  };

  useEffect(() => {
    if (!selectedQuestionId) return;
    const stillExists = rows.some(row => row.question_id === selectedQuestionId);
    if (!stillExists) {
      setSelectedQuestionId(null);
      setIsDrawerOpen(false);
    }
  }, [rows, selectedQuestionId]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isPrefabDrawerOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPrefabDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPrefabDrawerOpen]);

  const filteredRows = useMemo(() => {
    if (range === 'all') return rows;
    const cutoffDays = range === '7d' ? 7 : 30;
    const cutoff = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
    return rows.filter(row => new Date(row.created_at).getTime() >= cutoff);
  }, [rows, range]);

  const summary = useMemo(() => {
    const reportRows = filteredRows.filter(row => row.kind === 'bug');
    const ratingRows = filteredRows.filter(row => row.kind === 'rating' && typeof row.rating === 'number');
    const appBugs = reportRows.filter(row => isAppBug(row.tags));
    const contentReports = reportRows.filter(row => !isAppBug(row.tags));

    const avgRating =
      ratingRows.length > 0
        ? ratingRows.reduce((sum, row) => sum + (row.rating || 0), 0) / ratingRows.length
        : null;

    const answered = filteredRows.filter(row => typeof row.is_correct === 'boolean');
    const correct = answered.filter(row => row.is_correct).length;
    const accuracy = answered.length > 0 ? (correct / answered.length) * 100 : null;

    const avgTime =
      filteredRows.length > 0
        ? filteredRows.reduce((sum, row) => sum + (row.time_spent_ms || 0), 0) / filteredRows.length
        : null;

    return {
      total: filteredRows.length,
      ratingCount: ratingRows.length,
      avgRating,
      contentReports: contentReports.length,
      appBugs: appBugs.length,
      accuracy,
      avgTime
    };
  }, [filteredRows]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filteredRows.forEach(row => {
      (row.tags || []).forEach(tag => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [filteredRows]);

  const topQuestions = useMemo(() => {
    const map = new Map<string, { count: number; text: string }>();
    filteredRows
      .filter(row => row.kind === 'bug')
      .forEach(row => {
        const text = row.payload?.question?.questionText || 'Question text unavailable';
        const current = map.get(row.question_id);
        map.set(row.question_id, {
          count: (current?.count || 0) + 1,
          text: current?.text || text
        });
      });
    return Array.from(map.entries())
      .map(([questionId, data]) => ({ questionId, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredRows]);

  const recentReports = useMemo(() => {
    return filteredRows
      .filter(row => row.kind === 'bug')
      .slice(0, 12);
  }, [filteredRows]);

  const filteredPrefabs = useMemo(() => {
    const query = prefabSearch.trim().toLowerCase();
    if (!query) return prefabSummaries;
    return prefabSummaries.filter((item) => item.guideTitle.toLowerCase().includes(query));
  }, [prefabSearch, prefabSummaries]);

  const goldStats = useMemo(() => {
    const total = goldQuestions.length;
    const approved = goldQuestions.filter((q) => q.status === 'approved').length;
    const draft = goldQuestions.filter((q) => q.status === 'draft').length;
    return { total, approved, draft };
  }, [goldQuestions]);

  const filteredGoldQuestions = useMemo(() => {
    const query = goldSearch.trim().toLowerCase();
    return goldQuestions.filter((row) => {
      if (goldModuleFilter !== 'all' && row.module !== goldModuleFilter) return false;
      if (goldStatusFilter !== 'all' && row.status !== goldStatusFilter) return false;
      if (!query) return true;
      const text = row.question?.questionText || '';
      return text.toLowerCase().includes(query);
    });
  }, [goldQuestions, goldModuleFilter, goldStatusFilter, goldSearch]);

  const activePrefabCount = useMemo(() => {
    if (!selectedPrefab) return 0;
    return getActivePrefabQuestions(selectedPrefab.questions || []).length;
  }, [selectedPrefab]);

  const questionRows = useMemo(() => {
    if (!selectedQuestionId) return [];
    return rows
      .filter(row => row.question_id === selectedQuestionId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [rows, selectedQuestionId]);

  const questionPayload = questionRows[0]?.payload?.question;
  const questionMetrics = useMemo(() => {
    if (!selectedQuestionId) return null;
    const reportRows = questionRows.filter(row => row.kind === 'bug');
    const ratingRows = questionRows.filter(row => row.kind === 'rating' && typeof row.rating === 'number');
    const avgRating =
      ratingRows.length > 0
        ? ratingRows.reduce((sum, row) => sum + (row.rating || 0), 0) / ratingRows.length
        : null;
    const answered = questionRows.filter(row => typeof row.is_correct === 'boolean');
    const correct = answered.filter(row => row.is_correct).length;
    const accuracy = answered.length > 0 ? (correct / answered.length) * 100 : null;
    const avgTime =
      questionRows.length > 0
        ? questionRows.reduce((sum, row) => sum + (row.time_spent_ms || 0), 0) / questionRows.length
        : null;
    return {
      totalReports: reportRows.length,
      avgRating,
      accuracy,
      avgTime
    };
  }, [questionRows, selectedQuestionId]);

  const openDrawerForQuestion = (questionId: string) => {
    setSelectedQuestionId(questionId);
    setIsDrawerOpen(true);
  };

  const buildCsvRow = (row: FeedbackRow) => {
    const questionText = row.payload?.question?.questionText || '';
    const excerpt = questionText.replace(/\s+/g, ' ').trim().slice(0, 140);
    return {
      created_at: row.created_at,
      kind: row.kind,
      rating: row.rating ?? '',
      tags: (row.tags || []).join('|'),
      comment: row.comment ?? '',
      selected_option: row.selected_option ?? '',
      is_correct: row.is_correct ?? '',
      time_spent_ms: row.time_spent_ms ?? '',
      question_id: row.question_id,
      user_id: row.user_id,
      question_text_excerpt: excerpt
    };
  };

  const handleExportCsv = () => {
    if (filteredRows.length === 0) return;
    const lines = [
      csvHeaders.map(header => escapeCsvValue(header)).join(',')
    ];
    filteredRows.forEach(row => {
      const flat = buildCsvRow(row);
      const line = csvHeaders.map(header => escapeCsvValue((flat as any)[header] ?? '')).join(',');
      lines.push(line);
    });
    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `beta-feedback-${range}-${formatDateForFile()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-100 text-teal-700 rounded-xl">
              <ChartBarIcon className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Beta Analytics</h2>
          </div>
          <p className="text-slate-500 text-sm mt-2">Feedback summaries for rapid iteration.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl p-1">
            {timeRanges.map(option => (
              <button
                key={option.id}
                onClick={() => setRange(option.id)}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors ${
                  range === option.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
            className={`px-3 py-2 rounded-2xl border text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${
              filteredRows.length === 0
                ? 'border-slate-200 text-slate-300'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={loadFeedback}
            className="px-3 py-2 rounded-2xl border border-slate-200 text-slate-500 text-xs font-black uppercase tracking-widest hover:bg-slate-50 flex items-center gap-2"
          >
            <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {showDebugPanel && (
        <div className="mb-6 p-4 rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">A/B Debug</div>
          <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-600 font-semibold">
            <div>
              Variant: <span className="text-slate-900">{abDebug?.variant || 'n/a'}</span>
            </div>
            <div>
              Guide: <span className="text-slate-900">{debugGuideTitle}</span>
              {debugGuideHash && (
                <span className="text-slate-400"> • {maskId(debugGuideHash)}</span>
              )}
            </div>
            <div>
              Sources: <span className="text-amber-700">gold {debugCounts.gold}</span> •{' '}
              <span className="text-indigo-700">prefab {debugCounts.prefab}</span> •{' '}
              <span className="text-slate-700">generated {debugCounts.generated}</span>
            </div>
            {prefabMeta && (
              <div>
                Prefab: <span className="text-slate-900">{prefabMeta.totalPrefab}</span>
                {typeof prefabMeta.remainingPrefab === 'number' && (
                  <span className="text-slate-400"> • remaining {prefabMeta.remainingPrefab}</span>
                )}
                {prefabExhausted && <span className="text-amber-600"> • exhausted</span>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Override</span>
              <select
                value={abOverride}
                onChange={(e) => onOverrideChange?.(e.target.value as AbOverrideOption)}
                disabled={!lastGuideHash || !onOverrideChange}
                className="px-2 py-1 rounded-lg border border-slate-200 text-[10px] uppercase tracking-widest text-slate-600 font-black bg-white"
              >
                <option value="auto">Auto</option>
                <option value="gold">Gold</option>
                <option value="guide">Guide</option>
                <option value="split">50/50</option>
              </select>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Override applies to the last guide used in Practice.
          </div>
        </div>
      )}

      {(tutorSummary || tutorSummaryError) && (
        <div className="mb-6 p-4 rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">AI Tutor Usage</div>
          {tutorSummaryError ? (
            <div className="mt-2 text-xs text-rose-600 font-semibold">{tutorSummaryError}</div>
          ) : tutorSummary ? (
            <>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-slate-600 font-semibold">
                <div>
                  Opens <span className="text-slate-900 font-black">{tutorSummary.totalOpens}</span>
                </div>
                <div>
                  Messages <span className="text-slate-900 font-black">{tutorSummary.totalMessages}</span>
                </div>
                <div>
                  Responses <span className="text-slate-900 font-black">{tutorSummary.totalResponses}</span>
                </div>
                <div>
                  Users <span className="text-slate-900 font-black">{tutorSummary.uniqueUsers}</span>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 font-semibold">
                Practice {tutorSummary.byLocation.practice} • Remediation {tutorSummary.byLocation.remediation} • Deep Dive {tutorSummary.byLocation.deep_dive}
              </div>
            </>
          ) : (
            <div className="mt-2 text-xs text-slate-500 font-semibold">No tutor usage yet.</div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-semibold flex items-center gap-3">
          <ExclamationTriangleIcon className="w-5 h-5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total feedback</div>
          <div className="text-2xl font-black text-slate-800 mt-2">{summary.total}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Average rating</div>
          <div className="text-2xl font-black text-slate-800 mt-2">
            {summary.avgRating ? summary.avgRating.toFixed(2) : '—'}
          </div>
          <div className="text-[11px] text-slate-400">From {summary.ratingCount} ratings</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Accuracy rate</div>
          <div className="text-2xl font-black text-slate-800 mt-2">
            {summary.accuracy === null ? '—' : `${summary.accuracy.toFixed(1)}%`}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Content reports</div>
          <div className="text-2xl font-black text-slate-800 mt-2">{summary.contentReports}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">App/UX bugs</div>
          <div className="text-2xl font-black text-slate-800 mt-2">{summary.appBugs}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Avg time on question</div>
          <div className="text-2xl font-black text-slate-800 mt-2">{formatMs(summary.avgTime)}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Prefab Seeder</div>
            <h3 className="text-lg font-bold text-slate-800 mt-1">Preload Prefab Question Sets</h3>
            <p className="text-sm text-slate-500 mt-1">
              Upload multiple study guides to seed cached questions before beta launch.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSeedMissing}
              disabled={!seedGuides.some((guide) => guide.status === 'missing' || guide.status === 'error')}
              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${
                seedGuides.some((guide) => guide.status === 'missing' || guide.status === 'error')
                  ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  : 'border-slate-200 text-slate-300'
              }`}
            >
              Seed Missing
            </button>
            <button
              onClick={handleSeedAll}
              disabled={seedGuides.length === 0}
              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${
                seedGuides.length > 0
                  ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  : 'border-slate-200 text-slate-300'
              }`}
            >
              Seed All
            </button>
            <button
              onClick={handleClearGuides}
              disabled={seedGuides.length === 0}
              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${
                seedGuides.length > 0
                  ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  : 'border-slate-200 text-slate-300'
              }`}
            >
              Clear List
            </button>
          </div>
        </div>

        <div
          className="mt-6 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center cursor-pointer hover:border-teal-300 hover:bg-teal-50/30 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleSeederFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            ref={fileInputRef}
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              handleSeederFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="text-sm font-semibold text-slate-600">Drag & drop PDFs here</div>
          <div className="text-xs text-slate-400 mt-1">or click to browse files</div>
        </div>

        {seedNotice && (
          <div className="mt-4 text-xs text-amber-600 font-semibold">{seedNotice}</div>
        )}

        {seedGuides.length > 0 && (
          <div className="mt-6 space-y-3">
            {seedGuides.map((guide) => (
              <div key={guide.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                <div className="grid grid-cols-1 md:grid-cols-[2fr_0.6fr_0.6fr_0.6fr_0.9fr_1fr] gap-3 items-center">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{guide.fileName}</div>
                    {guide.guideHash && (
                      <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                        Hash • {maskId(guide.guideHash)}
                      </div>
                    )}
                    {guide.error && (
                      <div className="text-[11px] text-rose-600 mt-1">{guide.error}</div>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    Items: <span className="font-semibold text-slate-700">{guide.items.length}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    Target:
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={guide.targetTotal}
                      onChange={(e) => handleTargetChange(guide.id, Number(e.target.value))}
                      className="ml-2 w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs text-slate-700 font-semibold"
                    />
                  </div>
                  <div className="text-xs text-slate-500">
                    Planned: <span className="font-semibold text-slate-700">{guide.questionCount}</span>
                  </div>
                  <div>
                    <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${statusStyles[guide.status]}`}>
                      {statusLabel[guide.status]}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {(guide.status === 'missing' || guide.status === 'error') && (
                      <button
                        onClick={() => enqueueSeeds([guide.id])}
                        className="px-3 py-1.5 rounded-xl border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-50"
                      >
                        Seed
                      </button>
                    )}
                    {(guide.status === 'cached' || guide.status === 'done') && (
                      <button
                        onClick={() => enqueueSeeds([guide.id])}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50"
                      >
                        Rebuild
                      </button>
                    )}
                    {guide.status === 'seeding' && (
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Seeding…</span>
                    )}
                    <button
                      onClick={() => handleRemoveGuide(guide.id)}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:text-slate-600 hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-[10px] text-slate-400 mt-4 uppercase tracking-widest font-black">
          Default target = {DEFAULT_TARGET_TOTAL} questions per guide (editable per guide)
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Deep Dive Seeder</div>
            <h3 className="text-lg font-bold text-slate-800 mt-1">Prefab Deep Dives</h3>
            <p className="text-sm text-slate-500 mt-1">
              Seed cached deep‑dive lessons for the Heme/Pulm session topics (excluding case conferences).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSeedDeepDiveMissing}
              disabled={!deepDiveSeeds.some((seed) => seed.status === 'missing' || seed.status === 'error')}
              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${
                deepDiveSeeds.some((seed) => seed.status === 'missing' || seed.status === 'error')
                  ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  : 'border-slate-200 text-slate-300'
              }`}
            >
              Seed Missing
            </button>
            <button
              onClick={handleSeedDeepDiveSelected}
              disabled={!deepDiveSeeds.some((seed) => deepDiveSelected[seed.id])}
              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${
                deepDiveSeeds.some((seed) => deepDiveSelected[seed.id])
                  ? 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'
                  : 'border-slate-200 text-slate-300'
              }`}
            >
              Seed Selected
            </button>
            <button
              onClick={handleSeedDeepDiveAll}
              disabled={deepDiveSeeds.length === 0}
              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${
                deepDiveSeeds.length > 0
                  ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  : 'border-slate-200 text-slate-300'
              }`}
            >
              Seed All
            </button>
            <button
              onClick={loadDeepDiveSeeds}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 flex items-center gap-2"
            >
              <ArrowPathIcon className={`w-4 h-4 ${isDeepDiveLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {deepDiveNotice && (
          <div className="mt-4 text-xs text-amber-600 font-semibold">{deepDiveNotice}</div>
        )}

        {isDeepDiveQueueRunning && (
          <div className="mt-4 text-xs text-indigo-600 font-semibold">Seeding queue running…</div>
        )}

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">
              Default = {DEFAULT_DEEP_DIVE_COUNT} questions per topic
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Apply to all</span>
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                {deepDiveGlobalCount}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <input
              type="range"
              min="3"
              max="25"
              step="1"
              value={deepDiveGlobalCount}
              onChange={(e) => setDeepDiveGlobalCount(parseInt(e.target.value, 10))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <button
              onClick={applyDeepDiveCountToAll}
              className="self-start px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50"
            >
              Set all topics to {deepDiveGlobalCount}
            </button>
          </div>
        </div>

        <div className="mt-5 border border-slate-200 rounded-2xl p-4 bg-white">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Quick Cost Estimate</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600">
            <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Selected</div>
              {selectedDeepDives.length === 0 ? (
                <div className="text-slate-400 mt-1">None selected</div>
              ) : (
                (() => {
                  const { totalQuestions, lessonCount, estimate } = estimateDeepDiveCost(selectedDeepDives);
                  return (
                    <div className="mt-1 space-y-1">
                      <div>{selectedDeepDives.length} topics</div>
                      <div>{totalQuestions} questions</div>
                      <div>{lessonCount} new lessons</div>
                      <div className="font-black text-slate-800">{formatCurrency(estimate)}</div>
                    </div>
                  );
                })()
              )}
            </div>
            <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Missing Only</div>
              {missingDeepDives.length === 0 ? (
                <div className="text-slate-400 mt-1">None missing</div>
              ) : (
                (() => {
                  const { totalQuestions, lessonCount, estimate } = estimateDeepDiveCost(missingDeepDives);
                  return (
                    <div className="mt-1 space-y-1">
                      <div>{missingDeepDives.length} topics</div>
                      <div>{totalQuestions} questions</div>
                      <div>{lessonCount} new lessons</div>
                      <div className="font-black text-slate-800">{formatCurrency(estimate)}</div>
                    </div>
                  );
                })()
              )}
            </div>
            <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">All Topics</div>
              {deepDiveSeeds.length === 0 ? (
                <div className="text-slate-400 mt-1">No topics</div>
              ) : (
                (() => {
                  const { totalQuestions, lessonCount, estimate } = estimateDeepDiveCost(deepDiveSeeds);
                  return (
                    <div className="mt-1 space-y-1">
                      <div>{deepDiveSeeds.length} topics</div>
                      <div>{totalQuestions} questions</div>
                      <div>{lessonCount} new lessons</div>
                      <div className="font-black text-slate-800">{formatCurrency(estimate)}</div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-500">
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">$/question</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={deepDiveCostPerQuestion}
                onChange={(e) => setDeepDiveCostPerQuestion(Number(e.target.value))}
                className="w-20 px-2 py-1 rounded-lg border border-slate-200 text-xs text-slate-700 font-semibold"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">$/lesson</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={deepDiveCostPerLesson}
                onChange={(e) => setDeepDiveCostPerLesson(Number(e.target.value))}
                className="w-20 px-2 py-1 rounded-lg border border-slate-200 text-xs text-slate-700 font-semibold"
              />
            </label>
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Estimate assumes missing topics require a full lesson build; cached topics append questions only.
          </div>
        </div>

        {isDeepDiveLoading && (
          <div className="mt-4 text-sm text-slate-400">Loading deep dive cache status…</div>
        )}

        {!isDeepDiveLoading && deepDiveSeeds.length === 0 && (
          <div className="mt-4 text-sm text-slate-400">No deep dive topics configured.</div>
        )}

        {deepDiveSeeds.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-slate-400">
              <input
                type="checkbox"
                checked={deepDiveSeeds.length > 0 && deepDiveSeeds.every((seed) => deepDiveSelected[seed.id])}
                onChange={(e) => toggleSelectAllDeepDives(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Select all
            </div>
            {deepDiveSeeds.map((seed) => (
              <div key={seed.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                <div className="grid grid-cols-1 md:grid-cols-[0.2fr_2fr_1fr_0.9fr_1fr] gap-3 items-center">
                  <div className="flex items-center justify-center md:justify-start">
                    <input
                      type="checkbox"
                      checked={!!deepDiveSelected[seed.id]}
                      onChange={() => toggleDeepDiveSelection(seed.id)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{seed.concept}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                      {seed.source}
                    </div>
                    {seed.error && (
                      <div className="text-[11px] text-rose-600 mt-1">{seed.error}</div>
                    )}
                  </div>
                  <div>
                    <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${deepDiveStatusStyles[seed.status]}`}>
                      {deepDiveStatusLabel[seed.status]}
                      {(seed.status === 'cached' || seed.status === 'done') && (
                        <span className="ml-2 text-[9px] font-black uppercase tracking-widest">{seed.seededCount}</span>
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span>Questions:</span>
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={seed.targetCount}
                      onChange={(e) => handleDeepDiveCountChange(seed.id, Number(e.target.value))}
                      className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs text-slate-700 font-semibold"
                    />
                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                      Seeded: {seed.seededCount}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {(seed.status === 'missing' || seed.status === 'error') && (
                      <button
                        onClick={() => enqueueDeepDiveSeeds([seed.id])}
                        className="px-3 py-1.5 rounded-xl border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-50"
                      >
                        Seed
                      </button>
                    )}
                    {(seed.status === 'cached' || seed.status === 'done') && (
                      <button
                        onClick={() => openDeepDiveDrawer(seed.source, seed.concept)}
                        className="px-3 py-1.5 rounded-xl border border-indigo-200 text-indigo-700 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50"
                      >
                        View
                      </button>
                    )}
                    {(seed.status === 'cached' || seed.status === 'done') && (
                      <button
                        onClick={() => enqueueDeepDiveSeeds([seed.id])}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50"
                      >
                        Add
                      </button>
                    )}
                    {seed.status === 'seeding' && (
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Seeding…</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Gold Set Library</div>
            <h3 className="text-lg font-bold text-slate-800 mt-1">Clinician-Reviewed Questions</h3>
            <p className="text-sm text-slate-500 mt-1">
              Build a curated NBME-style set for A/B testing. Drafts require approval before they show up for students.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setIsGoldFormOpen((prev) => !prev)}
              className="px-3 py-2 rounded-xl border border-indigo-200 text-indigo-700 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50"
            >
              {isGoldFormOpen ? 'Close Form' : 'Add Gold Question'}
            </button>
            <button
              onClick={() => setIsBulkImportOpen((prev) => !prev)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50"
            >
              {isBulkImportOpen ? 'Close Import' : 'Bulk Import'}
            </button>
            <button
              onClick={loadGoldQuestions}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 flex items-center gap-2"
            >
              <ArrowPathIcon className={`w-4 h-4 ${goldLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={goldSearch}
            onChange={(e) => setGoldSearch(e.target.value)}
            placeholder="Search stem..."
            className="flex-1 min-w-[220px] px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
          />
          <select
            value={goldModuleFilter}
            onChange={(e) => setGoldModuleFilter(e.target.value as 'all' | 'heme' | 'pulm')}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-600 font-semibold uppercase tracking-widest"
          >
            <option value="all">All Modules</option>
            <option value="heme">Heme</option>
            <option value="pulm">Pulm</option>
          </select>
          <select
            value={goldStatusFilter}
            onChange={(e) => setGoldStatusFilter(e.target.value as 'all' | 'draft' | 'approved')}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-600 font-semibold uppercase tracking-widest"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
          </select>
          <div className="text-xs text-slate-400">
            {goldStats.total} total • {goldStats.approved} approved • {goldStats.draft} draft
          </div>
        </div>

        {isGoldFormOpen && (
          <div className="mt-4 border border-slate-200 rounded-2xl p-4 bg-slate-50/70">
            {editingGoldId && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                  Editing • {maskId(editingGoldId)}
                </div>
                <button
                  onClick={() => {
                    setEditingGoldId(null);
                    setIsGoldFormOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-xs text-slate-500 font-semibold">
                Module
                <select
                  value={goldForm.module}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, module: e.target.value as 'heme' | 'pulm' }))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  <option value="heme">Hematology</option>
                  <option value="pulm">Pulmonology</option>
                </select>
              </label>
              <label className="text-xs text-slate-500 font-semibold">
                Status
                <select
                  value={goldForm.status}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, status: e.target.value as 'draft' | 'approved' }))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                </select>
              </label>
              <label className="text-xs text-slate-500 font-semibold md:col-span-2">
                Question Stem
                <textarea
                  value={goldForm.questionText}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, questionText: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700"
                  placeholder="Enter the full clinical vignette and lead-in."
                />
              </label>
              <label className="text-xs text-slate-500 font-semibold md:col-span-2">
                Options (one per line)
                <textarea
                  value={goldForm.optionsText}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, optionsText: e.target.value }))}
                  rows={4}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700"
                  placeholder="A. Option one&#10;B. Option two&#10;C. Option three..."
                />
              </label>
              <label className="text-xs text-slate-500 font-semibold">
                Correct Answer (must match an option)
                <input
                  value={goldForm.correctAnswer}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, correctAnswer: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs text-slate-500 font-semibold">
                Difficulty
                <input
                  value={goldForm.difficulty}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, difficulty: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs text-slate-500 font-semibold md:col-span-2">
                Explanation
                <textarea
                  value={goldForm.explanation}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, explanation: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs text-slate-500 font-semibold md:col-span-2">
                Study Concepts (comma-separated)
                <input
                  value={goldForm.studyConceptsText}
                  onChange={(e) => setGoldForm((prev) => ({ ...prev, studyConceptsText: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700"
                />
              </label>
            </div>
            {goldFormError && (
              <div className="mt-3 text-xs text-rose-600 font-semibold">{goldFormError}</div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleSaveGoldQuestion}
                disabled={goldFormSaving}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-60"
              >
                {goldFormSaving ? 'Saving…' : editingGoldId ? 'Update Gold Question' : 'Save Gold Question'}
              </button>
            </div>
          </div>
        )}

        {isBulkImportOpen && (
          <div className="mt-4 border border-slate-200 rounded-2xl p-4 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">Bulk Import</div>
              <div className="flex items-center gap-2">
                <select
                  value={bulkImportModule}
                  onChange={(e) => setBulkImportModule(e.target.value as 'heme' | 'pulm')}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-600 font-semibold uppercase tracking-widest"
                >
                  <option value="heme">Heme Default</option>
                  <option value="pulm">Pulm Default</option>
                </select>
                <button
                  onClick={() => bulkImportInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50"
                >
                  Upload JSON/CSV
                </button>
                <input
                  ref={bulkImportInputRef}
                  type="file"
                  accept=".json,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setBulkImportText(String(reader.result || ''));
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            <textarea
              value={bulkImportText}
              onChange={(e) => setBulkImportText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700"
              placeholder="Paste JSON array or CSV with headers: module,questionText,optionA..optionE,correctAnswer,explanation,studyConcepts,difficulty,status"
            />
            {bulkImportStatus && (
              <div className="mt-2 text-xs text-slate-500">{bulkImportStatus}</div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleBulkImport}
                disabled={bulkImportRunning}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-60"
              >
                {bulkImportRunning ? 'Importing…' : 'Import Questions'}
              </button>
              <button
                onClick={() => {
                  setBulkImportText('');
                  setBulkImportStatus(null);
                }}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {goldError && (
          <div className="mt-3 text-xs text-rose-600 font-semibold">{goldError}</div>
        )}

        {goldLoading && (
          <div className="mt-4 text-sm text-slate-400">Loading gold questions…</div>
        )}

        {!goldLoading && filteredGoldQuestions.length === 0 && (
          <div className="mt-4 text-sm text-slate-400">No gold questions found.</div>
        )}

        {filteredGoldQuestions.length > 0 && (
          <div className="mt-4 space-y-3">
            {filteredGoldQuestions.map((row) => {
              const stem = row.question?.questionText || 'Question text unavailable.';
              return (
                <div key={row.id} className="border border-slate-200 rounded-2xl p-4 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800 line-clamp-2">{stem}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">
                        {row.module.toUpperCase()} • {row.status.toUpperCase()} • {formatDate(row.created_at || undefined)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => openGoldEditor(row)}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      {row.status === 'draft' ? (
                        <button
                          onClick={() => handleApproveGoldQuestion(row.id)}
                          className="px-3 py-1.5 rounded-xl border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-50"
                        >
                          Approve
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRevokeGoldQuestion(row.id)}
                          className="px-3 py-1.5 rounded-xl border border-amber-200 text-amber-700 text-[10px] font-black uppercase tracking-widest hover:bg-amber-50"
                        >
                          Revert
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteGoldQuestion(row.id)}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 text-[10px] font-black uppercase tracking-widest hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Seeded Prefab Library</div>
            <h3 className="text-lg font-bold text-slate-800 mt-1">All Prefabbed Questions</h3>
            <p className="text-sm text-slate-500 mt-1">Browse every seeded guide and open full question details.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleReseedAllPrefabs}
              disabled={isReseedAllRunning}
              className="px-3 py-2 rounded-xl border border-amber-200 text-amber-700 text-xs font-black uppercase tracking-widest hover:bg-amber-50 flex items-center gap-2 disabled:opacity-60"
            >
              {isReseedAllRunning ? 'Reseeding…' : 'Reseed All'}
            </button>
            <button
              onClick={loadPrefabSummaries}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-xs font-black uppercase tracking-widest hover:bg-slate-50 flex items-center gap-2"
            >
              <ArrowPathIcon className={`w-4 h-4 ${isPrefabLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center mb-4">
          <input
            type="text"
            value={prefabSearch}
            onChange={(e) => setPrefabSearch(e.target.value)}
            placeholder="Search guides..."
            className="flex-1 min-w-[220px] px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
          />
          <div className="text-xs text-slate-400">
            {filteredPrefabs.length} guides
          </div>
        </div>

        {reseedNotice && (
          <div className="mb-3 text-xs font-semibold text-amber-700">{reseedNotice}</div>
        )}
        {prefabError && (
          <div className="mb-4 text-xs text-rose-600 font-semibold">{prefabError}</div>
        )}

        {isPrefabLoading && (
          <div className="text-sm text-slate-400">Loading prefab sets…</div>
        )}

        {!isPrefabLoading && filteredPrefabs.length === 0 && (
          <div className="text-sm text-slate-400">No prefab sets found.</div>
        )}

        {filteredPrefabs.length > 0 && (
          <div className="space-y-3">
            {filteredPrefabs.map((prefab) => (
              <div key={prefab.guideHash} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{prefab.guideTitle}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                      {prefab.itemCount} items • {formatDate(prefab.createdAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => openPrefabDrawer(prefab.guideHash)}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50"
                  >
                    View Questions
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Top flagged questions</h3>
          {topQuestions.length === 0 ? (
            <p className="text-sm text-slate-400">No reports yet.</p>
          ) : (
            <div className="space-y-4">
              {topQuestions.map((item, idx) => (
                <button
                  key={item.questionId}
                  onClick={() => openDrawerForQuestion(item.questionId)}
                  className="w-full text-left flex items-start gap-4 rounded-2xl p-2 -m-2 hover:bg-slate-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-black text-sm">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-800 line-clamp-2">{item.text}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black mt-1">
                      {item.count} reports • {maskId(item.questionId)}
                    </div>
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">View</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Tag heatmap</h3>
          {tagCounts.length === 0 ? (
            <p className="text-sm text-slate-400">No tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagCounts.map(([tag, count]) => (
                <span
                  key={tag}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-50 border border-slate-200 text-slate-600"
                >
                  {tag} • {count}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Recent reports</h3>
        {recentReports.length === 0 ? (
          <p className="text-sm text-slate-400">No reports captured yet.</p>
        ) : (
          <div className="space-y-4">
            {recentReports.map(row => {
              const questionText = row.payload?.question?.questionText || 'Question text unavailable';
              return (
                <button
                  key={row.id}
                  onClick={() => openDrawerForQuestion(row.question_id)}
                  className="w-full text-left p-4 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {isAppBug(row.tags) ? 'App/UX bug' : 'Content report'} • {maskId(row.user_id)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                      {formatDate(row.created_at)}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-800 line-clamp-2">{questionText}</div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(row.tags || []).map(tag => (
                      <span key={tag} className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {row.comment && (
                    <div className="mt-3 text-sm text-slate-600">{row.comment}</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isDrawerOpen && selectedQuestionId && (
        <div className="fixed inset-0 z-[200]">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setIsDrawerOpen(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-none md:max-w-[520px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Question Detail</div>
                <div className="text-sm font-semibold text-slate-700">{maskId(selectedQuestionId)}</div>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-400"
                aria-label="Close drawer"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Question</div>
                <div className="text-sm font-semibold text-slate-800 leading-relaxed">
                  {questionPayload?.questionText || 'Question text unavailable.'}
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-3">
                  Difficulty • {questionPayload?.difficulty || '—'}
                </div>
              </div>

              {Array.isArray(questionPayload?.options) && questionPayload.options.length > 0 ? (
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Options</div>
                  <div className="space-y-2">
                    {questionPayload.options.map((option: string, idx: number) => {
                      const isCorrect = option === questionPayload.correctAnswer;
                      return (
                        <div
                          key={`${option}-${idx}`}
                          className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                            isCorrect
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >
                          {option}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Correct Answer</div>
                <div className="text-sm font-semibold text-emerald-700">
                  {questionPayload?.correctAnswer || '—'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Explanation</div>
                <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {questionPayload?.explanation || '—'}
                </div>
              </div>

              {Array.isArray(questionPayload?.studyConcepts) && questionPayload.studyConcepts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {questionPayload.studyConcepts.map((concept: string) => (
                    <span
                      key={concept}
                      className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Reports</div>
                  <div className="text-lg font-black text-slate-800">{questionMetrics?.totalReports ?? 0}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Avg rating</div>
                  <div className="text-lg font-black text-slate-800">
                    {questionMetrics?.avgRating === null || questionMetrics?.avgRating === undefined
                      ? '—'
                      : questionMetrics.avgRating.toFixed(2)}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Accuracy</div>
                  <div className="text-lg font-black text-slate-800">
                    {questionMetrics?.accuracy === null || questionMetrics?.accuracy === undefined
                      ? '—'
                      : `${questionMetrics.accuracy.toFixed(1)}%`}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Avg time</div>
                  <div className="text-lg font-black text-slate-800">{formatMs(questionMetrics?.avgTime ?? null)}</div>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Feedback timeline</div>
                <div className="space-y-3">
                  {questionRows.length === 0 ? (
                    <div className="text-sm text-slate-400">No feedback found.</div>
                  ) : (
                    questionRows.map(row => (
                      <div key={row.id} className="border border-slate-200 rounded-2xl p-4 bg-white">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            row.kind === 'rating' ? 'bg-indigo-50 text-indigo-600' : 'bg-rose-50 text-rose-600'
                          }`}>
                            {row.kind === 'rating' ? 'Rating' : isAppBug(row.tags) ? 'App bug' : 'Report'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                            {formatDate(row.created_at)}
                          </span>
                        </div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          User {maskId(row.user_id)}
                        </div>
                        <div className="mt-2 text-sm text-slate-700">
                          {row.comment || '—'}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {(row.tags || []).length > 0 ? (
                            row.tags?.map(tag => (
                              <span key={tag} className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-500">
                                {tag}
                              </span>
                            ))
                          ) : (
                            <span className="text-[9px] text-slate-400 uppercase font-black tracking-widest">No tags</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-3 text-[11px] text-slate-500">
                          <div>Rating: {row.rating ?? '—'}</div>
                          <div>Correct: {row.is_correct === null ? '—' : row.is_correct ? 'Yes' : 'No'}</div>
                          <div>Time: {formatMs(row.time_spent_ms)}</div>
                          <div>Selected: {row.selected_option || '—'}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isPrefabDrawerOpen && selectedPrefabHash && (
        <div className="fixed inset-0 z-[210]">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={closePrefabDrawer}
          />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-none md:max-w-[620px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Prefab Guide</div>
                <div className="text-sm font-semibold text-slate-700">{selectedPrefab?.guideTitle || 'Loading...'}</div>
                {selectedPrefab?.createdAt && (
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                    {formatDate(selectedPrefab.createdAt)} • {activePrefabCount} active • {selectedPrefab.questions.length} total
                  </div>
                )}
              </div>
              <button
                onClick={closePrefabDrawer}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-400"
                aria-label="Close prefab drawer"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {!selectedPrefab && (
                <div className="text-sm text-slate-400">Loading questions…</div>
              )}

              {selectedPrefab && selectedPrefab.questions.length === 0 && (
                <div className="text-sm text-slate-400">No questions found for this guide.</div>
              )}

              {selectedPrefab?.questions.map((question, idx) => {
                const isRetired = question.adminReview?.status === 'retired';
                const slotNumber = Number.isFinite(question.prefabIndex) ? (question.prefabIndex as number) + 1 : idx + 1;
                const isWorking = Boolean(reviewLoading[question.id]);
                const reasonValue = getReasonValue(question.id);
                return (
                  <div key={`${question.id}-${idx}`} className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50">
                    <div className="flex items-start justify-between mb-3 gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Slot {slotNumber}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            isRetired ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                          }`}
                        >
                          {isRetired ? 'Retired' : 'Active'}
                        </span>
                        {question.adminReview?.replacedFromId && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-600">
                            Replacement
                          </span>
                        )}
                      </div>
                      {question.sourceItemTitle && (
                        <div className="text-[10px] text-slate-500 font-semibold">
                          {question.sourceItemTitle}
                        </div>
                      )}
                    </div>

                    <div className="text-sm font-semibold text-slate-800 leading-relaxed mb-3 whitespace-pre-wrap">
                      {question.questionText}
                    </div>

                    {Array.isArray(question.options) && question.options.length > 0 ? (
                      <div className="space-y-2 mb-4">
                        {question.options.map((option, optIdx) => {
                          const isCorrect = option === question.correctAnswer;
                          return (
                            <div
                              key={`${option}-${optIdx}`}
                              className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                                isCorrect
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-200 bg-white text-slate-600'
                              }`}
                            >
                              {option}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="mb-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Correct Answer</div>
                      <div className="text-sm font-semibold text-emerald-700">{question.correctAnswer}</div>
                    </div>

                    <div className="mb-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Explanation</div>
                      <div className="text-sm text-slate-600 whitespace-pre-wrap">{question.explanation}</div>
                    </div>

                    {Array.isArray(question.studyConcepts) && question.studyConcepts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {question.studyConcepts.map((concept) => (
                          <span
                            key={concept}
                            className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500"
                          >
                            {concept}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Admin Review</div>
                      {!isRetired ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select
                              value={reasonValue}
                              onChange={(e) => setReviewReasons((prev) => ({ ...prev, [question.id]: e.target.value }))}
                              className="px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-600 bg-white"
                            >
                              {removalReasons.map((reason) => (
                                <option key={reason} value={reason}>{reason}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={reviewNotes[question.id] ?? question.adminReview?.note ?? ''}
                              onChange={(e) => setReviewNotes((prev) => ({ ...prev, [question.id]: e.target.value }))}
                              placeholder="Optional note (required if Other)"
                              className="px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-600"
                            />
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[10px] text-slate-400">
                              Note required when reason is “Other”.
                            </div>
                            <button
                              onClick={() => handleRetireReplace(question.id)}
                              disabled={isWorking}
                              className="px-4 py-2 rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
                            >
                              {isWorking ? 'Working…' : 'Retire & Replace'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-500">
                            Reason: <span className="font-semibold text-slate-700">{question.adminReview?.reason || '—'}</span>
                          </div>
                          {question.adminReview?.note && (
                            <div className="text-xs text-slate-500">
                              Note: <span className="font-semibold text-slate-700">{question.adminReview.note}</span>
                            </div>
                          )}
                          {question.adminReview?.replacedById && (
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                              Replacement: {maskId(question.adminReview.replacedById)}
                            </div>
                          )}
                          <div className="flex items-center justify-end">
                            <button
                              onClick={() => handleRestoreQuestion(question.id)}
                              disabled={isWorking}
                              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-60"
                            >
                              {isWorking ? 'Working…' : 'Restore'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {isDeepDiveDrawerOpen && selectedDeepDiveMeta && (
        <div className="fixed inset-0 z-[220]">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={closeDeepDiveDrawer}
          />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-none md:max-w-[680px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Deep Dive Prefab</div>
                <div className="text-sm font-semibold text-slate-700">{selectedDeepDiveMeta.concept}</div>
                <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                  {selectedDeepDiveMeta.source}
                  {selectedDeepDive?.createdAt ? ` • ${formatDate(selectedDeepDive.createdAt)}` : ''}
                  {selectedDeepDive?.model ? ` • ${selectedDeepDive.model}` : ''}
                </div>
              </div>
              <button
                onClick={closeDeepDiveDrawer}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-400"
                aria-label="Close deep dive drawer"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {isDeepDiveDrawerLoading && (
                <div className="text-sm text-slate-400">Loading deep dive content…</div>
              )}
              {deepDiveDrawerError && (
                <div className="text-sm text-rose-600 font-semibold">{deepDiveDrawerError}</div>
              )}
              {!isDeepDiveDrawerLoading && !deepDiveDrawerError && selectedDeepDive && (
                <>
                  {selectedDeepDive.lessonContent && (
                    <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                        Lesson Preview
                      </div>
                      <div className="text-sm text-slate-700 whitespace-pre-wrap">
                        {selectedDeepDive.lessonContent}
                      </div>
                    </div>
                  )}

                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Questions • {selectedDeepDive.quiz.length}
                  </div>

                  {selectedDeepDive.quiz.length === 0 && (
                    <div className="text-sm text-slate-400">No questions found for this deep dive.</div>
                  )}

                  {selectedDeepDive.quiz.map((question, idx) => (
                    <div key={`${question.id || 'dd'}-${idx}`} className="border border-slate-200 rounded-2xl p-5 bg-white">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                        Question {idx + 1}
                      </div>
                      <div className="text-sm font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap mb-3">
                        {question.questionText}
                      </div>
                      {Array.isArray(question.options) && question.options.length > 0 && (
                        <div className="space-y-2 mb-4">
                          {question.options.map((option, optIdx) => {
                            const isCorrect = option === question.correctAnswer;
                            return (
                              <div
                                key={`${option}-${optIdx}`}
                                className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
                                  isCorrect
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : 'border-slate-200 bg-white text-slate-600'
                                }`}
                              >
                                {option}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="mb-4">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Correct Answer</div>
                        <div className="text-sm font-semibold text-emerald-700">{question.correctAnswer}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Explanation</div>
                        <div className="text-sm text-slate-600 whitespace-pre-wrap">{question.explanation}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BetaAnalyticsView;
