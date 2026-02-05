import { UserPreferences, QuestionType, Question, StudyFile, ChatMessage, ExamFormat, Subject, BlueprintTopic, ClinicalCase, CaseLabResult, CaseEvaluation, StudyPlanItem, DifficultyLevel, CardStyle } from '../types';
import { normalizeOptions, resolveCorrectAnswer } from '../utils/answerKey';

const XAI_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_MODEL = import.meta.env.VITE_XAI_MODEL || 'grok-4-1-fast-reasoning';
const FAST_MODEL = import.meta.env.VITE_XAI_FAST_MODEL || 'grok-4-1-fast-non-reasoning';

const getXaiKey = () => {
  const apiKey = import.meta.env.VITE_XAI_API_KEY;
  if (!apiKey) {
    throw new Error('xAI API key not found. Set VITE_XAI_API_KEY in your environment.');
  }
  return apiKey;
};

type XaiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type HistologyVignetteSeed = {
  id: string;
  title: string;
  keywords?: string[];
  conceptTags?: string[];
  caption?: string;
};

const callXai = async (
  messages: XaiMessage[],
  model: string,
  temperature = 0.2,
  timeoutMs = 90000,
  signal?: AbortSignal
): Promise<string> => {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getXaiKey()}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature
      }),
      signal: controller.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(didTimeout ? 'xAI request timed out. Please try again.' : 'Request cancelled.');
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`xAI error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from xAI.');
  return content as string;
};

const stripCodeFences = (text: string) => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return cleaned;
};

const parseJsonFromText = (text: string) => {
  const cleaned = stripCodeFences(text);

  try {
    return JSON.parse(cleaned);
  } catch {}

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }

  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]);
    } catch {}
  }

  throw new Error('Failed to parse JSON from xAI response.');
};

const normalizeText = (text: string) => text.trim().toLowerCase();

const shuffleArray = <T,>(items: T[]): T[] => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const extractOptionsFromText = (text: string) => {
  const lines = text.split('\n');
  const options: string[] = [];
  const body: string[] = [];
  const optionRegex = /^\s*([A-E])[\)\.\:]\s+(.+)/i;
  lines.forEach((line) => {
    const trimmed = line.trim();
    const match = trimmed.match(optionRegex);
    if (match) {
      options.push(match[2].trim());
      return;
    }
    if (/^answer\s*:/i.test(trimmed)) {
      return;
    }
    body.push(line);
  });
  return { body: body.join('\n').trim(), options };
};

const sanitizeQuestionText = (text: string) => {
  if (!text) return { text: '', options: [] as string[] };
  const { body, options } = extractOptionsFromText(text);
  return { text: body || text, options };
};

const mapGeneratedQuestions = (rawQuestions: any[], preferences: UserPreferences): Question[] => {
  return (rawQuestions || []).map((q: any) => {
    const rawText = q.questionText || '';
    const sanitized = sanitizeQuestionText(rawText);
    const rawOptions = Array.isArray(q.options)
      ? q.options
      : sanitized.options.length > 0
      ? sanitized.options
      : undefined;
    const normalizedOptions = rawOptions ? normalizeOptions(rawOptions) : [];
    let resolvedCorrect = normalizedOptions.length > 0
      ? resolveCorrectAnswer({ correctAnswer: q.correctAnswer || '', options: normalizedOptions, explanation: q.explanation || '' })
      : String(q.correctAnswer || '').trim();
    if (normalizedOptions.length > 0 && q.explanation) {
      const inferredFromExplanation = resolveCorrectAnswer({
        correctAnswer: '',
        options: normalizedOptions,
        explanation: q.explanation || ''
      });
      const rawAnswer = String(q.correctAnswer || '').trim();
      const isLetterAnswer = /^[A-E](?:[\)\.\:\s]|$)/i.test(rawAnswer);
      if (
        inferredFromExplanation &&
        inferredFromExplanation.toLowerCase() !== resolvedCorrect.toLowerCase() &&
        (!rawAnswer || isLetterAnswer)
      ) {
        resolvedCorrect = inferredFromExplanation;
      }
    }
    const shuffledOptions = normalizedOptions.length > 0 ? shuffleArray(normalizedOptions) : undefined;

    return {
      id: q.id || Math.random().toString(36).slice(2, 9),
      type: q.type || preferences.questionType,
      questionText: sanitized.text || rawText || '',
      options: shuffledOptions,
      correctAnswer: resolvedCorrect,
      explanation: q.explanation || '',
      studyConcepts: Array.isArray(q.studyConcepts) ? q.studyConcepts : [],
      difficulty: q.difficulty || preferences.difficulty,
      histology: q.histology
    };
  });
};

const buildUworldFallbackExplanation = (question: Question, concept: string) => {
  const options = question.options || [];
  const normalizedCorrect = (question.correctAnswer || '').trim().toLowerCase();
  const keyClue = concept
    ? `Key clue: ${concept}.`
    : 'Key clue: the single most distinguishing feature in the stem.';
  const rows = options.map((opt) => {
    const normalizedOption = opt.trim().toLowerCase();
    const isCorrect = normalizedOption === normalizedCorrect;
    const rationale = isCorrect
      ? 'Correct: aligns with the key clue and best explains the presentation.'
      : 'Incorrect: does not fit the key clue. If it were instead: key finding that would make this option correct.';
    return `| ${opt} | ${rationale} |`;
  });
  const choiceTable = [
    '| Option | Rationale |',
    '| --- | --- |',
    ...rows
  ].join('\n');
  const objective = concept
    ? `Focus on high-yield decision points for ${concept}.`
    : 'Identify the key distinguishing features and choose the single best answer.';

  return [
    `**Explanation:** ${question.explanation?.trim() || 'Explanation not provided. Review the key features in the stem and compare each choice.'}`,
    `**Key Clue:** ${keyClue}`,
    `**Choice Analysis:**\n${choiceTable}`,
    `**Educational Objective:** ${objective}`
  ].join('\n\n');
};

const coerceDeepDiveQuestion = (q: any) => {
  const rawText = q.questionText || q.question || q.stem || '';
  const sanitized = sanitizeQuestionText(rawText);
  const rawOptions = Array.isArray(q.options)
    ? q.options
    : Array.isArray(q.choices)
    ? q.choices
    : [];
  const options = rawOptions.length > 0 ? rawOptions : sanitized.options;
  return {
    ...q,
    questionText: sanitized.text || rawText,
    options,
    correctAnswer: q.correctAnswer || q.answer || q.correct || q.correct_option || '',
    explanation: q.explanation || q.rationale || q.analysis || '',
    studyConcepts: Array.isArray(q.studyConcepts) ? q.studyConcepts : Array.isArray(q.concepts) ? q.concepts : [],
    difficulty: q.difficulty || q.level || DifficultyLevel.CLINICAL_VIGNETTE
  };
};

export const normalizeDeepDiveQuiz = (rawQuiz: any[], concept: string): Question[] => {
  const coerced = (rawQuiz || []).map(coerceDeepDiveQuestion);
  const looksNormalized = coerced.every((q) =>
    typeof q.questionText === 'string' &&
    Array.isArray(q.options) &&
    typeof q.correctAnswer === 'string'
  );
  const hasLetterAnswer = coerced.some((q) => {
    const ans = (q.correctAnswer || '').trim();
    return /^([A-E])(?:[\)\.\:\s]|$)/i.test(ans);
  });

  const needsShuffleNormalization = !looksNormalized || hasLetterAnswer;
  const normalized = needsShuffleNormalization
    ? mapGeneratedQuestions(coerced, {
        generationMode: 'questions',
        questionType: QuestionType.MULTIPLE_CHOICE,
        difficulty: DifficultyLevel.CLINICAL_VIGNETTE,
        questionCount: coerced.length || 1,
        autoQuestionCount: false,
        customInstructions: '',
        focusedOnWeakness: false,
        examFormat: ExamFormat.NBME,
        cardStyle: CardStyle.BASIC
      })
    : coerced.map((q, idx) => {
        const normalizedOptions = normalizeOptions(q.options);
        return {
          id: q.id || `dd-${Date.now()}-${idx}`,
          type: q.type || QuestionType.MULTIPLE_CHOICE,
          questionText: q.questionText || '',
          options: normalizedOptions,
          correctAnswer: resolveCorrectAnswer({
            correctAnswer: q.correctAnswer || '',
            options: normalizedOptions,
            explanation: q.explanation || ''
          }),
          explanation: q.explanation || '',
          studyConcepts: Array.isArray(q.studyConcepts) ? q.studyConcepts : [],
          difficulty: q.difficulty || DifficultyLevel.CLINICAL_VIGNETTE,
          histology: q.histology
        };
      });

  return normalized.map((q, idx) => {
    const fallbackReview = (coerced[idx] as any)?.adminReview;
    const hasUworldSections =
      q.explanation?.includes('**Explanation:**') &&
      q.explanation?.includes('**Choice Analysis:**') &&
      q.explanation?.includes('**Educational Objective:**');

    const explanation = hasUworldSections
      ? q.explanation
      : buildUworldFallbackExplanation(q, concept);

    return {
      ...q,
      explanation,
      studyConcepts: q.studyConcepts && q.studyConcepts.length ? q.studyConcepts : (concept ? [concept] : []),
      difficulty: q.difficulty || DifficultyLevel.CLINICAL_VIGNETTE,
      adminReview: q.adminReview || fallbackReview
    };
  });
};

const mapHistory = (history: ChatMessage[]): XaiMessage[] =>
  history.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }));

const betaDisabled = (feature: string) => {
  throw new Error(`${feature} is disabled in the current beta build.`);
};

const sanitizeTutorResponse = (text: string) => {
  if (!text) return '';
  const lines = text.split('\n');
  const cleanedLines = lines
    .map((line) => line.replace(/\t/g, ' ').trimEnd())
    .map((line) => {
      let next = line;
      next = next.replace(/^#{1,6}\s*/, '');
      next = next.replace(/^\*\*\*+\s*/, '');
      next = next.replace(/^\*\*\s*/, '');
      next = next.replace(/^\*\s+/, '');
      next = next.replace(/^-\s+/, '');
      next = next.replace(/^•\s+/, '');
      next = next.replace(/^\d+\.\s+/, '');
      next = next.replace(/`{3,}/g, '');
      next = next.replace(/\*\*(.*?)\*\*/g, '$1');
      next = next.replace(/__(.*?)__/g, '$1');
      if (/\|/.test(next) && (next.match(/\|/g) || []).length >= 2) {
        next = next.replace(/\|/g, ' - ');
      }
      return next;
    })
    .filter((line) => line.trim() !== '');

  return cleanedLines.join('\n');
};

