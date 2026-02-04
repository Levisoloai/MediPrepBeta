
import { Question, StoredQuestion, SRSData, ConceptMastery, Subject, StudyFile, QuestionType, CardStyle, ChatMessage, BlueprintTopic, StudyPlanItem } from '../types';
import { supabase } from './supabaseClient';

// --- LOCAL DB CONSTANTS (Fallback) ---
const DB_NAME = 'MediPrepDB';
const DB_VERSION = 3; 
const STORE_QUESTIONS = 'questions';
const STORE_SUBJECTS = 'subjects';
const STORE_MASTERY = 'mastery';
const STORE_BLUEPRINTS = 'blueprint_sessions';
const STORE_PLANS = 'study_plans';

const INITIAL_SRS_DATA: SRSData = {
  interval: 0,
  repetition: 0,
  easeFactor: 2.5,
  nextReviewDate: Date.now(),
  lastReviewed: null,
  learningStep: 0
};

// --- UTILS ---
const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const getUser = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user || null;
  } catch (e) {
    return null;
  }
};

const ensureProfile = async (user: any) => {
  if (!user) return;
  try {
    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0]
    }, { onConflict: 'id', ignoreDuplicates: true });
    
    if (error) console.warn("Profile sync warning:", error.message);
  } catch (e) {
    console.warn("Profile sync failed:", e);
  }
};

// --- SUBSCRIPTION HANDLING ---

export const getSubscriptionStatus = async (): Promise<'active' | 'inactive'> => {
  const user = await getUser();
  if (!user) return 'inactive';
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_status')
      .eq('id', user.id)
      .single();
      
    if (error || !data) return 'inactive';
    return data.subscription_status === 'active' ? 'active' : 'inactive';
  } catch (e) {
    return 'inactive';
  }
};

export const simulateSubscriptionUpgrade = async (): Promise<void> => {
  const user = await getUser();
  if (!user) throw new Error("No user logged in");
  
  // This simulates a webhook update from Stripe
  await ensureProfile(user);
  const { error } = await supabase
    .from('profiles')
    .update({ subscription_status: 'active' })
    .eq('id', user.id);
    
  if (error) throw error;
};

