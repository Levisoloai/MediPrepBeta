
import React, { useState, useEffect, useRef } from 'react';
import { Subject, Question, QuestionState, ChatMessage } from '../types';
import { getSubjects } from '../services/storageService';
import { startDeepDive, extendDeepDiveQuiz, chatWithTutor, normalizeDeepDiveQuiz } from '../services/geminiService';
import { buildFingerprintSet, filterDuplicateQuestions } from '../utils/questionDedupe';
import { AcademicCapIcon, ArrowRightIcon, BookOpenIcon, TrophyIcon, ArrowDownTrayIcon, PlusIcon, ArrowPathIcon, ChatBubbleLeftRightIcon, PaperAirplaneIcon, XMarkIcon, ArrowLeftIcon } from '@heroicons/react/24/solid';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import katex from 'katex';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { betaGuides } from '../utils/betaGuides';
import { deepDivePrefabTopics } from '../utils/deepDivePrefabs';
import { getDeepDivePrefab, seedDeepDivePrefab } from '../services/deepDivePrefabService';
import { attachHistologyToQuestions } from '../utils/histology';
import QuestionCard from './QuestionCard';
import { trackTutorUsage } from '../services/tutorUsageService';

interface DeepDiveViewProps {
  prefilledTopic?: string | null;
  clearPrefill?: () => void;
}

type SessionState = 'select' | 'loading' | 'lesson' | 'quiz' | 'summary';

const BETA_SOURCES = betaGuides.map((guide) => ({
  label: `${guide.title} Study Guide`,
  value: guide.title
}));