// --- Exported Services ---

export const processLectureVideo = async (_base64Video: string, _mimeType: string): Promise<string> => {
  return betaDisabled('Live lecture processing') as never;
};

export const generateStudyPlan = async (_scheduleFile: StudyFile): Promise<StudyPlanItem[]> => {
  return betaDisabled('Study plan generation') as never;
};

export const generateQuestions = async (
  studyMaterial: string,
  _lectureFiles: StudyFile[],
  _studyGuideFile: StudyFile | null,
  preferences: UserPreferences
): Promise<Question[]> => {
  const quantityInstruction = preferences.autoQuestionCount
    ? 'Generate between 5 and 15 questions.'
    : `Generate exactly ${preferences.questionCount} items.`;

  const examModeInstruction = preferences.examFormat === ExamFormat.IN_HOUSE
    ? 'STRICTLY adhere to the provided material. Test specific details from the source.'
    : 'NBME / USMLE Step 2 CK style: complex clinical vignettes and next best step focus.';

  const customFocus = preferences.customInstructions?.trim()
    ? `Additional focus: ${preferences.customInstructions.trim()}`
    : '';

  const prompt = `
You are an elite medical board exam predictor.
Based on the attached study guide text, generate high-yield medical questions.

${examModeInstruction}
${customFocus}
${quantityInstruction}
Type: ${preferences.questionType}
Difficulty: ${preferences.difficulty}

Requirements:
- Return ONLY valid JSON.
- JSON schema: { "questions": [ { "type", "questionText", "options", "correctAnswer", "explanation", "studyConcepts", "difficulty" } ] }
- For MULTIPLE_CHOICE and TRUE_FALSE, include 4-5 options.
- For DESCRIPTIVE, omit options or return an empty array.
- Include 3-6 studyConcepts per question.
- Follow NBME-style item writing:
  - One-best-answer with a focused lead-in question.
  - Homogeneous option formatting (similar length, same category).
  - Avoid "all/none of the above" and avoid negative stems unless clinically required.
  - Include only essential clinical data (demographics, timeline, key labs/imaging); avoid irrelevant details.
- Across the full set, aim for ~40% diagnosis/etiology, ~40% management/next-best-step, ~20% mechanism/pathophys.
- The "explanation" field must be formatted like UWorld with these exact Markdown section headers:
  **Explanation:** 2-5 sentences explaining why the correct answer is correct.
  **Key Clue:** 1 sentence naming the single most important clue.
  **Choice Analysis:** a Markdown table with columns: Option | Rationale. Include every answer choice.
    - The Option column must include the full option text. Avoid using letters alone.
    - For incorrect options: explain why it's wrong and what finding would make it correct.
      Include the label: "If it were instead: <finding>" in the rationale for incorrect choices.
    - For the correct option: name the key clue(s) that support it.
  **Educational Objective:** 1-2 sentence high-yield takeaway.
  **References:** (optional) brief citations or source names from the study guide.
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a careful medical exam writer. Output only JSON.' },
    { role: 'user', content: `${prompt}\n\nSTUDY GUIDE TEXT:\n${studyMaterial}` }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.2, 120000);
  const parsed = parseJsonFromText(raw);
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];

  const normalized = mapGeneratedQuestions(questions, preferences);
  if (preferences.autoQuestionCount) {
    const autoLimit = Math.max(5, Math.min(15, preferences.questionCount || 10));
    return normalized.slice(0, autoLimit);
  }
  return normalized.slice(0, Math.max(1, preferences.questionCount || 1));
};

export const generateQuestionBlueprints = async (
  studyMaterial: string,
  count: number,
  customInstructions?: string
): Promise<any[]> => {
  const focus = customInstructions?.trim()
    ? `Additional focus: ${customInstructions.trim()}`
    : '';

  const prompt = `
You are an expert medical exam item writer.
Create concise question BLUEPRINTS based ONLY on the provided study material.
Each blueprint must be short and factual — do NOT write full questions.

Return ONLY valid JSON.
JSON schema:
{
  "blueprints": [
    {
      "focusType": "diagnosis|management|mechanism",
      "coreFacts": "2-4 key facts",
      "stemOutline": "short outline of the vignette",
      "correctAnswer": "short phrase",
      "distractorThemes": ["theme1","theme2","theme3","theme4"],
      "keyClue": "single most important clue"
    }
  ]
}

Requirements:
- Generate exactly ${count} blueprints.
- Use ONLY the study material; no outside facts.
- Keep each field short and precise.
${focus}
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a precise medical blueprint writer. Output only JSON.' },
    { role: 'user', content: `${prompt}\n\nSTUDY GUIDE TEXT:\n${studyMaterial}` }
  ];

  const raw = await callXai(messages, FAST_MODEL, 0.2);
  const parsed = parseJsonFromText(raw);
  const blueprints = Array.isArray(parsed?.blueprints) ? parsed.blueprints : [];
  if (blueprints.length !== count) {
    throw new Error('Blueprint count mismatch.');
  }
  return blueprints;
};

