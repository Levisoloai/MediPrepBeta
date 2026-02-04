
import { createClient } from '@supabase/supabase-js';
import { Subject, Question, StoredQuestion, StudyFile, SRSData, ConceptMastery, ChatMessage } from '../types';

// NOTE: These environment variables need to be set in your Vercel/Cloud project
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Initialize client only if keys are present (prevents crash in local-only mode)
const supabase = (SUPABASE_URL && SUPABASE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

/**
 * Cloud Implementation of Storage Service
 * Designed to replace 'storageService.ts' when ready for migration.
 */

// --- Subjects ---

export const getSubjects = async (): Promise<Subject[]> => {
  if (!supabase) throw new Error("Supabase client not initialized");
  
  const { data: subjects, error } = await supabase
    .from('subjects')
    .select(`
      *,
      study_files (*)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Map DB structure to App structure
  // Note: Real file content isn't downloaded immediately to save bandwidth.
  // We'll need to fetch file content on demand (presigned URLs) in the full implementation.
  return subjects.map((s: any) => ({
    id: s.id,
    name: s.name,
    dateCreated: new Date(s.created_at).getTime(),
    lectureFiles: s.study_files.filter((f: any) => f.file_type === 'lecture').map(mapFile),
    studyGuideFiles: s.study_files.filter((f: any) => f.file_type === 'blueprint').map(mapFile),
    chatHistory: [] // Chat history would need a separate table or JSONB column
  }));
};

const mapFile = (dbFile: any): StudyFile => ({
  name: dbFile.file_name,
  mimeType: dbFile.mime_type || 'application/pdf',
  data: '' // Content is lazy-loaded in cloud version
});

export const saveSubject = async (name: string, lectures: StudyFile[], guides: StudyFile[], id?: string): Promise<Subject | null> => {
  if (!supabase) return null;
  
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("User must be logged in");

  let subjectId = id;

  if (!subjectId) {
    const { data, error } = await supabase
      .from('subjects')
      .insert({ name, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    subjectId = data.id;
  }

  // File Upload Logic would go here
  // 1. Upload Blob to Supabase Storage
  // 2. Insert record into 'study_files' table
  
  return { 
    id: subjectId!, 
    name, 
    lectureFiles: lectures, 
    studyGuideFiles: guides, 
    dateCreated: Date.now(), 
    chatHistory: [] 
  };
};

// --- Questions ---

export const getStoredQuestions = async (): Promise<StoredQuestion[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('questions')
    .select(`
      *,
      srs_progress!inner(*)
    `);
    
  if (error) {
    console.error(error);
    return [];
  }

  return data.map((q: any) => ({
    id: q.id,
    type: q.question_type,
    questionText: q.question_text,
    options: q.options,
    correctAnswer: q.correct_answer,
    explanation: q.explanation,
    studyConcepts: q.study_concepts,
    difficulty: q.difficulty,
    cardStyle: q.card_style,
    
    // Stored props
    subjectId: q.subject_id,
    dateCreated: new Date(q.created_at).getTime(),
    attempts: q.srs_progress[0]?.attempts || 0,
    correctCount: q.srs_progress[0]?.correct_count || 0,
    srs: {
      interval: q.srs_progress[0]?.interval || 0,
      repetition: q.srs_progress[0]?.repetition || 0,
      easeFactor: q.srs_progress[0]?.ease_factor || 2.5,
      learningStep: q.srs_progress[0]?.learning_step || 0,
      nextReviewDate: new Date(q.srs_progress[0]?.next_review_date).getTime(),
      lastReviewed: q.srs_progress[0]?.last_reviewed_date ? new Date(q.srs_progress[0]?.last_reviewed_date).getTime() : null,
    }
  }));
};

export const saveBatchQuestions = async (questions: Question[], subjectId?: string): Promise<number> => {
  if (!supabase) return 0;
  
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return 0;

  // 1. Insert Questions
  const questionsPayload = questions.map(q => ({
    user_id: user.id,
    subject_id: subjectId,
    question_text: q.questionText,
    question_type: q.type,
    difficulty: q.difficulty,
    options: q.options,
    correct_answer: q.correctAnswer,
    explanation: q.explanation,
    study_concepts: q.studyConcepts,
    card_style: q.cardStyle || 'BASIC'
  }));

  const { data: insertedQuestions, error: qError } = await supabase
    .from('questions')
    .insert(questionsPayload)
    .select('id');

  if (qError || !insertedQuestions) throw qError;

  // 2. Initialize SRS for each
  const srsPayload = insertedQuestions.map(iq => ({
    user_id: user.id,
    question_id: iq.id,
    next_review_date: new Date().toISOString() // Ready immediately
  }));

  const { error: srsError } = await supabase.from('srs_progress').insert(srsPayload);
  if (srsError) throw srsError;

  return insertedQuestions.length;
};

// --- SRS & Mastery ---

export const processReview = async (questionId: string, rating: 1 | 2 | 3 | 4): Promise<void> => {
  // Use the exact same algorithm logic as local, but write to DB
  // This function would fetch the current SRS state from DB, calc new interval, and update
  console.log("Cloud SRS update not fully implemented in this stub.");
};

export const getConceptMastery = async (): Promise<ConceptMastery[]> => {
  if (!supabase) return [];
  
  const { data, error } = await supabase.from('concept_mastery').select('*');
  if (error) return [];

  return data.map((m: any) => ({
    concept: m.concept,
    attempts: m.total_attempts,
    correct: m.correct_attempts,
    lastTested: new Date(m.last_tested_date).getTime()
  }));
};