// --- DB OPEN ---

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_QUESTIONS)) db.createObjectStore(STORE_QUESTIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SUBJECTS)) db.createObjectStore(STORE_SUBJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MASTERY)) db.createObjectStore(STORE_MASTERY, { keyPath: 'concept' });
      if (!db.objectStoreNames.contains(STORE_BLUEPRINTS)) db.createObjectStore(STORE_BLUEPRINTS, { keyPath: 'subjectId' });
      if (!db.objectStoreNames.contains(STORE_PLANS)) db.createObjectStore(STORE_PLANS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// --- STUDY PLAN PERSISTENCE ---

export const getLatestStudyPlan = async (): Promise<StudyPlanItem[] | null> => {
  const user = await getUser();
  if (user) {
    try {
      const { data, error } = await supabase
        .from('study_plans')
        .select('items')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (!error && data) return data.items;
    } catch (e) {}
  }
  return null;
};

export const saveStudyPlan = async (items: StudyPlanItem[], subjectId?: string): Promise<void> => {
  const user = await getUser();
  if (user) {
    try {
      await ensureProfile(user);
      const { error } = await supabase.from('study_plans').insert({
        user_id: user.id,
        subject_id: subjectId,
        items: items
      });
      if (error) throw error;
    } catch (e) {
      console.warn("Cloud study plan save failed", e);
    }
  }
  
  const db = await openDB();
  const tx = db.transaction(STORE_PLANS, 'readwrite');
  tx.objectStore(STORE_PLANS).put({ id: 'latest', items, timestamp: Date.now() });
};

export const deleteStudyPlan = async (): Promise<void> => {
  const user = await getUser();
  if (user) await supabase.from('study_plans').delete().eq('user_id', user.id);
  const db = await openDB();
  const tx = db.transaction(STORE_PLANS, 'readwrite');
  tx.objectStore(STORE_PLANS).delete('latest');
};

// --- (rest of the existing storage functions) ---
export const getSubjects = async (): Promise<Subject[]> => {
  const user = await getUser();
  if (user) {
    try {
      const { data, error } = await supabase
        .from('subjects')
        .select(`
          id, name, created_at, user_id,
          study_files (id, file_name, file_type, mime_type)
        `)
        .order('created_at', { ascending: false });
        
      if (error) throw error;

      return data.map((s: any) => ({
        id: s.id,
        name: s.name,
        dateCreated: new Date(s.created_at).getTime(),
        lectureFiles: s.study_files.filter((f: any) => f.file_type === 'lecture').map((dbFile: any) => ({
            name: dbFile.file_name,
            mimeType: dbFile.mime_type || 'application/pdf',
            data: '' 
        })),
        studyGuideFiles: s.study_files.filter((f: any) => f.file_type === 'blueprint').map((dbFile: any) => ({
            name: dbFile.file_name,
            mimeType: dbFile.mime_type || 'application/pdf',
            data: '' 
        })),
        chatHistory: []
      }));
    } catch (error) {
      console.error("Cloud fetch error (getSubjects):", error);
    }
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SUBJECTS, 'readonly');
    const store = transaction.objectStore(STORE_SUBJECTS);
    const request = store.getAll();
    request.onsuccess = () => {
      const results: Subject[] = request.result.map((sub: any) => {
        if (!sub.studyGuideFiles) sub.studyGuideFiles = sub.studyGuideFile ? [sub.studyGuideFile] : [];
        return sub as Subject;
      });
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getSubjectDetails = async (subjectId: string): Promise<Subject | null> => {
  const user = await getUser();

  if (user) {
    try {
      const { data: subject, error: subjectError } = await supabase
        .from('subjects')
        .select(`
          *,
          study_files (id, file_name, file_type, mime_type, storage_path)
        `)
        .eq('id', subjectId)
        .single();
        
      if (subjectError) throw subjectError;
      if (!subject) throw new Error("Subject data not found");

      const filesWithData = await Promise.all(subject.study_files.map(async (fileMeta: any) => {
         try {
           const { data, error } = await supabase.storage
             .from('study-materials')
             .download(fileMeta.storage_path);
           
           if (error) throw error;
           if (!data) return { ...fileMeta, dataStr: '' };
           const base64Data = await blobToBase64(data);
           return { ...fileMeta, dataStr: base64Data };
         } catch (e) {
           console.warn(`Failed to download content for ${fileMeta.file_name}`, e);
           return { ...fileMeta, dataStr: '' };
         }
      }));

      return {
        id: subject.id,
        name: subject.name,
        dateCreated: new Date(subject.created_at).getTime(),
        lectureFiles: filesWithData.filter((f: any) => f.file_type === 'lecture').map(mapCloudFile),
        studyGuideFiles: filesWithData.filter((f: any) => f.file_type === 'blueprint').map(mapCloudFile),
        chatHistory: []
      };
    } catch (error: any) {
      console.error("Cloud detail fetch error:", error);
    }
  }

  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_SUBJECTS, 'readonly');
    const store = tx.objectStore(STORE_SUBJECTS);
    const req = store.get(subjectId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
};

const mapCloudFile = (dbFile: any): StudyFile => ({
  name: dbFile.file_name,
  mimeType: dbFile.mime_type || 'application/pdf',
  data: dbFile.dataStr || '' 
});

export const saveSubject = async (name: string, lectures: StudyFile[], guides: StudyFile[] | StudyFile | null, id?: string): Promise<Subject | null> => {
  const user = await getUser();
  let normalizedGuides: StudyFile[] = [];
  if (Array.isArray(guides)) normalizedGuides = guides;
  else if (guides) normalizedGuides = [guides];

  if (user) {
    try {
      await ensureProfile(user);
      let subjectId = id;
      
      if (!subjectId) {
        const { data, error } = await supabase
          .from('subjects')
          .insert({ name, user_id: user.id })
          .select()
          .single();
        if (error) throw new Error(error.message || "Failed to create subject");
        subjectId = data.id;
      }

      const allFiles = [
        ...lectures.map(f => ({ ...f, type: 'lecture' })),
        ...normalizedGuides.map(f => ({ ...f, type: 'blueprint' }))
      ];

      for (const file of allFiles) {
        const fileBlob = base64ToBlob(file.data, file.mimeType);
        const filePath = `${user.id}/${subjectId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;

        const { error: uploadError } = await supabase.storage
          .from('study-materials')
          .upload(filePath, fileBlob);

        if (uploadError) {
          console.error(`Failed to upload ${file.name}`, uploadError);
          continue; 
        }

        const { error: dbError } = await supabase.from('study_files').insert({
          subject_id: subjectId,
          user_id: user.id,
          file_name: file.name,
          file_type: file.type,
          storage_path: filePath, 
          mime_type: file.mimeType
        });
        if (dbError) console.error("Failed to insert file record", dbError);
      }

      return {
        id: subjectId!,
        name,
        lectureFiles: lectures,
        studyGuideFiles: normalizedGuides,
        dateCreated: Date.now(),
        chatHistory: []
      };
    } catch (error: any) {
      console.error("Cloud save failed:", error.message || error);
    }
  }

  try {
    const db = await openDB();
    const subject: Subject = {
      id: id || `sub_${Date.now()}`,
      name,
      lectureFiles: lectures,
      studyGuideFiles: normalizedGuides,
      dateCreated: Date.now(),
      chatHistory: []
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_SUBJECTS, 'readwrite');
      const store = transaction.objectStore(STORE_SUBJECTS);
      const request = store.put(subject);
      request.onsuccess = () => resolve(subject);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Local save failed", error);
    return null;
  }
};

export const deleteSubject = async (id: string): Promise<void> => {
  const user = await getUser();
  if (user) {
    try {
      const { data: files } = await supabase.from('study_files').select('storage_path').eq('subject_id', id);
      if (files && files.length > 0) {
        const paths = files.map(f => f.storage_path);
        await supabase.storage.from('study-materials').remove(paths);
      }
      const { error } = await supabase.from('subjects').delete().eq('id', id);
      if (error) throw error;
      return;
    } catch (error) {
      console.warn("Cloud delete failed, trying local:", error);
    }
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SUBJECTS, 'readwrite');
    const store = transaction.objectStore(STORE_SUBJECTS);
    store.delete(id);
    transaction.oncomplete = () => resolve();
  });
};

export const updateSubjectChatHistory = async (id: string, history: ChatMessage[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_SUBJECTS, 'readwrite');
    const store = transaction.objectStore(STORE_SUBJECTS);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        const sub = getReq.result;
        sub.chatHistory = history;
        store.put(sub);
      }
      resolve();
    };
  });
};

export const getBlueprintSession = async (subjectId: string): Promise<BlueprintTopic[] | null> => {
  const user = await getUser();
  if (user) {
    try {
      const { data, error } = await supabase
        .from('blueprint_sessions')
        .select('breakdown_data')
        .eq('subject_id', subjectId)
        .single();
      if (!error && data) return data.breakdown_data;
    } catch (error) {}
  }

  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_BLUEPRINTS, 'readonly');
    const store = tx.objectStore(STORE_BLUEPRINTS);
    const req = store.get(subjectId);
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => resolve(null);
  });
};

export const saveBlueprintSession = async (subjectId: string, breakdown: BlueprintTopic[]): Promise<void> => {
  const user = await getUser();
  if (user) {
    try {
      await ensureProfile(user);
      const { error } = await supabase.from('blueprint_sessions').upsert({
        user_id: user.id,
        subject_id: subjectId,
        breakdown_data: breakdown
      }, { onConflict: 'subject_id' });
      if (error) throw error;
    } catch (error) {
      console.warn("Cloud blueprint save failed, using local:", error);
    }
  }

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_BLUEPRINTS, 'readwrite');
    const store = tx.objectStore(STORE_BLUEPRINTS);
    store.put({ subjectId, data: breakdown });
  } catch (e) {
    console.error("Local blueprint save failed", e);
  }
};

export const deleteBlueprintSession = async (subjectId: string): Promise<void> => {
  const user = await getUser();
  if(user) await supabase.from('blueprint_sessions').delete().eq('subject_id', subjectId);
  const db = await openDB();
  const tx = db.transaction(STORE_BLUEPRINTS, 'readwrite');
  tx.objectStore(STORE_BLUEPRINTS).delete(subjectId);
};

export const getStoredQuestions = async (): Promise<StoredQuestion[]> => {
  const user = await getUser();
  if (user) {
    try {
      const { data, error } = await supabase
        .from('questions')
        .select(`*, srs_progress(*)`);
      
      if (error) throw error;
      if (!data) return [];

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
        subjectId: q.subject_id,
        dateCreated: new Date(q.created_at).getTime(),
        attempts: q.srs_progress[0]?.attempts || 0,
        correctCount: q.srs_progress[0]?.correct_count || 0,
        srs: {
          interval: q.srs_progress[0]?.interval || 0,
          repetition: q.srs_progress[0]?.repetition || 0,
          easeFactor: q.srs_progress[0]?.ease_factor || 2.5,
          learningStep: q.srs_progress[0]?.learning_step || 0,
          nextReviewDate: q.srs_progress[0]?.next_review_date ? new Date(q.srs_progress[0]?.next_review_date).getTime() : Date.now(),
          lastReviewed: q.srs_progress[0]?.last_reviewed_date ? new Date(q.srs_progress[0]?.last_reviewed_date).getTime() : null,
        }
      }));
    } catch (error) {
      console.warn("Cloud question fetch failed:", error);
    }
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_QUESTIONS, 'readonly');
    const store = transaction.objectStore(STORE_QUESTIONS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveBatchQuestions = async (questions: Question[], subjectId?: string): Promise<number> => {
  const user = await getUser();
  if (user) {
    try {
      await ensureProfile(user);
      const qPayload = questions.map(q => ({
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

      const { data, error } = await supabase.from('questions').insert(qPayload).select();
      if (error || !data) throw new Error(error?.message || "Failed to save questions");

      const srsPayload = data.map((q: any) => ({
        user_id: user.id,
        question_id: q.id,
        next_review_date: new Date().toISOString()
      }));
      await supabase.from('srs_progress').insert(srsPayload);
      return data.length;
    } catch (error) {
      console.warn("Cloud question save failed, using local:", error);
    }
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_QUESTIONS, 'readwrite');
    const store = transaction.objectStore(STORE_QUESTIONS);
    questions.forEach(q => {
      store.put({
        ...q,
        subjectId,
        dateCreated: Date.now(),
        attempts: 0,
        correctCount: 0,
        srs: { ...INITIAL_SRS_DATA }
      });
    });
    transaction.oncomplete = () => resolve(questions.length);
  });
};

export const saveQuestion = async (question: Question, subjectId?: string): Promise<StoredQuestion> => {
  await saveBatchQuestions([question], subjectId);
  return { ...question, subjectId, dateCreated: Date.now(), attempts: 0, correctCount: 0, srs: INITIAL_SRS_DATA };
};

export const deleteQuestion = async (id: string): Promise<void> => {
  const user = await getUser();
  if (user) {
    try {
      await supabase.from('questions').delete().eq('id', id);
      return;
    } catch (error) {
      console.warn("Cloud delete failed, using local:", error);
    }
  }

  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_QUESTIONS, 'readwrite');
    const store = transaction.objectStore(STORE_QUESTIONS);
    store.delete(id);
    transaction.oncomplete = () => resolve();
  });
};

export const clearAllQuestions = async (): Promise<void> => {
  const user = await getUser();
  if (user) {
    try {
      await supabase.from('questions').delete().eq('user_id', user.id);
    } catch (error) {
      console.warn("Cloud bulk delete failed:", error);
    }
  }

  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_QUESTIONS, 'readwrite');
    const store = transaction.objectStore(STORE_QUESTIONS);
    store.clear();
    transaction.oncomplete = () => resolve();
  });
};

export const getDueQuestions = async (): Promise<StoredQuestion[]> => {
  const questions = await getStoredQuestions();
  const now = Date.now();
  return questions.filter(q => q.srs.nextReviewDate <= now);
};

export const calculateNextIntervals = (srs: SRSData): string[] => {
  const steps = [1, 10]; 
  const graduatingInterval = 1; 
  const easyInterval = 4; 

  if (srs.learningStep < steps.length) {
    const again = `<1m`;
    const hard = srs.learningStep === 0 ? `1m` : `${Math.floor(steps[srs.learningStep] * 1.5)}m`;
    const good = srs.learningStep + 1 < steps.length ? `${steps[srs.learningStep + 1]}m` : `${graduatingInterval}d`;
    const easy = `${easyInterval}d`;
    return [again, hard, good, easy];
  }

  const currentInt = srs.interval;
  const again = `10m`;
  const hard = `${Math.floor(currentInt * 1.2)}d`;
  const good = `${Math.floor(currentInt * srs.easeFactor)}d`;
  const easy = `${Math.floor(currentInt * srs.easeFactor * 1.3)}d`;
  return [again, hard, good, easy];
};

export const processReview = async (questionId: string, rating: 1 | 2 | 3 | 4): Promise<void> => {
  const user = await getUser();
  const questions = await getStoredQuestions();
  const question = questions.find(q => q.id === questionId);
  if (!question) return;

  const isCorrect = rating > 1;
  const srs = question.srs;
  const steps = [1, 10]; 
  let nextInterval = 0;
  let nextLearningStep = srs.learningStep;
  let nextEase = srs.easeFactor;
  let nextRepetition = srs.repetition;
  let nextReviewDate = Date.now();

  if (srs.learningStep < steps.length) {
    if (rating === 1) {
      nextLearningStep = 0;
      nextReviewDate += 1 * 60 * 1000; 
    } else if (rating === 2) {
      nextReviewDate += steps[srs.learningStep] * 60 * 1000;
    } else if (rating === 3) {
      if (srs.learningStep + 1 < steps.length) {
        nextLearningStep++;
        nextReviewDate += steps[nextLearningStep] * 60 * 1000;
      } else {
        nextLearningStep = steps.length;
        nextInterval = 1; 
        nextRepetition = 1;
        nextReviewDate += 1 * 24 * 60 * 60 * 1000;
      }
    } else if (rating === 4) {
      nextLearningStep = steps.length;
      nextInterval = 4;
      nextRepetition = 1;
      nextReviewDate += 4 * 24 * 60 * 60 * 1000;
    }
  } else {
    if (rating === 1) {
      nextLearningStep = 0; nextInterval = 1; nextRepetition = 0;
      nextEase = Math.max(1.3, srs.easeFactor - 0.2);
      nextReviewDate += 10 * 60 * 1000; 
    } else {
      if (rating === 2) { nextInterval = Math.max(1, srs.interval * 1.2); nextEase = Math.max(1.3, srs.easeFactor - 0.15); }
      else if (rating === 3) { nextInterval = Math.max(1, srs.interval * srs.easeFactor); }
      else if (rating === 4) { nextInterval = Math.max(1, srs.interval * srs.easeFactor * 1.3); nextEase += 0.15; }
      nextRepetition++;
      nextReviewDate += nextInterval * 24 * 60 * 60 * 1000;
    }
  }

  if (user) {
    try {
      await supabase.from('srs_progress').update({
         interval: nextInterval,
         repetition: nextRepetition,
         ease_factor: nextEase,
         learning_step: nextLearningStep,
         next_review_date: new Date(nextReviewDate).toISOString(),
         last_reviewed_date: new Date().toISOString(),
         attempts: question.attempts + 1,
         correct_count: isCorrect ? question.correctCount + 1 : question.correctCount
      }).eq('question_id', questionId);
    } catch (e) {
      console.warn("Cloud review update failed:", e);
    }
  }
  
  try {
    const db = await openDB();
    question.srs = { interval: nextInterval, repetition: nextRepetition, easeFactor: nextEase, learningStep: nextLearningStep, nextReviewDate, lastReviewed: Date.now() };
    question.attempts++;
    if (isCorrect) question.correctCount++;
    const tx = db.transaction(STORE_QUESTIONS, 'readwrite');
    tx.objectStore(STORE_QUESTIONS).put(question);
  } catch (e) {
    console.error("Local review update failed:", e);
  }

  question.studyConcepts.forEach(async (concept) => {
    await recordConceptAttempt(concept, isCorrect);
  });
};

export const recordConceptAttempt = async (concept: string, isCorrect: boolean): Promise<void> => {
  const user = await getUser();
  if (user) {
     try {
       await ensureProfile(user);
       const { data } = await supabase.from('concept_mastery').select('*').eq('concept', concept).single();
       if (data) {
         await supabase.from('concept_mastery').update({
           total_attempts: data.total_attempts + 1,
           correct_attempts: isCorrect ? data.correct_attempts + 1 : data.correct_attempts,
           last_tested_date: new Date().toISOString()
         }).eq('id', data.id);
       } else {
         await supabase.from('concept_mastery').insert({
           user_id: user.id,
           concept,
           total_attempts: 1,
           correct_attempts: isCorrect ? 1 : 0,
           last_tested_date: new Date().toISOString()
         });
       }
     } catch (e) {
       console.warn("Cloud mastery update failed:", e);
     }
  }
  
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MASTERY, 'readwrite');
    const store = tx.objectStore(STORE_MASTERY);
    const req = store.get(concept);
    req.onsuccess = () => {
      const m = req.result || { concept, attempts: 0, correct: 0, lastTested: 0 };
      m.attempts++;
      if (isCorrect) m.correct++;
      m.lastTested = Date.now();
      store.put(m);
    };
  } catch (e) { console.error(e); }
};

export const getConceptMastery = async (): Promise<ConceptMastery[]> => {
  const user = await getUser();
  if (user) {
    try {
      const { data } = await supabase.from('concept_mastery').select('*');
      if (!data) return [];
      return data.map((m: any) => ({
        concept: m.concept,
        attempts: m.total_attempts,
        correct: m.correct_attempts,
        lastTested: new Date(m.last_tested_date).getTime()
      }));
    } catch (e) {
      console.warn("Cloud mastery fetch failed:", e);
    }
  }
  
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_MASTERY, 'readonly');
    const store = tx.objectStore(STORE_MASTERY);
    store.getAll().onsuccess = (e: any) => resolve(e.target.result);
  });
};

export const getWeakestConcepts = async (limit: number = 5): Promise<string[]> => {
  const mastery = await getConceptMastery();
  return mastery
    .filter(m => m.attempts > 0)
    .sort((a, b) => (a.correct / a.attempts) - (b.correct / b.attempts))
    .slice(0, limit)
    .map(m => m.concept);
};