export const generateQuestionsFromBlueprints = async (
  blueprints: any[],
  preferences: UserPreferences
): Promise<Question[]> => {
  const quantityInstruction = `Generate exactly ${blueprints.length} items in the SAME order as the blueprints.`;

  const examModeInstruction = preferences.examFormat === ExamFormat.IN_HOUSE
    ? 'STRICTLY adhere to the provided blueprint facts. Test specific details from the source.'
    : 'NBME / USMLE Step 2 CK style: complex clinical vignettes and next best step focus.';

  const customFocus = preferences.customInstructions?.trim()
    ? `Additional focus: ${preferences.customInstructions.trim()}`
    : '';

  const prompt = `
You are an elite medical board exam predictor.
Based on the attached question BLUEPRINTS, generate high-yield medical questions.

${examModeInstruction}
${customFocus}
${quantityInstruction}
Type: ${preferences.questionType}
Difficulty: ${preferences.difficulty}

Requirements:
- Return ONLY valid JSON.
- JSON schema: { "questions": [ { "type", "questionText", "options", "correctAnswer", "explanation", "studyConcepts", "difficulty" } ] }
- For MULTIPLE_CHOICE and TRUE_FALSE, include 4-5 options.
- For DESCRIPTIVE, omit options or return an empty array.
- Include 3-6 studyConcepts per question.
- Follow NBME-style item writing:
  - One-best-answer with a focused lead-in question.
  - Homogeneous option formatting (similar length, same category).
  - Avoid "all/none of the above" and avoid negative stems unless clinically required.
  - Include only essential clinical data (demographics, timeline, key labs/imaging); avoid irrelevant details.
- Across the full set, aim for ~40% diagnosis/etiology, ~40% management/next-best-step, ~20% mechanism/pathophys.
- The "explanation" field must be formatted like UWorld with these exact Markdown section headers:
  **Explanation:** 2-5 sentences explaining why the correct answer is correct.
  **Key Clue:** 1 sentence naming the single most important clue.
  **Choice Analysis:** a Markdown table with columns: Option | Rationale. Include every answer choice.
    - The Option column must include the full option text. Avoid using letters alone.
    - For incorrect options: explain why it's wrong and what finding would make it correct.
      Include the label: "If it were instead: <finding>" in the rationale for incorrect choices.
    - For the correct option: name the key clue(s) that support it.
  **Educational Objective:** 1-2 sentence high-yield takeaway.
  **References:** (optional) brief citations or source names from the study guide.
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a careful medical exam writer. Output only JSON.' },
    { role: 'user', content: `${prompt}\n\nBLUEPRINTS:\n${JSON.stringify(blueprints, null, 2)}` }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.2, 120000);
  const parsed = parseJsonFromText(raw);
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const normalized = mapGeneratedQuestions(questions, preferences);
  return normalized.slice(0, blueprints.length);
};

export const generateQuestionsStaged = async (
  studyMaterial: string,
  preferences: UserPreferences
): Promise<Question[]> => {
  const count = preferences.autoQuestionCount
    ? Math.max(5, Math.min(15, preferences.questionCount || 10))
    : preferences.questionCount || 1;

  try {
    const blueprints = await generateQuestionBlueprints(studyMaterial, count, preferences.customInstructions);
    const questions = await generateQuestionsFromBlueprints(blueprints, preferences);
    return questions.slice(0, count);
  } catch (err) {
    console.warn('Staged generation failed, falling back to single-call generation.', err);
    return generateQuestions(studyMaterial, [], null, preferences);
  }
};

export const generateConceptFlashcards = async (_weakConcepts: string[], _lectureFiles: StudyFile[]): Promise<Question[]> => {
  return betaDisabled('Concept flashcards') as never;
};

export const generateCheatSheetText = async (
  sourceText: string,
  preferences: UserPreferences,
  guideTitle?: string
): Promise<string> => {
  const focus = preferences.customInstructions?.trim()
    ? `Additional focus: ${preferences.customInstructions.trim()}`
    : '';
  const title = guideTitle ? `${guideTitle} Rapid Review` : 'Rapid Review';
  const prompt = `
You are an expert medical educator.
Create a last-minute cheat sheet based ONLY on the provided source material.
Output Markdown only. No HTML. Keep it concise, high-yield, and skimmable.

Structure:
- Start with "# ${title}"
- Use short sections with "##" headers
- Use bullet points and tables where helpful
- Include: key patterns, classic associations, management/next steps, pitfalls
${focus}

Source material:
${sourceText}
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You produce concise medical study cheat sheets in Markdown.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.2, 120000);
  return stripCodeFences(raw);
};

