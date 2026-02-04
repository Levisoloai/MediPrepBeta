
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Question, QuestionType, QuestionState, FeedbackTag, QuestionFeedbackPayload } from '../types';
import { submitQuestionFeedback } from '../services/feedbackService';
import { CheckCircleIcon, XCircleIcon, EyeIcon, LightBulbIcon, ChatBubbleLeftRightIcon, TrashIcon, BeakerIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/solid';
import katex from 'katex';

interface QuestionCardProps {
  question: Question;
  index: number;
  userId?: string;
  onChat?: (question: Question) => void;
  onDelete?: (id: string) => void;
  savedState?: QuestionState;
  onStateChange?: (state: QuestionState) => void;
}

const LAB_VALUES = [
  {
    category: "Hematology (CBC)",
    items: [
      { name: "Hemoglobin", normal: "M: 13.5-17.5 g/dL; F: 12.0-15.5 g/dL" },
      { name: "Hematocrit", normal: "M: 41-53%; F: 36-46%" },
      { name: "RBC Count", normal: "M: 4.7-6.1 x10^6/µL; F: 4.2-5.4 x10^6/µL" },
      { name: "WBC", normal: "4.0-11.0 x10^3/µL" },
      { name: "Platelets", normal: "150-450 x10^3/µL" },
      { name: "MCV", normal: "80-100 fL" },
      { name: "Reticulocyte %", normal: "0.5-2.5%" }
    ]
  },
  {
    category: "Coagulation",
    items: [
      { name: "PT", normal: "11-13.5 s" },
      { name: "INR", normal: "0.8-1.2" },
      { name: "aPTT", normal: "25-35 s" },
      { name: "Fibrinogen", normal: "200-400 mg/dL" },
      { name: "D-dimer", normal: "<0.5 µg/mL FEU" }
    ]
  },
  {
    category: "Iron Studies",
    items: [
      { name: "Ferritin", normal: "M: 24-336 ng/mL; F: 11-307 ng/mL" },
      { name: "Serum Iron", normal: "60-170 µg/dL" },
      { name: "TIBC", normal: "240-450 µg/dL" },
      { name: "Transferrin Sat", normal: "20-50%" }
    ]
  },
  {
    category: "Hemolysis Markers",
    items: [
      { name: "LDH", normal: "100-190 U/L" },
      { name: "Haptoglobin", normal: "30-200 mg/dL" },
      { name: "Indirect Bilirubin", normal: "0.2-0.8 mg/dL" }
    ]
  },
  {
    category: "Arterial Blood Gas",
    items: [
      { name: "pH", normal: "7.35-7.45" },
      { name: "PaCO2", normal: "35-45 mmHg" },
      { name: "PaO2", normal: "80-100 mmHg" },
      { name: "HCO3-", normal: "22-26 mEq/L" },
      { name: "SaO2", normal: "95-100%" }
    ]
  },
  {
    category: "Pulmonary Function",
    items: [
      { name: "FEV1/FVC", normal: ">0.70 (adult)" },
      { name: "FEV1", normal: "~80-120% predicted" },
      { name: "FVC", normal: "~80-120% predicted" },
      { name: "TLC", normal: "80-120% predicted" },
      { name: "RV", normal: "80-120% predicted" },
      { name: "DLCO", normal: "80-120% predicted" }
    ]
  }
];

const RATINGS_KEY = 'mediprep_question_ratings';
const HIGHLIGHTS_KEY = 'mediprep_question_highlights';
const HIGHLIGHT_PREF_KEY = 'mediprep_highlight_enabled';
const CONTENT_TAGS: FeedbackTag[] = [
  'Incorrect',
  'Out-of-scope',
  'Ambiguous',
  'Poor explanation',
  'Formatting/typo',
  'Too easy',
  'Too hard',
  'Other'
];

const QuestionCard: React.FC<QuestionCardProps> = ({ question, index, userId, onChat, onDelete, savedState, onStateChange }) => {
  // Initialize state from props (savedState) ONLY. 
  // We do not listen to prop changes for these values to avoid circular update loops (flickering).
  // The unique 'key' prop on the component ensures this resets when the question actually changes.
  const [showAnswer, setShowAnswer] = useState(savedState?.showAnswer || false);
  const [selectedOption, setSelectedOption] = useState<string | null>(savedState?.selectedOption || null);
  const [struckOptions, setStruckOptions] = useState<Set<number>>(new Set(savedState?.struckOptions || []));
  const [showLabs, setShowLabs] = useState(false);
  const [showHistology, setShowHistology] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [highlightEnabled, setHighlightEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(HIGHLIGHT_PREF_KEY);
      return saved ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [highlightsByQuestion, setHighlightsByQuestion] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem(HIGHLIGHTS_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const questionTextRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const firstAnswerAtRef = useRef<number | null>(null);
  const revealAtRef = useRef<number | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{ message: string; tone: 'success' | 'warning' | 'error' } | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportType, setReportType] = useState<'content' | 'bug'>('content');
  const [reportTags, setReportTags] = useState<FeedbackTag[]>([]);
  const [reportComment, setReportComment] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const displayQuestionText = useMemo(() => {
    return (question.questionText || '')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, ' ');
  }, [question.questionText]);
  
  // Sync state UP to parent whenever it changes locally
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        showAnswer,
        selectedOption,
        struckOptions: Array.from(struckOptions)
      });
    }
  }, [showAnswer, selectedOption, struckOptions]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RATINGS_KEY);
      if (!saved) {
        setRating(null);
        return;
      }
      const parsed = JSON.parse(saved);
      setRating(typeof parsed[question.id] === 'number' ? parsed[question.id] : null);
    } catch {
      setRating(null);
    }
  }, [question.id]);

  useEffect(() => {
    try {
      localStorage.setItem(HIGHLIGHT_PREF_KEY, JSON.stringify(highlightEnabled));
    } catch {}
  }, [highlightEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(highlightsByQuestion));
    } catch {}
  }, [highlightsByQuestion]);

  useEffect(() => {
    if (selectedOption && !firstAnswerAtRef.current) {
      firstAnswerAtRef.current = Date.now();
    }
  }, [selectedOption]);

  const persistRating = (value: number) => {
    setRating(value);
    try {
      const saved = localStorage.getItem(RATINGS_KEY);
      const parsed = saved ? JSON.parse(saved) : {};
      parsed[question.id] = value;
      localStorage.setItem(RATINGS_KEY, JSON.stringify(parsed));
    } catch (e) {
      console.warn('Failed to persist rating', e);
    }
  };

  const showFeedbackNotice = (message: string, tone: 'success' | 'warning' | 'error' = 'success') => {
    setFeedbackNotice({ message, tone });
    window.setTimeout(() => setFeedbackNotice(null), 2500);
  };

  const computeMetrics = () => {
    const now = Date.now();
    const start = startTimeRef.current;
    return {
      timeSpentMs: Math.max(0, now - start),
      timeToAnswerMs: firstAnswerAtRef.current ? Math.max(0, firstAnswerAtRef.current - start) : null,
      timeToRevealMs: revealAtRef.current ? Math.max(0, revealAtRef.current - start) : null
    };
  };

  const buildFeedbackPayload = (metrics: ReturnType<typeof computeMetrics>): QuestionFeedbackPayload => ({
    question,
    state: {
      selectedOption,
      showAnswer,
      struckOptions: Array.from(struckOptions),
      highlights
    },
    metrics,
    meta: {
      questionIndex: index + 1,
      capturedAt: new Date().toISOString()
    }
  });

  const getIsCorrect = () => {
    if (!selectedOption) return null;
    return normalizeOptionText(selectedOption) === normalizeOptionText(question.correctAnswer);
  };

  const handleRate = async (value: number) => {
    if (rating === value) return;
    persistRating(value);
    if (!userId) {
      showFeedbackNotice('Log in to submit feedback.', 'error');
      return;
    }

    const metrics = computeMetrics();
    const payload = buildFeedbackPayload(metrics);
    const result = await submitQuestionFeedback({
      userId,
      questionId: question.id,
      kind: 'rating',
      rating: value,
      tags: [],
      comment: null,
      selectedOption,
      isCorrect: getIsCorrect(),
      timeSpentMs: metrics.timeSpentMs,
      payload
    });

    showFeedbackNotice(
      result.queued ? 'Saved locally — will sync.' : 'Rating saved.',
      result.queued ? 'warning' : 'success'
    );
  };

  const toggleReportTag = (tag: FeedbackTag) => {
    setReportTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]));
  };

  const resetReport = () => {
    setIsReportOpen(false);
    setReportType('content');
    setReportTags([]);
    setReportComment('');
    setIsSubmittingReport(false);
  };

  const handleSubmitReport = async () => {
    if (!userId) {
      showFeedbackNotice('Log in to submit feedback.', 'error');
      return;
    }

    const hasContentTags = reportTags.length > 0;
    const hasBugComment = reportComment.trim().length > 0;
    if ((reportType === 'content' && !hasContentTags) || (reportType === 'bug' && !hasBugComment)) {
      showFeedbackNotice('Add a tag or short note first.', 'warning');
      return;
    }

    setIsSubmittingReport(true);
    const metrics = computeMetrics();
    const payload = buildFeedbackPayload(metrics);
    const tags = reportType === 'content' ? reportTags : (['App bug'] as FeedbackTag[]);
    const result = await submitQuestionFeedback({
      userId,
      questionId: question.id,
      kind: 'bug',
      tags,
      comment: reportComment.trim() || null,
      selectedOption,
      isCorrect: getIsCorrect(),
      timeSpentMs: metrics.timeSpentMs,
      payload
    });

    showFeedbackNotice(
      result.queued ? 'Saved locally — will sync.' : 'Report submitted. Thank you!',
      result.queued ? 'warning' : 'success'
    );
    resetReport();
  };

  const highlights = highlightsByQuestion[question.id] || [];
  const normalizedHighlights = useMemo(() => {
    const unique = new Set(
      highlights
        .map(h => h.trim())
        .filter(Boolean)
        .map(h => h.toLowerCase())
    );
    return Array.from(unique);
  }, [highlights]);

  const highlightRegex = useMemo(() => {
    if (!highlightEnabled || normalizedHighlights.length === 0) return null;
    const escaped = normalizedHighlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(${escaped.join('|')})`, 'gi');
  }, [highlightEnabled, normalizedHighlights]);

  const addHighlight = (text: string) => {
    if (!text.trim()) return;
    setHighlightsByQuestion(prev => {
      const current = prev[question.id] || [];
      if (current.some(h => h.toLowerCase() === text.toLowerCase())) return prev;
      return { ...prev, [question.id]: [...current, text.trim()] };
    });
  };

  const removeHighlight = (text: string) => {
    setHighlightsByQuestion(prev => {
      const current = prev[question.id] || [];
      const next = current.filter(h => h !== text);
      return { ...prev, [question.id]: next };
    });
  };

  const clearHighlights = () => {
    setHighlightsByQuestion(prev => ({ ...prev, [question.id]: [] }));
  };

  const isMC = question.type === QuestionType.MULTIPLE_CHOICE || question.type === QuestionType.TRUE_FALSE;

  const handleReveal = () => {
    if (!revealAtRef.current) {
      revealAtRef.current = Date.now();
    }
    setShowAnswer(true);
  };

  const toggleStrike = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (showAnswer) return; 
    
    setStruckOptions(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const renderMessageContent = (text: string, enableHighlights = false) => {
    const highlightSet = new Set(normalizedHighlights);
    const renderWithHighlights = (input: string, keyPrefix: string) => {
      if (!enableHighlights || !highlightRegex) return input;
      const parts = input.split(highlightRegex);
      return parts.map((part, idx) => {
        const isMatch = highlightSet.has(part.toLowerCase());
        if (isMatch) {
          return (
            <mark key={`${keyPrefix}-h-${idx}`} className="bg-amber-200/80 text-slate-900 px-1 rounded-sm">
              {part}
            </mark>
          );
        }
        return <span key={`${keyPrefix}-t-${idx}`}>{part}</span>;
      });
    };

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
                const inner = subPart.slice(2, -2);
                return (
                  <strong key={subIdx} className="font-bold text-slate-900">
                    {renderWithHighlights(inner, `b-${index}-${subIdx}`)}
                  </strong>
                );
              }
              return <span key={subIdx}>{renderWithHighlights(subPart.replace(/\*/g, ''), `t-${index}-${subIdx}`)}</span>;
            })}
          </span>
        );
      }
    });
  };

  const stripOptionPrefix = (text: string) => text.replace(/^[A-E](?:[\)\.\:]|\s)\s*/i, '').trim();
  const normalizeOptionText = (text: string) => stripOptionPrefix(text).toLowerCase();
  const extractOptionLabel = (text: string) => {
    const match = text.trim().match(/^([A-E])/i);
    return match ? match[1].toUpperCase() : null;
  };

  const parseMarkdownTable = (tableMarkdown: string) => {
    const lines = tableMarkdown.trim().split('\n');
    if (lines.length < 2) return null;

    const headers = lines[0].split('|').filter(h => h.trim() !== '').map(h => h.trim());
    const rows = lines.slice(2).map(row => 
       row.split('|').filter(c => c.trim() !== '').map(c => c.trim())
    );

    return { headers, rows };
  };

  const renderTable = (tableMarkdown: string) => {
    const parsed = parseMarkdownTable(tableMarkdown);
    if (!parsed) return null;

    return (
      <div className="overflow-x-auto my-4 border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm text-left">
           <thead className="bg-slate-50 text-slate-700 font-bold uppercase text-xs">
              <tr>
                {parsed.headers.map((h, i) => <th key={i} className="px-4 py-3 border-b border-slate-200">{renderMessageContent(h)}</th>)}
              </tr>
           </thead>
           <tbody className="divide-y divide-slate-100">
              {parsed.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50">
                   {row.map((cell, cIdx) => (
                     <td key={cIdx} className="px-4 py-3 text-slate-700 align-top leading-relaxed">{renderMessageContent(cell)}</td>
                   ))}
                </tr>
              ))}
           </tbody>
        </table>
      </div>
    );
  };

  const renderChoiceAnalysisTable = (tableMarkdown: string) => {
    const parsed = parseMarkdownTable(tableMarkdown);
    if (!parsed) return null;

    const normalizedCorrect = normalizeOptionText(question.correctAnswer);
    const correctIndex = question.options
      ? question.options.findIndex(opt => normalizeOptionText(opt) === normalizedCorrect)
      : -1;
    const answerLabel = correctIndex >= 0 ? String.fromCharCode(65 + correctIndex) : extractOptionLabel(question.correctAnswer);
    const labelOptionText =
      correctIndex >= 0 && question.options && question.options[correctIndex]
        ? question.options[correctIndex]
        : '';
    const normalizedLabelOption = labelOptionText ? normalizeOptionText(labelOptionText) : '';
    const optionOrder = question.options ? question.options.map(opt => normalizeOptionText(opt)) : [];

    const splitIfInstead = (text: string) => {
      const marker = 'if it were instead:';
      const lower = text.toLowerCase();
      const idx = lower.indexOf(marker);
      if (idx === -1) return { main: text.trim(), instead: '' };
      return {
        main: text.slice(0, idx).trim(),
        instead: text.slice(idx + marker.length).trim()
      };
    };

    const rowsWithMeta = parsed.rows.map((row, rIdx) => {
      const optionText = row[0] || '';
      const normalizedOption = normalizeOptionText(optionText);
      let idx = optionOrder.findIndex(opt => opt === normalizedOption);
      if (idx === -1 && normalizedOption) {
        idx = optionOrder.findIndex(opt => opt.includes(normalizedOption) || normalizedOption.includes(opt));
      }
      return { row, rIdx, normalizedOption, optionText, idx };
    });

    rowsWithMeta.sort((a, b) => {
      const aKey = a.idx === -1 ? 1000 + a.rIdx : a.idx;
      const bKey = b.idx === -1 ? 1000 + b.rIdx : b.idx;
      return aKey - bKey;
    });

    return (
      <div className="overflow-x-auto my-4 border border-slate-200 rounded-2xl shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest">
            <tr>
              {parsed.headers.map((h, i) => (
                <th key={i} className="px-4 py-3 border-b border-slate-800">{renderMessageContent(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rowsWithMeta.flatMap((meta) => {
              const { row, rIdx, optionText, normalizedOption, idx } = meta;
              const optionLabel = extractOptionLabel(optionText);
              const rationaleCell = row[1] || '';
              const { main, instead } = splitIfInstead(rationaleCell);
              const hasInstead = Boolean(instead);
              const isCorrect = correctIndex >= 0
                ? idx === correctIndex
                : (
                    (normalizedCorrect && normalizedOption === normalizedCorrect) ||
                    (normalizedLabelOption && normalizedOption === normalizedLabelOption) ||
                    (answerLabel && optionLabel === answerLabel)
                  );

              const rowStyle = isCorrect
                ? { bg: 'bg-emerald-50/80', text: 'text-emerald-900 font-semibold' }
                : hasInstead
                  ? { bg: 'bg-amber-50/70', text: 'text-amber-900' }
                  : { bg: 'bg-rose-50/40', text: 'text-rose-900' };
              const rowHover = isCorrect ? '' : hasInstead ? 'hover:bg-amber-50/80' : 'hover:bg-rose-50/60';

              const mainRow = (
                <tr
                  key={`choice-${rIdx}`}
                  className={`${rowStyle.bg} ${rowHover}`}
                >
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`px-4 py-3 align-top leading-relaxed ${rowStyle.text}`}
                    >
                      {cIdx === 0 ? (
                        <div className="flex items-start justify-between gap-3">
                          <div>{renderMessageContent(stripOptionPrefix(cell) || cell)}</div>
                          {!isCorrect && hasInstead && (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-200 text-amber-900">
                              Near Miss
                            </span>
                          )}
                        </div>
                      ) : (
                        renderMessageContent(main || cell)
                      )}
                    </td>
                  ))}
                </tr>
              );

              const followUpRow = !isCorrect && instead ? (
                <tr key={`choice-${rIdx}-instead`} className="bg-amber-50/60">
                  <td colSpan={parsed.headers.length} className="px-4 py-3 text-amber-900 text-xs font-semibold">
                    <div className="uppercase tracking-widest text-[9px] text-amber-700 font-black">If it were instead</div>
                    <div className="mt-1 text-amber-900 font-semibold text-xs">
                      {renderMessageContent(instead)}
                    </div>
                  </td>
                </tr>
              ) : null;

              return followUpRow ? [mainRow, followUpRow] : [mainRow];
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderExplanation = (text: string) => {
    const isUWorldStyle = text.includes("**Educational Objective:**");

    if (isUWorldStyle) {
        let explanation = "";
        let keyClue = "";
        let diffDiagnosis = "";
        let choiceAnalysis = "";
        let educationalObjective = "";
        let references = "";

        const explanationMatch = text.match(/\*\*Explanation:\*\*\s*([\s\S]*?)(?=\*\*Key Clue:|\*\*Differential Diagnosis:|\*\*Choice Analysis:|$)/i);
        const keyClueMatch = text.match(/\*\*Key Clue:\*\*\s*([\s\S]*?)(?=\*\*Differential Diagnosis:|\*\*Choice Analysis:|\*\*Educational Objective:|\*\*References:|$)/i);
        const diffMatch = text.match(/\*\*Differential Diagnosis:\*\*\s*([\s\S]*?)(?=\*\*Choice Analysis:|$)/i);
        const choiceMatch = text.match(/\*\*Choice Analysis:\*\*\s*([\s\S]*?)(?=\*\*Educational Objective:|$)/i);
        const objectiveMatch = text.match(/\*\*Educational Objective:\*\*\s*([\s\S]*?)(?=\*\*References:|$)/i);
        const refMatch = text.match(/\*\*References:\*\*\s*([\s\S]*)/i);

        if (explanationMatch) explanation = explanationMatch[1].trim();
        if (keyClueMatch) keyClue = keyClueMatch[1].trim();
        if (diffMatch) diffDiagnosis = diffMatch[1].trim();
        if (choiceMatch) choiceAnalysis = choiceMatch[1].trim();
        if (objectiveMatch) educationalObjective = objectiveMatch[1].trim();
        if (refMatch) references = refMatch[1].trim();

        return (
             <div className="mt-8 space-y-8 animate-in fade-in duration-500">
                <div>
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Explanation</h4>
                  <div className="text-slate-800 text-sm md:text-base leading-relaxed space-y-4">
                     {renderMessageContent(explanation)}
                  </div>
                </div>

                {keyClue && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="px-5 py-3 border-b border-amber-200/60 flex items-center gap-2">
                      <div className="bg-amber-500 rounded-lg p-1 text-white shadow-sm shadow-amber-400/30">
                        <LightBulbIcon className="w-4 h-4" />
                      </div>
                      <h4 className="font-bold text-amber-900 text-xs uppercase tracking-wide">Key Clue</h4>
                    </div>
                    <div className="p-5 text-sm md:text-base leading-relaxed text-amber-900 font-semibold">
                      {renderMessageContent(keyClue)}
                    </div>
                  </div>
                )}

                {diffDiagnosis && (
                   <div>
                     <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Differential Diagnosis</h4>
                     {renderTable(diffDiagnosis) || <div className="text-slate-700 text-sm">{renderMessageContent(diffDiagnosis)}</div>}
                   </div>
                )}

                {choiceAnalysis && (
                  <div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Answer Choice Analysis</h4>
                    {renderChoiceAnalysisTable(choiceAnalysis) || renderTable(choiceAnalysis) || (
                      <div className="text-slate-700 text-sm leading-relaxed space-y-3 pl-4 border-l-4 border-slate-100">
                         {renderMessageContent(choiceAnalysis)}
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400 mt-2 uppercase font-bold tracking-widest">Green = correct, Yellow = near-miss, Red = incorrect</p>
                  </div>
                )}

                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl overflow-hidden shadow-sm">
                   <div className="px-5 py-3 border-b border-blue-100/50 flex items-center gap-2">
                      <div className="bg-blue-600 rounded-lg p-1 text-white shadow-sm shadow-blue-500/30">
                        <LightBulbIcon className="w-4 h-4" />
                      </div>
                      <h4 className="font-bold text-blue-900 text-xs uppercase tracking-wide">Educational Objective</h4>
                   </div>
                   <div className="p-5 text-sm md:text-base leading-relaxed text-slate-800 font-medium">
                      {renderMessageContent(educationalObjective)}
                   </div>
                </div>

                {references && (
                 <div className="text-xs text-slate-400 mt-2 p-4 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-500 uppercase tracking-wide">References</span>
                    <div className="mt-1">{renderMessageContent(references)}</div>
                 </div>
               )}
             </div>
        );
    }
    
    return (
      <div className="mt-8">
        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Rationale</h4>
        <p className="text-slate-700 text-sm md:text-base leading-relaxed">{renderMessageContent(text)}</p>
      </div>
    );
  };

  const canSubmitReport = reportType === 'content'
    ? reportTags.length > 0
    : reportComment.trim().length > 0;

  return (
    <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-white overflow-hidden transition-all hover:shadow-2xl hover:shadow-slate-200/70 relative ring-1 ring-slate-100 group/card animate-in fade-in slide-in-from-bottom-4 duration-300">
      
      <div className="p-6 md:p-10">
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-center gap-3">
             <span className="inline-flex items-center px-3 py-1.5 rounded-xl text-[10px] font-black bg-slate-900 text-white uppercase tracking-widest">
               Item #{index + 1}
             </span>
             <span className="text-[10px] text-slate-400 uppercase tracking-widest font-black">
               {question.difficulty}
             </span>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Rate</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    onClick={() => handleRate(value)}
                    className={`w-6 h-6 rounded-lg text-[10px] font-black transition-all border ${
                      rating === value
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-400 border-slate-200 hover:text-slate-700 hover:border-slate-400'
                    }`}
                    title={`Rate ${value} / 5`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setHighlightEnabled(prev => !prev)}
                className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-colors ${
                  highlightEnabled
                    ? 'bg-amber-100 text-amber-900 border-amber-200'
                    : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                }`}
                title="Toggle text highlight"
              >
                Highlight {highlightEnabled ? 'On' : 'Off'}
              </button>
              <button
                onClick={() => setIsReportOpen(true)}
                className="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 transition-colors flex items-center gap-1"
                title="Report an issue"
              >
                <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                Report
              </button>
            </div>
            {feedbackNotice && (
              <div
                className={`text-[10px] font-black uppercase tracking-widest ${
                  feedbackNotice.tone === 'success'
                    ? 'text-emerald-600'
                    : feedbackNotice.tone === 'warning'
                    ? 'text-amber-600'
                    : 'text-rose-600'
                }`}
              >
                {feedbackNotice.message}
              </div>
            )}
            <div className="flex gap-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
              <button 
                onClick={() => setShowLabs(!showLabs)}
                className={`p-2.5 rounded-xl transition-colors border ${
                  showLabs
                    ? 'bg-teal-50 text-teal-700 border-teal-200'
                    : 'text-slate-400 hover:text-teal-600 hover:bg-teal-50 border-transparent hover:border-teal-100'
                }`}
                title="Normal Lab Values"
              >
                <BeakerIcon className="w-5 h-5" />
              </button>
              {onChat && (
                <button 
                  onClick={() => onChat(question)}
                  className="p-2.5 rounded-xl text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-100"
                  title="Ask AI Tutor"
                >
                  <ChatBubbleLeftRightIcon className="w-5 h-5" />
                </button>
              )}
              {onDelete && (
                <button 
                  onClick={() => onDelete(question.id)}
                  className="p-2.5 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
                  title="Dismiss Prediction"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div
          ref={questionTextRef}
          onMouseUp={() => {
            if (!highlightEnabled) return;
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) return;
            const text = selection.toString().trim();
            if (text.length < 2) return;
            if (!questionTextRef.current) return;
            if (!selection.anchorNode || !selection.focusNode) return;
            const within =
              questionTextRef.current.contains(selection.anchorNode) &&
              questionTextRef.current.contains(selection.focusNode);
            if (!within) return;
            addHighlight(text);
            selection.removeAllRanges();
          }}
        >
          <h3 className="text-slate-800 font-bold text-lg md:text-xl leading-relaxed mb-4 whitespace-pre-wrap tracking-tight">
            {renderMessageContent(displayQuestionText, true)}
          </h3>
        </div>

        {question.histology && (
          <div className="mb-6">
            <button
              onClick={() => setShowHistology((prev) => !prev)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest transition-colors ${
                showHistology
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-slate-500 border-slate-200 hover:text-emerald-700 hover:border-emerald-200'
              }`}
            >
              {showHistology ? 'Hide Histology' : 'Show Histology'}
            </button>
            {showHistology && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                  {showAnswer ? (question.histology.title || 'Histology') : 'Histology (label hidden)'}
                </div>
                <div className="flex justify-center">
                  <img
                    src={question.histology.imageUrl}
                    alt={question.histology.title || 'Histology image'}
                    className="max-h-[320px] w-auto rounded-xl border border-slate-200 bg-white"
                  />
                </div>
                {question.histology.caption && showAnswer && (
                  <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                    {question.histology.caption}
                  </p>
                )}
                {!showAnswer && (
                  <p className="mt-3 text-[11px] text-slate-400">
                    Reveal the answer to see the image label and caption.
                  </p>
                )}
                {showAnswer && (question.histology.source || question.histology.attribution || question.histology.license) && (
                  <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                    {question.histology.source && <span>Source: {question.histology.source}</span>}
                    {question.histology.attribution && (
                      <span>{question.histology.source ? ' • ' : ''}Attribution: {question.histology.attribution}</span>
                    )}
                    {question.histology.license && (
                      <span>{question.histology.source || question.histology.attribution ? ' • ' : ''}License: {question.histology.license}</span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {highlightEnabled && highlights.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {highlights.map((h, idx) => (
              <button
                key={`${h}-${idx}`}
                onClick={() => removeHighlight(h)}
                className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase tracking-widest border border-amber-200 hover:bg-amber-200/70 transition-colors"
                title="Remove highlight"
              >
                {h}
              </button>
            ))}
            <button
              onClick={clearHighlights}
              className="px-2.5 py-1 rounded-full bg-white text-slate-400 text-[10px] font-black uppercase tracking-widest border border-slate-200 hover:text-slate-600"
            >
              Clear
            </button>
          </div>
        )}

        {showLabs && (
          <div className="mb-8 bg-slate-50/70 border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <BeakerIcon className="w-4 h-4 text-teal-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Normal Labs (Pulm + Heme)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {LAB_VALUES.map((section, idx) => (
                <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">{section.category}</div>
                  <div className="space-y-2">
                    {section.items.map((item, j) => (
                      <div key={j} className="flex items-start justify-between gap-3 text-xs">
                        <span className="font-semibold text-slate-700">{item.name}</span>
                        <span className="text-slate-500 font-mono">{item.normal}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isMC && question.options && (
          <div className="space-y-3 mb-10">
            <div className="text-[10px] text-slate-400 text-right font-black uppercase tracking-widest mb-3">Diagnostic Input</div>
            {question.options.map((option, idx) => {
              const isCorrect = normalizeOptionText(option) === normalizeOptionText(question.correctAnswer);
              const isSelected = selectedOption === option;
              const isStruck = struckOptions.has(idx);
              const displayOption = stripOptionPrefix(option) || option;
              
              let btnClass = "w-full text-left p-6 rounded-2xl border transition-all relative group flex items-start gap-4 ";
              if (showAnswer) {
                if (isCorrect) btnClass += "bg-green-50/50 border-green-300 text-green-900 shadow-sm";
                else if (isSelected) btnClass += "bg-red-50/50 border-red-200 text-red-900";
                else btnClass += "bg-slate-50 border-transparent text-slate-400 opacity-50";
              } else {
                if (isSelected) btnClass += "bg-teal-50 border-teal-500 text-teal-900 shadow-md shadow-teal-500/10 ring-1 ring-teal-500";
                else if (isStruck) btnClass += "bg-slate-50 border-transparent text-slate-300 opacity-60 grayscale";
                else btnClass += "bg-white border-slate-200 text-slate-600 hover:border-teal-300 hover:bg-slate-50 hover:shadow-sm";
              }

              return (
                <button
                  key={idx}
                  onClick={() => {
                     if (!showAnswer && !isStruck) setSelectedOption(option);
                  }}
                  onContextMenu={(e) => toggleStrike(e, idx)}
                  className={btnClass}
                  disabled={showAnswer}
                >
                    <span className={`w-8 h-8 rounded-xl border border-current flex-shrink-0 flex items-center justify-center text-[10px] font-black transition-all ${isSelected && !showAnswer ? 'bg-teal-600 text-white border-teal-600' : 'opacity-40'} ${isStruck && !showAnswer ? 'line-through' : ''}`}>
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className={`flex-1 text-sm md:text-base pt-1 font-bold ${isStruck && !showAnswer ? 'line-through decoration-2 decoration-slate-300' : ''}`}>
                      {renderMessageContent(displayOption)}
                    </span>
                    {showAnswer && isCorrect && <CheckCircleIcon className="w-6 h-6 text-green-500 absolute right-6 top-1/2 -translate-y-1/2" />}
                    {showAnswer && isSelected && !isCorrect && <XCircleIcon className="w-6 h-6 text-red-500 absolute right-6 top-1/2 -translate-y-1/2" />}
                </button>
              );
            })}
          </div>
        )}

        {!showAnswer && (
          <button
            onClick={handleReveal}
            className="w-full py-5 rounded-2xl flex items-center justify-center gap-3 font-black text-sm bg-slate-900 text-white hover:bg-slate-800 transition-all uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95"
          >
            <EyeIcon className="w-5 h-5" /> Reveal Rationale
          </button>
        )}
      </div>

      {showAnswer && (
        <div className="bg-slate-50/50 border-t border-slate-100 p-8 md:p-12 animate-in slide-in-from-bottom-2 duration-500">
          <div className="mb-10">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Correct Diagnostic Path</h4>
            <div className="text-slate-900 font-black text-xl bg-green-100/50 border border-green-200 p-6 rounded-2xl text-green-900 shadow-sm">
               {(() => {
                 const normalizedCorrect = normalizeOptionText(question.correctAnswer);
                 const correctIndex = question.options
                   ? question.options.findIndex(opt => normalizeOptionText(opt) === normalizedCorrect)
                   : -1;
                 const label = correctIndex >= 0 ? String.fromCharCode(65 + correctIndex) : '';
                 const display = stripOptionPrefix(question.correctAnswer) || question.correctAnswer;
                 return renderMessageContent(label ? `${label}. ${display}` : display);
               })()}
            </div>
          </div>
          
          {renderExplanation(question.explanation)}
          
          <div className="flex flex-wrap gap-2 mt-12 pt-8 border-t border-slate-200/60">
            {question.studyConcepts.map((concept, i) => (
              <span key={i} className="px-4 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest shadow-sm">
                {concept}
              </span>
            ))}
          </div>

        </div>
      )}

      {isReportOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 relative">
            <button
              onClick={resetReport}
              className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
              aria-label="Close report"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-rose-100 text-rose-600 rounded-xl">
                  <ExclamationTriangleIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-800">Report an Issue</h3>
                  <p className="text-xs text-slate-500">Your feedback makes the beta smarter.</p>
                </div>
              </div>

              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => {
                    setReportType('content');
                    setReportTags([]);
                    setReportComment('');
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                    reportType === 'content'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                  }`}
                >
                  Content Issue
                </button>
                <button
                  onClick={() => {
                    setReportType('bug');
                    setReportTags([]);
                    setReportComment('');
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                    reportType === 'bug'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                  }`}
                >
                  App / UX Bug
                </button>
              </div>

              {reportType === 'content' ? (
                <div className="mb-5">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                    Tag what went wrong
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CONTENT_TAGS.map(tag => {
                      const active = reportTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleReportTag(tag)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${
                            active
                              ? 'bg-amber-100 text-amber-900 border-amber-200'
                              : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mb-5">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                    Describe the bug
                  </div>
                </div>
              )}

              <textarea
                value={reportComment}
                onChange={(e) => setReportComment(e.target.value)}
                rows={4}
                placeholder={reportType === 'content' ? 'Optional context (what made it confusing?)' : 'What happened? Steps to reproduce?'}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-medium outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200/60 transition-all"
              />

              <div className="flex gap-3 mt-6">
                <button
                  onClick={resetReport}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-400 font-black uppercase tracking-widest text-[10px] hover:text-slate-600 hover:border-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitReport}
                  disabled={!canSubmitReport || isSubmittingReport}
                  className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all ${
                    !canSubmitReport || isSubmittingReport
                      ? 'bg-slate-200 text-slate-400'
                      : 'bg-rose-600 text-white hover:bg-rose-700 shadow-lg shadow-rose-600/20 active:scale-95'
                  }`}
                >
                  {isSubmittingReport ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>

              <p className="text-[10px] text-slate-400 mt-4">
                We capture a snapshot of the question and your selections to improve accuracy.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuestionCard;