const DeepDiveView: React.FC<DeepDiveViewProps> = ({ prefilledTopic, clearPrefill }) => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  
  // RESTORE FROM LOCAL STORAGE
  const initialConcept = localStorage.getItem('mediprep_dd_concept') || '';
  const initialQuizRaw = (() => {
    try {
      const s = localStorage.getItem('mediprep_dd_quiz');
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  })();

  const [selectedSource, setSelectedSource] = useState(() => localStorage.getItem('mediprep_dd_source') || '');
  const [concept, setConcept] = useState(() => initialConcept);
  const initialExtraCount = (() => {
    const saved = localStorage.getItem('mediprep_dd_extra_count');
    const value = saved ? parseInt(saved, 10) : 5;
    return Number.isFinite(value) ? value : 5;
  })();
  const [extraCount, setExtraCount] = useState<number>(initialExtraCount);
  const [extraDifficulty, setExtraDifficulty] = useState<'easier' | 'same' | 'harder'>(
    (localStorage.getItem('mediprep_dd_extra_diff') as 'easier' | 'same' | 'harder') || 'same'
  );
  
  const [state, setState] = useState<SessionState>(() => (localStorage.getItem('mediprep_dd_state') as SessionState) || 'select');
  const [lessonContent, setLessonContent] = useState(() => localStorage.getItem('mediprep_dd_lesson') || '');
  const [quiz, setQuiz] = useState<Question[]>(() =>
    normalizeDeepDiveQuiz(Array.isArray(initialQuizRaw) ? initialQuizRaw : [], initialConcept)
  );
  const [quizAnswers, setQuizAnswers] = useState<boolean[]>(() => {
     const s = localStorage.getItem('mediprep_dd_answers');
     return s ? JSON.parse(s) : [];
  });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(() => parseInt(localStorage.getItem('mediprep_dd_idx') || '0'));
  
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [deepDiveStates, setDeepDiveStates] = useState<Record<string, QuestionState>>({});
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatQuestion, setActiveChatQuestion] = useState<Question | null>(null);
  const [chatHistoryByQuestion, setChatHistoryByQuestion] = useState<Record<string, ChatMessage[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [tutorModel, setTutorModel] = useState<'flash' | 'pro'>('pro');
  const [tutorSessionId, setTutorSessionId] = useState<string | null>(null);
  
  const contentRef = useRef<HTMLDivElement>(null);
  const deepDiveAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const normalizeValue = (value: string) => value.trim().toLowerCase();
  const prefabTopicsForSource = selectedSource
    ? deepDivePrefabTopics.filter((topic) => topic.source === selectedSource)
    : [];

  // PERSISTENCE EFFECT
  useEffect(() => {
    localStorage.setItem('mediprep_dd_source', selectedSource);
    localStorage.setItem('mediprep_dd_concept', concept);
    localStorage.setItem('mediprep_dd_state', state);
    localStorage.setItem('mediprep_dd_lesson', lessonContent);
    localStorage.setItem('mediprep_dd_quiz', JSON.stringify(quiz));
    localStorage.setItem('mediprep_dd_answers', JSON.stringify(quizAnswers));
    localStorage.setItem('mediprep_dd_idx', currentQuestionIndex.toString());
    localStorage.setItem('mediprep_dd_extra_count', extraCount.toString());
    localStorage.setItem('mediprep_dd_extra_diff', extraDifficulty);
  }, [selectedSource, concept, state, lessonContent, quiz, quizAnswers, currentQuestionIndex, extraCount, extraDifficulty]);

  useEffect(() => {
    getSubjects().then(setSubjects);
  }, []);

  useEffect(() => {
    if (!selectedSource) return;
    const allowed = new Set(BETA_SOURCES.map((source) => source.value));
    if (!allowed.has(selectedSource)) {
      setSelectedSource('');
    }
  }, [selectedSource]);

  useEffect(() => {
    if (quiz.length === quizAnswers.length) return;
    setQuizAnswers(prev => {
      if (quiz.length > prev.length) {
        return [...prev, ...new Array(quiz.length - prev.length).fill(false)];
      }
      return prev.slice(0, quiz.length);
    });
    if (currentQuestionIndex >= quiz.length && quiz.length > 0) {
      setCurrentQuestionIndex(quiz.length - 1);
    }
  }, [quiz.length]);

  useEffect(() => {
    if (prefilledTopic) {
      setConcept(prefilledTopic);
      setSelectedSource(BETA_SOURCES[0]?.value || '');
      clearPrefill?.();
    }
  }, [prefilledTopic]);

  const handleStart = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedSource || !concept.trim()) return;
    const initialCount = 5;

    const conceptTrimmed = concept.trim();
    const prefabMatch = deepDivePrefabTopics.find(
      (topic) => topic.source === selectedSource && normalizeValue(topic.concept) === normalizeValue(conceptTrimmed)
    );

    let sub: Subject | null = null;
    const isSubject = selectedSource.startsWith('sub_');
    if (isSubject) {
       const found = subjects.find(s => s.id === selectedSource);
       if (found) sub = found;
    }

    setState('loading');
    setError(null);
    deepDiveAbortRef.current?.abort();
    const controller = new AbortController();
    deepDiveAbortRef.current = controller;

    try {
      const cached = await getDeepDivePrefab(selectedSource, prefabMatch?.concept || conceptTrimmed);
      if (cached) {
        const rawQuiz = Array.isArray(cached.quiz) ? cached.quiz : [];
        const activeQuiz = rawQuiz.filter((q: any) => q?.adminReview?.status !== 'retired');
        const normalizedAll = normalizeDeepDiveQuiz(activeQuiz, cached.concept || conceptTrimmed, { shuffleOptions: false });
        let normalizedQuiz = normalizedAll.slice(0, initialCount);

        const missing = initialCount - normalizedQuiz.length;
        if (missing > 0) {
          const backfill = await extendDeepDiveQuiz(
            sub,
            selectedSource,
            cached.concept || conceptTrimmed,
            missing,
            controller.signal,
            'same'
          );
          const existingSet = buildFingerprintSet(normalizedQuiz);
          const { unique } = filterDuplicateQuestions(backfill, existingSet);
          normalizedQuiz = [...normalizedQuiz, ...unique].slice(0, initialCount);
        }

        const withHistology = attachHistologyToQuestions(normalizedQuiz, selectedSource);
        setLessonContent(cached.lessonContent);
        setQuiz(withHistology);
        setQuizAnswers(new Array(withHistology.length).fill(false));
        setDeepDiveStates({});
        setCurrentQuestionIndex(0);
        setState('lesson');
        deepDiveAbortRef.current = null;
        return;
      }

      const data = await startDeepDive(sub, selectedSource, concept, initialCount, controller.signal);
      setLessonContent(data.lessonContent);
      let trimmedQuiz = data.quiz.slice(0, initialCount);
      const missing = initialCount - trimmedQuiz.length;
      if (missing > 0) {
        const backfill = await extendDeepDiveQuiz(
          sub,
          selectedSource,
          concept,
          missing,
          controller.signal,
          'same'
        );
        const existingSet = buildFingerprintSet(trimmedQuiz);
        const { unique } = filterDuplicateQuestions(backfill, existingSet);
        trimmedQuiz = [...trimmedQuiz, ...unique].slice(0, initialCount);
      }
      const withHistology = attachHistologyToQuestions(trimmedQuiz, selectedSource);
      setQuiz(withHistology);
      setQuizAnswers(new Array(withHistology.length).fill(false));
      setDeepDiveStates({});
      setCurrentQuestionIndex(0);
      setState('lesson');

      if (prefabMatch) {
        try {
          await seedDeepDivePrefab(selectedSource, prefabMatch.concept, data.lessonContent, withHistology);
        } catch (seedError) {
          console.warn('Deep dive prefab seed failed', seedError);
        }
      }
    } catch (err: any) {
      if (err?.message === 'Request cancelled.') {
        setError('Request cancelled.');
      } else {
        setError(err?.message || "Failed to generate lesson. Please try a simpler concept or different source.");
      }
      setState('select');
    } finally {
      deepDiveAbortRef.current = null;
    }
  };

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    let sub: Subject | null = null;
    const isSubject = selectedSource.startsWith('sub_');
    if (isSubject) {
       const found = subjects.find(s => s.id === selectedSource);
       if (found) sub = found;
    }

    try {
      const startIndex = quiz.length;
      deepDiveAbortRef.current?.abort();
      const controller = new AbortController();
      deepDiveAbortRef.current = controller;
      const newQuestions = await extendDeepDiveQuiz(sub, selectedSource, concept, extraCount, controller.signal, extraDifficulty);
      const existingSet = buildFingerprintSet(quiz);
      const { unique } = filterDuplicateQuestions(newQuestions, existingSet);
      const withHistology = attachHistologyToQuestions(unique, selectedSource, { existingQuestions: quiz });
      const nextIndex = unique.length > 0 ? startIndex : Math.max(0, startIndex - 1);
      setQuiz(prev => [...prev, ...withHistology]);
      setQuizAnswers(prev => [...prev, ...new Array(withHistology.length).fill(false)]);
      setCurrentQuestionIndex(nextIndex);
      setState('quiz');
    } catch (e: any) {
      if (e?.message !== 'Request cancelled.') {
        alert(e?.message || "Failed to load more questions.");
      }
    } finally {
      setIsLoadingMore(false);
      deepDiveAbortRef.current = null;
    }
  };

  const handleCancelLoading = () => {
    deepDiveAbortRef.current?.abort();
    deepDiveAbortRef.current = null;
    setState('select');
    setError('Request cancelled.');
  };

  const handleBackToSelect = () => {
    setState('select');
    setIsChatOpen(false);
  };

  const normalizeOptionText = (text: string) =>
    text.replace(/^[A-E](?:[\)\.\:]|\s)\s*/i, '').trim().toLowerCase();

  const openChatForQuestion = (question: Question) => {
    const sessionId = crypto.randomUUID();
    setActiveChatQuestion(question);
    setIsChatOpen(true);
    setChatInput('');
    setTutorSessionId(sessionId);
    trackTutorUsage({
      sessionId,
      questionId: question.id,
      guideHash: null,
      sourceType: question.sourceType || null,
      model: tutorModel,
      location: 'deep_dive',
      eventType: 'open'
    });
  };

  const currentChatHistory = activeChatQuestion ? chatHistoryByQuestion[activeChatQuestion.id] || [] : [];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isChatOpen, currentChatHistory, isChatLoading]);

  const renderChatContent = (text: string) => {
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
        const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
        return (
          <span key={index}>
            {boldParts.map((subPart, subIdx) => {
              if (subPart.startsWith('**') && subPart.endsWith('**') && subPart.length >= 4) {
                return <strong key={subIdx} className="font-bold text-slate-900">{subPart.slice(2, -2)}</strong>;
              }
              return <span key={subIdx}>{subPart.replace(/\*/g, '')}</span>;
            })}
          </span>
        );
      }
    });
  };

  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChatQuestion || !chatInput.trim() || isChatLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    const history = chatHistoryByQuestion[activeChatQuestion.id] || [];
    setChatHistoryByQuestion(prev => ({
      ...prev,
      [activeChatQuestion.id]: [...history, userMsg]
    }));
    setChatInput('');
    setIsChatLoading(true);

    try {
      trackTutorUsage({
        sessionId: tutorSessionId,
        questionId: activeChatQuestion.id,
        guideHash: null,
        sourceType: activeChatQuestion.sourceType || null,
        model: tutorModel,
        location: 'deep_dive',
        eventType: 'message_sent'
      });
      const contextSnippet = lessonContent
        ? lessonContent.replace(/\s+/g, ' ').slice(0, 1200)
        : '';
      const responseText = await chatWithTutor(activeChatQuestion, history, userMsg.text, tutorModel, contextSnippet);
      setChatHistoryByQuestion(prev => ({
        ...prev,
        [activeChatQuestion.id]: [...history, userMsg, { role: 'model', text: responseText }]
      }));
      trackTutorUsage({
        sessionId: tutorSessionId,
        questionId: activeChatQuestion.id,
        guideHash: null,
        sourceType: activeChatQuestion.sourceType || null,
        model: tutorModel,
        location: 'deep_dive',
        eventType: 'response_received'
      });
    } catch (error) {
      setChatHistoryByQuestion(prev => ({
        ...prev,
        [activeChatQuestion.id]: [...history, userMsg, { role: 'model', text: "Sorry, I'm having trouble connecting." }]
      }));
      trackTutorUsage({
        sessionId: tutorSessionId,
        questionId: activeChatQuestion.id,
        guideHash: null,
        sourceType: activeChatQuestion.sourceType || null,
        model: tutorModel,
        location: 'deep_dive',
        eventType: 'error'
      });
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!contentRef.current) return;
    setIsExporting(true);
    try {
      const element = contentRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: 800,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(`MediPrep_DeepDive_${concept.replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error("PDF Export Error", err);
      alert("Failed to export PDF.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleNext = () => {
    if (state === 'lesson') {
      setState('quiz');
      setCurrentQuestionIndex(0);
    } else if (state === 'quiz') {
      if (currentQuestionIndex < quiz.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        setState('summary');
      }
    }
  };

  const renderMarkdown = (text: string) => {
      const lines = text.split('\n');
      const elements: React.ReactElement[] = [];
      let currentTable: string[][] = [];

      const flushTable = (key: number) => {
        if (currentTable.length > 0) {
          const hasSeparator = currentTable.length > 1 && currentTable[1].some(cell => cell.includes('---'));
          const headerRows = hasSeparator ? [currentTable[0]] : [currentTable[0]];
          const bodyRows = hasSeparator ? currentTable.slice(2) : currentTable.slice(1);

          elements.push(
            <div key={`table-${key}`} className="my-6 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left table-fixed border-collapse">
                <thead className="bg-indigo-600 text-white">
                  {headerRows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <th key={j} className="p-3 text-xs font-black uppercase tracking-wider border-r border-indigo-500 last:border-0 break-words">
                          {renderInline(cell.trim())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {bodyRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      {row.map((cell, j) => (
                        <td key={j} className="p-3 text-sm text-slate-700 break-words border-r border-slate-50 last:border-0 align-top">
                          {renderInline(cell.trim())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          currentTable = [];
        }
      };

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('|')) {
          const cols = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
          currentTable.push(cols);
        } else {
          flushTable(index);
          if (trimmed) {
            elements.push(
              <div key={index} className="mb-4 text-slate-700 leading-relaxed">
                {renderInline(line)}
              </div>
            );
          } else {
            elements.push(<div key={index} className="h-4" />);
          }
        }
      });
      flushTable(lines.length);
      return elements;
  };

  const renderInline = (text: string) => {
    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts.map((part, i) => {
      if (part.startsWith('$$')) {
        const math = part.slice(2, -2);
        try {
          const html = katex.renderToString(math, { displayMode: true });
          return <div key={i} dangerouslySetInnerHTML={{ __html: html }} className="my-2" />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else if (part.startsWith('$')) {
        const math = part.slice(1, -1);
        try {
          const html = katex.renderToString(math);
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else {
        const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
        return (
          <span key={i}>
            {boldParts.map((sub, j) => {
              if (sub.startsWith('**')) return <strong key={j} className="font-bold text-indigo-900">{sub.slice(2, -2)}</strong>;
              return <span key={j}>{sub.replace(/[#\*]/g, '')}</span>;
            })}
          </span>
        );
      }
    });
  };

  if (state === 'select') {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar">
        <div className="flex items-start justify-center min-h-full p-6 pt-10 animate-in fade-in">
          <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-indigo-100 p-8">
           <div className="text-center mb-8">
             <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-600">
               <AcademicCapIcon className="w-8 h-8" />
             </div>
             <h2 className="text-2xl font-black text-slate-900">Deep Dive Tutor</h2>
             <p className="text-slate-500 mt-2 text-sm">Personalized medical teaching using high-legibility tables and progressive testing.</p>
           </div>
           
           <form onSubmit={handleStart} className="space-y-6">
             <div>
             <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Source Material</label>
             <select 
               value={selectedSource} 
               onChange={(e) => setSelectedSource(e.target.value)}
               className="w-full p-4 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-medium"
             >
                <option value="">Select a Study Guide...</option>
                <optgroup label="Beta Study Guides">
                  {BETA_SOURCES.map((source) => (
                    <option key={source.value} value={source.value}>{source.label}</option>
                  ))}
                </optgroup>
             </select>
           </div>
             
             <div>
               <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Target Concept</label>
               <input 
                 type="text" 
                 value={concept} 
                 onChange={(e) => setConcept(e.target.value)}
                 placeholder="e.g. Addison's Disease, Pharmacokinetics..."
                 className="w-full p-4 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-bold"
               />
             </div>

             {prefabTopicsForSource.length > 0 && (
               <div>
                 <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2">Prefab Topics</label>
                 <div className="max-h-[42vh] overflow-y-auto pr-1 custom-scrollbar">
                   <div className="flex flex-wrap gap-2">
                     {prefabTopicsForSource.map((topic) => {
                       const isActive = normalizeValue(concept) === normalizeValue(topic.concept);
                       return (
                         <button
                           key={topic.concept}
                           type="button"
                           onClick={() => setConcept(topic.concept)}
                           className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                             isActive
                               ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                               : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700'
                           }`}
                         >
                           {topic.concept}
                         </button>
                       );
                     })}
                   </div>
                 </div>
                 <p className="text-[10px] text-slate-400 mt-2">Prefab topics load instantly when cached and help keep costs low.</p>
               </div>
             )}

             <div>
                <div className="flex items-center justify-between mb-2">
                   <label className="text-xs font-bold text-slate-400 uppercase">Challenge Questions</label>
                   <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">5 Questions</span>
                </div>
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                   We’ll start with 5 curated questions. You can add more after the challenge.
                </div>
             </div>

             {error && (
               <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
                 <ExclamationTriangleIcon className="w-5 h-5" /> {error}
               </div>
             )}

             <button 
               type="submit" 
               disabled={!selectedSource || !concept.trim()}
               className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
             >
               Begin Lesson <ArrowRightIcon className="w-5 h-5" />
             </button>
           </form>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
         <div className="w-20 h-20 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-6" />
         <h3 className="text-xl font-bold text-indigo-900 animate-pulse">Building Structured Lesson...</h3>
         <p className="text-slate-500 mt-2 font-medium">Drafting "{concept}" for maximum legibility...</p>
         <button
           onClick={handleCancelLoading}
           className="mt-6 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest hover:bg-slate-50"
         >
           Cancel
         </button>
      </div>
    );
  }

  if (state === 'lesson') {
    return (
      <div className="h-full flex flex-col max-w-5xl mx-auto w-full p-6 animate-in slide-in-from-right-8">
         <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBackToSelect}
                className="px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 hover:border-indigo-200"
              >
                <span className="inline-flex items-center gap-1">
                  <ArrowLeftIcon className="w-4 h-4" />
                  Back
                </span>
              </button>
              <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                <BookOpenIcon className="w-8 h-8 text-indigo-500" />
                Primer: <span className="text-indigo-600">{concept}</span>
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={handleExportPDF} 
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="w-4 h-4" /> 
                {isExporting ? 'Exporting...' : 'Export PDF'}
              </button>
            </div>
         </div>
         
         <div className="flex-1 overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-100 p-10 md:p-14 mb-6 custom-scrollbar">
            <div ref={contentRef} className="max-w-4xl mx-auto">
               <div className="mb-10 border-b border-slate-100 pb-6 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                     <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black">MP</div>
                     <div>
                        <h4 className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">Medical Deep Dive</h4>
                        <h1 className="text-2xl font-black text-slate-900 leading-tight">{concept}</h1>
                     </div>
                  </div>
                  <div className="text-right text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                    Reference Summary
                  </div>
               </div>
               <div className="space-y-4">
                  {renderMarkdown(lessonContent)}
               </div>
            </div>
         </div>

         <div className="flex justify-end">
            <button onClick={handleNext} className="px-10 py-4 bg-indigo-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-indigo-700 transition-all flex items-center gap-3 shadow-xl shadow-indigo-500/20 active:scale-95">
               Test Knowledge <ArrowRightIcon className="w-5 h-5" />
            </button>
         </div>
      </div>
    );
  }

  if (state === 'quiz') {
     const question = quiz[currentQuestionIndex];
     if (!question) return null;
     const progress = quiz.length > 0 ? ((currentQuestionIndex + 1) / quiz.length) * 100 : 0;
     const currentState = deepDiveStates[question.id];
     const canAdvance = Boolean(currentState?.showAnswer);
     
     return (
       <div className="h-full flex flex-col max-w-5xl mx-auto w-full p-6 animate-in slide-in-from-right-8">
          <div className="flex items-center justify-between mb-6">
             <div>
                <span className="text-xs font-black text-indigo-500 uppercase tracking-widest mb-1 block">
                   Challenge Question
                </span>
                <div className="h-2 w-56 bg-slate-100 rounded-full overflow-hidden">
                   <div className="h-full bg-indigo-600 transition-all duration-700" style={{ width: `${progress}%` }}></div>
                </div>
             </div>
             <div className="flex items-center gap-3">
               <button
                 onClick={handleBackToSelect}
                 className="px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 hover:border-indigo-200"
               >
                 <span className="inline-flex items-center gap-1">
                   <ArrowLeftIcon className="w-4 h-4" />
                   Back
                 </span>
               </button>
               <div className="text-slate-400 font-bold text-sm tracking-tight">Q{currentQuestionIndex + 1} / {quiz.length}</div>
             </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
            <QuestionCard
              key={question.id}
              question={question}
              index={currentQuestionIndex}
              onChat={openChatForQuestion}
              savedState={currentState}
              onStateChange={(state) => {
                setDeepDiveStates(prev => ({ ...prev, [question.id]: state }));
                if (state.showAnswer) {
                  const isCorrect = normalizeOptionText(state.selectedOption || '') === normalizeOptionText(question.correctAnswer);
                  setQuizAnswers(prev => {
                    const next = [...prev];
                    next[currentQuestionIndex] = isCorrect;
                    return next;
                  });
                }
              }}
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-slate-400 font-semibold">
              {canAdvance ? 'Rationale reviewed.' : 'Reveal the rationale to continue.'}
            </div>
            <button
              onClick={handleNext}
              disabled={!canAdvance}
              className="px-10 bg-slate-900 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-slate-800 transition-all flex items-center gap-3 shadow-xl shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {currentQuestionIndex < quiz.length - 1 ? 'Next Question' : 'View Results'} <ArrowRightIcon className="w-5 h-5" />
            </button>
          </div>
         <div className={`fixed inset-y-0 right-0 bg-white/95 backdrop-blur-xl shadow-2xl transform transition-transform duration-300 ease-out z-[102] flex flex-col border-l border-slate-200 ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ width: 360 }}>
           <div className="p-5 border-b border-slate-100 bg-white/50">
             <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                   <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                     <ChatBubbleLeftRightIcon className="w-5 h-5" />
                   </div>
                   <div>
                     <h3 className="font-bold text-slate-800 text-sm">Socratic Tutor</h3>
                     <p className="text-[10px] text-slate-400">Deep Dive Assist</p>
                   </div>
                </div>
                <button onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors">
                   <XMarkIcon className="w-5 h-5" />
                </button>
             </div>
             <div className="flex p-1 bg-slate-100 rounded-xl">
               <button onClick={() => setTutorModel('flash')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tutorModel === 'flash' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>Quick</button>
               <button onClick={() => setTutorModel('pro')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tutorModel === 'pro' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>Deep</button>
             </div>
           </div>
           <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
             {currentChatHistory.map((msg, idx) => (
               <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                 <div className={`max-w-[90%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm ${
                   msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white text-slate-700 border border-slate-200 rounded-bl-sm'
                 }`}>
                   {renderChatContent(msg.text)}
                 </div>
               </div>
             ))}
             {isChatLoading && (
               <div className="flex justify-start">
                  <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-sm flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
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
               className="flex-1 px-4 py-3.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-indigo-500 transition-all bg-slate-50" 
             />
             <button 
               type="submit" 
               className="bg-indigo-600 text-white p-3.5 rounded-xl hover:bg-indigo-700 active:scale-90 transition-transform"
             >
               <PaperAirplaneIcon className="w-5 h-5" />
             </button>
           </form>
         </div>
       </div>
     );
  }

  if (state === 'summary') {
     const score = quizAnswers.filter(Boolean).length;
     const percentage = quiz.length ? Math.round((score / quiz.length) * 100) : 0;
     
     return (
       <div className="flex flex-col items-center justify-center h-full animate-in zoom-in-95 duration-500 overflow-y-auto">
          <div className="text-center p-14 bg-white rounded-[3rem] shadow-2xl border border-white max-w-xl w-full my-4">
             <div className="flex justify-center mb-6">
               <button
                 onClick={handleBackToSelect}
                 className="px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 hover:border-indigo-200"
               >
                 <span className="inline-flex items-center gap-1">
                   <ArrowLeftIcon className="w-4 h-4" />
                   Back
                 </span>
               </button>
             </div>
             <TrophyIcon className={`w-28 h-28 mx-auto mb-8 ${percentage === 100 ? 'text-yellow-400 drop-shadow-xl' : 'text-indigo-200'}`} />
             <h2 className="text-5xl font-black text-slate-900 mb-4">{score}/{quiz.length}</h2>
             <p className="text-slate-500 text-lg mb-10 font-medium">
                {percentage === 100 ? "Mastered! You've successfully completed the gauntlet." : 
                 percentage >= 70 ? "Strong performance. Review the primer for a perfect score." : 
                 "Learning in progress. Retake the primer to solidify concepts."}
             </p>
             
             <div className="flex flex-col gap-5 justify-center">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">Add More Questions</div>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{extraCount} Questions</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="15"
                    step="1"
                    value={extraCount}
                    onChange={(e) => setExtraCount(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 mt-1 uppercase font-bold tracking-wider">
                     <span>Quick (3)</span>
                     <span>Deep (15)</span>
                  </div>

                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Difficulty</div>
                    <div className="flex gap-2">
                      {(['easier', 'same', 'harder'] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => setExtraDifficulty(level)}
                          className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                            extraDifficulty === level
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleLoadMore} 
                  disabled={isLoadingMore}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20 active:scale-95 flex items-center justify-center gap-2"
                >
                   {isLoadingMore ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
                   Generate More Questions
                </button>
                <div className="flex gap-4">
                   <button onClick={() => { setState('select'); setConcept(''); setSelectedSource(''); localStorage.removeItem('mediprep_dd_concept'); localStorage.removeItem('mediprep_dd_quiz'); localStorage.removeItem('mediprep_dd_lesson'); }} className="flex-1 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all active:scale-95">
                      New Topic
                   </button>
                   <button onClick={() => setState('lesson')} className="flex-1 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-all active:scale-95">
                      Re-read Lesson
                   </button>
                </div>
             </div>
          </div>
       </div>
     );
  }

  return null;
};

export default DeepDiveView;