export const generateCheatSheet = async (
  _lectureFiles: StudyFile[],
  studyGuideFile: StudyFile | null,
  preferences: UserPreferences
): Promise<string> => {
  const sourceText = studyGuideFile?.data || '';
  if (!sourceText.trim()) {
    throw new Error('No study guide text available for cheat sheet generation.');
  }
  return generateCheatSheetText(sourceText, preferences);
};

export const chatWithTutor = async (
  question: Question,
  history: ChatMessage[],
  message: string,
  model: 'flash' | 'pro',
  lessonContext?: string
): Promise<string> => {
  const contextSnippet = lessonContext ? `Lesson context (condensed): ${lessonContext}` : '';
  const systemInstruction = `
You are a concise Socratic medical tutor.
Help the student reason through the question without dumping long explanations.

Style rules:
- Plain text only. No markdown, no headings, no bold, no bullet lists, no tables.
- Keep it tight: 4-8 short paragraphs max.
- Ask 3-5 guiding questions (use "Q1)", "Q2)" style).
- Mention only 2-3 key abnormalities if labs matter.
- End with a single "Check:" question.
- Do not reveal the final answer unless the student asks directly or is clearly stuck.

Question: "${question.questionText}"
Correct answer: "${question.correctAnswer}"
${contextSnippet}
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: systemInstruction },
    ...mapHistory(history),
    { role: 'user', content: message }
  ];

  const chosenModel = model === 'pro' ? DEFAULT_MODEL : FAST_MODEL;
  const raw = await callXai(messages, chosenModel, 0.2);
  return sanitizeTutorResponse(raw);
};

export const chatWithSubject = async (_subject: Subject, _history: ChatMessage[], _message: string, _model: 'flash' | 'pro'): Promise<string> => {
  return betaDisabled('Subject tutor') as never;
};

export const generateClerkshipInfo = async (query: string): Promise<string> => {
  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a clinical preceptor. Provide high-yield medical teaching. Use Markdown, no HTML.' },
    { role: 'user', content: `Provide a concise high-yield summary for: ${query}. Include Diagnosis, Management, and Next Best Step.` }
  ];

  return callXai(messages, FAST_MODEL, 0.2);
};

export const startDeepDive = async (
  _subject: Subject | null,
  topicContext: string,
  concept: string,
  count: number = 3,
  signal?: AbortSignal
): Promise<{ lessonContent: string; quiz: Question[] }> => {
  const histologyNote = /hematology|pulmonology/i.test(topicContext)
    ? 'When relevant, include morphology/histology cues (peripheral smear, biopsy). If you reference an image, explicitly say: "A representative histology image is provided below."'
    : '';
  const prompt = `
Act as an elite medical professor.
Context: ${topicContext}.
Target Concept: "${concept}".

Task 1: Create a structured lesson using ONLY Markdown. Use tables for comparisons. No HTML.
Task 2: Create a progressive ${count}-question quiz.
- Start with basic recall/concepts.
- Progress to complex clinical vignettes (USMLE Style).
${histologyNote}

Quiz requirements:
- Return ONLY valid JSON with keys: lessonContent (string) and quiz (array).
- Quiz item JSON schema: { "questionText", "options", "correctAnswer", "explanation", "studyConcepts", "difficulty" }.
- Exactly 5 options per question.
- Explanations must follow the exact UWorld-style format:
  **Explanation:** 2-5 sentences explaining why the correct answer is correct.
  **Key Clue:** 1 sentence naming the single most important clue.
  **Choice Analysis:** a Markdown table with columns: Option | Rationale. Include every answer choice.
    - The Option column must include the full option text. Avoid using letters alone.
    - For incorrect options: explain why it's wrong and what finding would make it correct.
      Include the label: "If it were instead: <finding>" in the rationale for incorrect choices.
    - For the correct option: name the key clue(s) that support it.
  **Educational Objective:** 1-2 sentence high-yield takeaway.
- Include only essential clinical data (demographics, timeline, key labs/imaging); avoid irrelevant details.
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a precise medical educator. Output only JSON.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.2, 120000, signal);
  const parsed = parseJsonFromText(raw);
  const rawQuiz = Array.isArray(parsed?.quiz) ? parsed.quiz : [];

  return {
    lessonContent: parsed?.lessonContent || '',
    quiz: normalizeDeepDiveQuiz(rawQuiz, concept)
  };
};

