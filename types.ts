
export enum QuestionType {
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  DESCRIPTIVE = 'DESCRIPTIVE',
  TRUE_FALSE = 'TRUE_FALSE',
  FLASHCARD = 'FLASHCARD'
}

export enum CardStyle {
  BASIC = 'BASIC', 
  CLOZE = 'CLOZE'  
}

export enum DifficultyLevel {
  EASY = 'Easy',
  MEDIUM = 'Medium',
  HARD = 'Hard',
  CLINICAL_VIGNETTE = 'Clinical Vignette (USMLE Style)'
}

export enum ExamFormat {
  IN_HOUSE = 'IN_HOUSE',
  NBME = 'NBME'
}

export enum WardMode {
  LEARNING = 'LEARNING',
  EXAM = 'EXAM'
}

export interface QuestionState {
  selectedOption: string | null;
  showAnswer: boolean;
  struckOptions: number[];
}

export interface Question {
  id: string;
  type: QuestionType;
  questionText: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  studyConcepts: string[];
  difficulty: string;
  sourceType?: 'generated' | 'gold' | 'prefab' | 'deep-dive' | 'histology';
  abVariant?: 'gold' | 'guide' | 'mixed';
  guideHash?: string;
  histology?: {
    id: string;
    title: string;
    imageUrl: string;
    imageCrop?: 'center' | 'none';
    caption?: string;
    source?: string;
    sourceUrl?: string;
    license?: string;
    licenseUrl?: string;
    attribution?: string;
  };
  cardStyle?: CardStyle;
  sourceItemId?: string;
  sourceItemTitle?: string;
  prefabIndex?: number;
  adminReview?: {
    status: 'active' | 'retired';
    reason?: string;
    note?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    replacedById?: string;
    replacedFromId?: string;
  };
}

export interface GoldQuestionRow {
  id: string;
  module: 'heme' | 'pulm';
  status: 'draft' | 'approved';
  question: Question;
  author_id?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at?: string | null;
}

export type FeedbackKind = 'rating' | 'bug';

export type FeedbackTag =
  | 'Incorrect'
  | 'Out-of-scope'
  | 'Ambiguous'
  | 'Poor explanation'
  | 'Formatting/typo'
  | 'Too easy'
  | 'Too hard'
  | 'Other'
  | 'App bug';

export interface QuestionFeedbackPayload {
  question: Question;
  state: {
    selectedOption: string | null;
    showAnswer: boolean;
    struckOptions: number[];
    highlights: string[];
  };
  metrics: {
    timeSpentMs: number;
    timeToAnswerMs: number | null;
    timeToRevealMs: number | null;
  };
  meta: {
    questionIndex: number;
    capturedAt: string;
    experiment?: {
      name: string;
      variant: string;
      guideHash?: string;
    };
  };
}

export interface QuestionFeedbackInput {
  userId: string;
  questionId: string;
  kind: FeedbackKind;
  rating?: number | null;
  tags?: FeedbackTag[] | null;
  comment?: string | null;
  selectedOption?: string | null;
  isCorrect?: boolean | null;
  timeSpentMs?: number | null;
  payload: QuestionFeedbackPayload;
}

export interface BlueprintTopic {
  topic: string;
  itemCount: number;
  explanation?: string;
  questions?: Question[];
  status?: 'pending' | 'generating' | 'completed' | 'error';
}

export interface SRSData {
  interval: number;
  repetition: number;
  easeFactor: number;
  nextReviewDate: number; 
  lastReviewed: number | null;
  learningStep: number; 
}

export interface StoredQuestion extends Question {
  srs: SRSData;
  dateCreated: number;
  attempts: number;
  correctCount: number;
  subjectId?: string;
}

export interface ConceptMastery {
  concept: string;
  attempts: number;
  correct: number;
  lastTested: number;
}

export interface StudyFile {
  name: string;
  mimeType: string;
  data: string; 
}

export interface StudyGuideItem {
  id: string;
  title: string;
  content: string;
  contentHash: string;
}

export interface PrefabQuestionSet {
  guideHash: string;
  guideTitle: string;
  items: StudyGuideItem[];
  questions: Question[];
  createdAt: string;
  promptVersion: string;
  model: string;
}

export interface HistologyEntry {
  id: string;
  module: 'heme' | 'pulm';
  title: string;
  vignette?: string;
  imageCrop?: 'center' | 'none';
  caption: string;
  keywords: string[];
  conceptTags: string[];
  requiredAny?: string[];
  excludeAny?: string[];
  imageUrl: string;
  source: string;
  sourceUrl?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface Subject {
  id: string;
  name: string;
  lectureFiles: StudyFile[];
  studyGuideFiles: StudyFile[]; 
  dateCreated: number;
  chatHistory: ChatMessage[];
}

export interface UserPreferences {
  generationMode: 'questions' | 'summary';
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  questionCount: number;
  autoQuestionCount: boolean;
  sessionStyle?: 'practice' | 'block';
  sessionMode?: 'standard' | 'funnel';
  customInstructions: string;
  focusedOnWeakness: boolean;
  weakConcepts?: string[];
  examFormat: ExamFormat;
  cardStyle: CardStyle;
}

// --- SCHEDULE TYPES ---

export interface StudyPlanItem {
  date: string;
  activityName: string;
  type: 'LECTURE' | 'EXAM' | 'STUDY' | 'CLINICAL';
  suggestedTopic: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
}

export interface StudyPlan {
  id: string;
  items: StudyPlanItem[];
  created_at: string;
}

// --- VIRTUAL WARD TYPES ---

export interface CaseVitals {
  hr: string;
  bp: string;
  rr: string;
  temp: string;
  o2: string;
  weight: string;
}

export interface ClinicalCase {
  id: string;
  patientName: string;
  age: number;
  gender: string;
  chiefComplaint: string;
  vitals: CaseVitals;
  appearance: string;
  hiddenDiagnosis: string;
  hiddenPathology: string;
}

export interface CaseLabResult {
  testName: string;
  result: string;
  flag: 'normal' | 'high' | 'low' | 'critical';
}

export interface CaseEvaluation {
  score: number; 
  correctDiagnosis: string;
  userDiagnosis: string;
  feedback: string; 
  missedSteps: string[];
  criticalErrors: string[];
}