export const regenerateDeepDiveLesson = async (
  topicContext: string,
  concept: string,
  reviewerNote?: string,
  signal?: AbortSignal
): Promise<string> => {
  const reviewerInstruction = reviewerNote ? `Reviewer feedback: ${reviewerNote}` : '';
  const prompt = `
Act as an elite medical professor.
Context: ${topicContext}.
Target Concept: "${concept}".

Task: Create a structured primer using ONLY Markdown. Use tables for comparisons. No HTML.
- Include: concise definition, key pathophysiology, high-yield clinical clues, and common pitfalls.
- Keep it succinct but complete (aim for 8-14 short paragraphs or bullets total).
- Do NOT mention or imply any images are provided.
${reviewerInstruction}

Return ONLY valid JSON with key: lessonContent (string).
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a precise medical educator. Output only JSON.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.2, 90000, signal);
  const parsed = parseJsonFromText(raw);
  return parsed?.lessonContent || '';
};

export const extendDeepDiveQuiz = async (
  _subject: Subject | null,
  topicContext: string,
  concept: string,
  count: number = 5,
  signal?: AbortSignal,
  difficulty: 'easier' | 'same' | 'harder' = 'same',
  reviewerNote?: string
): Promise<Question[]> => {
  const difficultyInstruction =
    difficulty === 'easier'
      ? 'Make these easier: shorter stems, fewer steps, obvious key clues, avoid tricky distractors.'
      : difficulty === 'harder'
      ? 'Make these harder: add a key lab/imaging nuance, require multi-step reasoning, keep one-best-answer.'
      : 'Match the current difficulty level.';
  const reviewerInstruction = reviewerNote ? `Reviewer feedback: ${reviewerNote}` : '';
  const histologyNote = /hematology|pulmonology/i.test(topicContext)
    ? 'When relevant, include morphology/histology cues (peripheral smear, biopsy). If you reference an image, explicitly say: "A representative histology image is provided below."'
    : '';
  const prompt = `
Act as an elite medical professor.
Context: ${topicContext}.
Target Concept: "${concept}".

Task: Generate ${count} NEW practice questions to test this concept further.
- Ensure questions are distinct from standard basic questions.
- Focus on high-yield board vignettes.
 ${difficultyInstruction}
${reviewerInstruction}
${histologyNote}

Return ONLY valid JSON with a 'quiz' array.
Quiz item JSON schema: { "questionText", "options", "correctAnswer", "explanation", "studyConcepts", "difficulty" }.
Explanations must follow the exact UWorld-style format:
  **Explanation:** 2-5 sentences explaining why the correct answer is correct.
  **Key Clue:** 1 sentence naming the single most important clue.
  **Choice Analysis:** a Markdown table with columns: Option | Rationale. Include every answer choice.
    - The Option column must include the full option text. Avoid using letters alone.
    - For incorrect options: explain why it's wrong and what finding would make it correct.
      Include the label: "If it were instead: <finding>" in the rationale for incorrect choices.
    - For the correct option: name the key clue(s) that support it.
  **Educational Objective:** 1-2 sentence high-yield takeaway.
Include only essential clinical data (demographics, timeline, key labs/imaging); avoid irrelevant details.
Include exactly 5 options per question.
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a precise medical educator. Output only JSON.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.2, 120000, signal);
  const parsed = parseJsonFromText(raw);
  const rawQuiz = Array.isArray(parsed?.quiz) ? parsed.quiz : [];
  return normalizeDeepDiveQuiz(rawQuiz, concept);
};

export const generateHistologyVignettes = async (
  seeds: HistologyVignetteSeed[]
): Promise<Record<string, string>> => {
  if (!seeds || seeds.length === 0) return {};
  const seedPayload = seeds.map((seed) => ({
    id: seed.id,
    title: seed.title,
    keywords: seed.keywords || [],
    conceptTags: seed.conceptTags || [],
    caption: seed.caption || ''
  }));
  const prompt = `
You are a hematopathology educator. Write short, high-yield vignettes for histology review.

Rules:
- Return ONLY valid JSON.
- Output format: { "vignettes": [ { "id": "...", "vignette": "..." } ] }.
- Each vignette: 1-2 sentences max.
- Do NOT include the exact title text.
- Do NOT mention answer choices.
- The vignette should hint at the diagnosis/morphology using key clinical or lab clues.
- Avoid saying “image provided”; the UI already shows it.

Seeds:
${JSON.stringify(seedPayload, null, 2)}
`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a precise medical educator. Output only JSON.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.2, 120000);
  const parsed = parseJsonFromText(raw);
  const items = Array.isArray(parsed?.vignettes)
    ? parsed.vignettes
    : Array.isArray(parsed)
      ? parsed
      : [];
  const result: Record<string, string> = {};
  items.forEach((item: any) => {
    const id = item?.id;
    const vignette = typeof item?.vignette === 'string' ? item.vignette.trim() : '';
    if (id && vignette) {
      result[id] = vignette;
    }
  });
  return result;
};

export const generateMentalMap = async (topic: string): Promise<string> => {
  const messages: XaiMessage[] = [
    { role: 'system', content: 'Create a medical decision tree in Markdown tables. No HTML.' },
    { role: 'user', content: `Create a medical decision tree/mental map for differentiating: ${topic}.` }
  ];

  return callXai(messages, DEFAULT_MODEL, 0.2);
};

export const analyzeMcqScreenshot = async (_base64Image: string, _mimeType: string): Promise<string> => {
  return betaDisabled('MCQ screenshot solver') as never;
};

export const analyzeBlueprintStructure = async (_blueprint: StudyFile): Promise<BlueprintTopic[]> => {
  return betaDisabled('Blueprint analysis') as never;
};

export const generateTopicContent = async (_topic: string, _count: number, _lectures: StudyFile[], _mode: ExamFormat): Promise<{ explanation: string, questions: Question[] }> => {
  return betaDisabled('Blueprint topic generator') as never;
};

export const startClinicalCase = async (specialty: string, difficulty: string): Promise<ClinicalCase> => {
  const prompt = `Create a realistic clinical case for the specialty: ${specialty} at a ${difficulty} difficulty level. Return JSON with id, patientName, age, gender, chiefComplaint, vitals {hr,bp,rr,temp,o2,weight}, appearance, hiddenDiagnosis, hiddenPathology.`;
  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a clinical case simulator. Output only JSON.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.3);
  const parsed = parseJsonFromText(raw);
  return parsed as ClinicalCase;
};

export const interactWithPatient = async (activeCase: ClinicalCase, history: ChatMessage[], message: string): Promise<string> => {
  const systemInstruction = `You are the patient: ${activeCase.patientName}. You are a ${activeCase.age}yo ${activeCase.gender} presenting with ${activeCase.chiefComplaint}. Stay in character. Respond naturally based on your hidden pathology: ${activeCase.hiddenPathology}.`;
  const messages: XaiMessage[] = [
    { role: 'system', content: systemInstruction },
    ...mapHistory(history),
    { role: 'user', content: message }
  ];

  return callXai(messages, FAST_MODEL, 0.4);
};

export const orderMedicalTests = async (activeCase: ClinicalCase, testNames: string): Promise<CaseLabResult[]> => {
  const prompt = `The student ordered these tests: ${testNames}. Based on the hidden diagnosis (${activeCase.hiddenDiagnosis}) and pathology (${activeCase.hiddenPathology}), return realistic results. Return JSON array of { testName, result, flag }.`;
  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a clinical lab simulator. Output only JSON.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.3);
  const parsed = parseJsonFromText(raw);
  return Array.isArray(parsed) ? parsed : [];
};

export const evaluateCase = async (activeCase: ClinicalCase, history: ChatMessage[], orderedTests: string[], diagnosis: string, plan: string): Promise<CaseEvaluation> => {
  const summary = `History: ${history.length} messages. Tests: ${orderedTests.join(', ')}. User diagnosis: ${diagnosis}. Plan: ${plan}. Actual: ${activeCase.hiddenDiagnosis}.`;
  const prompt = `Evaluate this clinical performance: ${summary}. Return JSON with score, correctDiagnosis, userDiagnosis, feedback, missedSteps, criticalErrors. Feedback should be Markdown, no HTML.`;

  const messages: XaiMessage[] = [
    { role: 'system', content: 'You are a strict clinical evaluator. Output only JSON.' },
    { role: 'user', content: prompt }
  ];

  const raw = await callXai(messages, DEFAULT_MODEL, 0.3);
  const parsed = parseJsonFromText(raw);
  return parsed as CaseEvaluation;
};

export const chatWithPreceptor = async (activeCase: ClinicalCase, history: ChatMessage[], message: string, persona: string): Promise<string> => {
  const systemInstruction = `You are a ${persona} medical preceptor. The student is working on a case involving ${activeCase.chiefComplaint}. Do not give away the hidden diagnosis (${activeCase.hiddenDiagnosis}) immediately. Lead them with clinical reasoning.`;
  const messages: XaiMessage[] = [
    { role: 'system', content: systemInstruction },
    ...mapHistory(history),
    { role: 'user', content: message }
  ];

  return callXai(messages, DEFAULT_MODEL, 0.3);
};
