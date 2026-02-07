import React, { useState, useEffect } from 'react';
import { UserPreferences, QuestionType, DifficultyLevel, StudyFile, ExamFormat, CardStyle, StudyGuideItem } from '../types';
import { ClipboardDocumentCheckIcon, ExclamationTriangleIcon, AdjustmentsHorizontalIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
import { buildStudyGuideItems } from '../utils/studyGuide';
import { betaGuides, BetaGuide } from '../utils/betaGuides';

type GenerateContext =
  | {
      guideHash: string;
      guideItems: StudyGuideItem[];
      guideTitle: string;
      moduleId: 'heme' | 'pulm';
    }
  | {
      guideHash: string;
      guideItems: StudyGuideItem[];
      guideTitle: string;
      moduleId: 'mixed';
      mixedModules: Array<{
        content: string;
        guideHash: string;
        guideItems: StudyGuideItem[];
        guideTitle: string;
        moduleId: 'heme' | 'pulm';
      }>;
    };

interface InputSectionProps {
  onGenerate: (
    content: string,
    lectureFiles: StudyFile[],
    studyGuideFile: StudyFile | null,
    prefs: UserPreferences,
    context?: GenerateContext,
    subjectId?: string
  ) => void;
  mode?: 'questions' | 'cheatsheet' | 'summary';
  onUsePrefab?: (guide: BetaGuide) => void;
  onGenerateCustom?: (
    content: string,
    lectureFiles: StudyFile[],
    studyGuideFile: StudyFile | null,
    prefs: UserPreferences,
    context?: {
      guideHash: string;
      guideItems: StudyGuideItem[];
      guideTitle: string;
      moduleId: 'heme' | 'pulm';
    },
    topic?: string
  ) => void;
  customOpen?: boolean;
  onCustomToggle?: (open: boolean) => void;
  isLoading: boolean;
  onOpenOnboarding?: () => void;
}

const MAX_TEXT_CHARS = 120000;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const InputSection: React.FC<InputSectionProps> = ({
  onGenerate,
  onUsePrefab,
  onGenerateCustom,
  customOpen,
  onCustomToggle,
  isLoading,
  onOpenOnboarding,
  mode = 'questions'
}) => {
  const isCheatSheetMode = mode === 'cheatsheet' || mode === 'summary';
  const formatSeconds = (totalSeconds: number) => {
    const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };
  const [selectedGuide, setSelectedGuide] = useState<BetaGuide | null>(null);
  const [mixedBlockEnabled, setMixedBlockEnabled] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [readingGuideId, setReadingGuideId] = useState<'heme' | 'pulm' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [studyGuideText, setStudyGuideText] = useState('');
  const [guideTextById, setGuideTextById] = useState<{ heme: string; pulm: string }>({ heme: '', pulm: '' });
  const [isTruncated, setIsTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCustomGenerator, setShowCustomGenerator] = useState(false);
  const [customTopic, setCustomTopic] = useState('');

  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    const saved = localStorage.getItem('mediprep_beta_prefs');
    if (saved) {
      const parsed = JSON.parse(saved);
      const safeCount = Math.min(20, Math.max(3, Number(parsed.questionCount) || 10));
      const safeMode = parsed.sessionMode === 'funnel' ? 'funnel' : 'standard';
      const safeStyle = parsed.sessionStyle === 'block' && safeMode !== 'funnel' ? 'block' : 'practice';
      return {
        ...parsed,
        questionCount: safeCount,
        sessionStyle: safeStyle,
        sessionMode: safeMode,
        autoQuestionCount: false
      };
    }
    return {
      generationMode: 'questions',
      questionType: QuestionType.MULTIPLE_CHOICE,
      difficulty: DifficultyLevel.CLINICAL_VIGNETTE,
      questionCount: 10,
      autoQuestionCount: false,
      sessionStyle: 'practice',
      sessionMode: 'standard',
      customInstructions: '',
      focusedOnWeakness: false,
      examFormat: ExamFormat.NBME,
      cardStyle: CardStyle.BASIC
    };
  });

  useEffect(() => {
    localStorage.setItem('mediprep_beta_prefs', JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const mixedAllowed = preferences.sessionStyle === 'block' || preferences.sessionMode === 'funnel';
    if (!mixedAllowed && mixedBlockEnabled) {
      setMixedBlockEnabled(false);
    }
  }, [preferences.sessionStyle, preferences.sessionMode, mixedBlockEnabled]);

  useEffect(() => {
    if (typeof customOpen === 'boolean') {
      setShowCustomGenerator(customOpen);
    }
  }, [customOpen]);

  const loadGuideText = async (guide: BetaGuide) => {
    if (isReading) return null;
    setIsReading(true);
    setReadingGuideId(guide.id);
    setUploadProgress(0);
    setIsTruncated(false);
    setLoadError(null);
    try {
      const response = await fetch(guide.pdfUrl);
      if (!response.ok) {
        throw new Error('Guide PDF not found. Make sure it exists in public/beta-guides.');
      }
      const arrayBuffer = await response.arrayBuffer();
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
        setUploadProgress(Math.round((pageNum / totalPages) * 100));

        if (fullText.length >= MAX_TEXT_CHARS) {
          fullText = fullText.slice(0, MAX_TEXT_CHARS);
          setIsTruncated(true);
          break;
        }
      }

      const text = fullText.trim();
      setGuideTextById((prev) => ({ ...prev, [guide.id]: text }));
      return text;
    } catch (err) {
      console.error('Guide extraction failed', err);
      setLoadError('Failed to load this guide. Please try again or check the PDF path.');
      setGuideTextById((prev) => ({ ...prev, [guide.id]: '' }));
      return null;
    } finally {
      setIsReading(false);
      setReadingGuideId(null);
      setUploadProgress(0);
    }
  };

  const handleSelectGuide = async (guide: BetaGuide) => {
    if (isReading) return;
    if (mixedBlockEnabled) setMixedBlockEnabled(false);
    setSelectedGuide(guide);
    setStudyGuideText('');
    const existing = guideTextById[guide.id]?.trim();
    if (existing) {
      setStudyGuideText(existing);
      return;
    }
    const text = await loadGuideText(guide);
    setStudyGuideText(text || '');
  };

  const enableMixedBlock = async () => {
    if (isReading) return;
    setMixedBlockEnabled(true);
    setSelectedGuide(null);
    // Ensure both guides are loaded (sequential for clearer progress feedback).
    for (const guide of betaGuides) {
      const existing = guideTextById[guide.id]?.trim();
      if (existing) continue;
      // eslint-disable-next-line no-await-in-loop
      await loadGuideText(guide);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mixedBlockEnabled) {
      const hemeText = guideTextById.heme?.trim();
      const pulmText = guideTextById.pulm?.trim();
      if (!hemeText || !pulmText) return;

      const [{ guideHash: hemeHash, guideItems: hemeItemsRaw }, { guideHash: pulmHash, guideItems: pulmItemsRaw }] =
        await Promise.all([buildStudyGuideItems(hemeText), buildStudyGuideItems(pulmText)]);

      const hemeItems = hemeItemsRaw.map((item) => ({ ...item, id: `heme-${item.id}` }));
      const pulmItems = pulmItemsRaw.map((item) => ({ ...item, id: `pulm-${item.id}` }));
      const mixedHash = `mixed_${hemeHash}_${pulmHash}`;
      const combinedContent = `${hemeText}\n\n${pulmText}`;

      onGenerate(
        combinedContent,
        [],
        null,
        {
          ...preferences,
          generationMode: isCheatSheetMode ? 'summary' : 'questions',
          focusedOnWeakness: false
        },
        {
          guideHash: mixedHash,
          guideItems: [...hemeItems, ...pulmItems],
          guideTitle: 'Pulm + Heme (Mixed Block)',
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
        }
      );
      return;
    }

    if (!selectedGuide || !studyGuideText.trim()) return;

    const { guideHash, guideItems } = await buildStudyGuideItems(studyGuideText);

    onGenerate(
      studyGuideText,
      [],
      null,
      {
        ...preferences,
        generationMode: isCheatSheetMode ? 'summary' : 'questions',
        focusedOnWeakness: false
      },
      {
        guideHash,
        guideItems,
        guideTitle: selectedGuide.title,
        moduleId: selectedGuide.id
      }
    );
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mixedBlockEnabled) return;
    if (!selectedGuide || !studyGuideText.trim() || !onGenerateCustom) return;

    const { guideHash, guideItems } = await buildStudyGuideItems(studyGuideText);
    onGenerateCustom(
      studyGuideText,
      [],
      null,
      {
        ...preferences,
        generationMode: 'questions',
        focusedOnWeakness: false
      },
      {
        guideHash,
        guideItems,
        guideTitle: selectedGuide.title,
        moduleId: selectedGuide.id
      },
      customTopic
    );
  };

  const toggleCustomGenerator = () => {
    const next = !showCustomGenerator;
    setShowCustomGenerator(next);
    onCustomToggle?.(next);
  };

  const canSubmit =
    mixedBlockEnabled
      ? Boolean(guideTextById.heme?.trim() && guideTextById.pulm?.trim())
      : Boolean(selectedGuide && studyGuideText.trim());

  return (
    <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-white h-full flex flex-col overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-teal-400 to-indigo-400" />

      <div className="p-8 pb-4">
        <div className="flex items-center gap-4 mb-2">
           <div className="p-3 rounded-2xl bg-teal-50 text-teal-600">
             <ClipboardDocumentCheckIcon className="w-8 h-8" />
           </div>
           <div>
               <h2 className="text-2xl font-black text-slate-800 tracking-tight">
                 {isCheatSheetMode ? 'Cheat Sheet Builder' : 'Choose Your Beta Module'}
               </h2>
               <p className="text-sm text-slate-500 font-medium">
                 {isCheatSheetMode
                   ? 'Generate a last-minute rapid review for Heme or Pulm.'
                   : 'Select Heme or Pulm to generate NBME-style practice questions.'}
               </p>
           </div>
           {onOpenOnboarding && (
             <button
               onClick={onOpenOnboarding}
               className="ml-auto px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-teal-600 hover:border-teal-200 hover:bg-teal-50 transition-colors"
             >
               Getting Started
             </button>
           )}
        </div>
      </div>

      <div className="flex-1 px-8 py-4 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Getting Started</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600 font-medium">
            <div><span className="text-slate-800 font-black">1.</span> Choose a module (Heme or Pulm).</div>
            {isCheatSheetMode ? (
              <>
                <div><span className="text-slate-800 font-black">2.</span> Open the prefab quick review or generate a fresh sheet.</div>
                <div><span className="text-slate-800 font-black">3.</span> Download as PDF for last‑minute review.</div>
              </>
            ) : (
              <>
                <div><span className="text-slate-800 font-black">2.</span> Adjust question count.</div>
                <div><span className="text-slate-800 font-black">3.</span> Use Custom Generator to set difficulty + topic.</div>
                <div><span className="text-slate-800 font-black">4.</span> Generate questions and begin practicing.</div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {betaGuides.map((guide) => {
              const hasText = Boolean(guideTextById[guide.id]?.trim());
              const isSelected = mixedBlockEnabled || selectedGuide?.id === guide.id;
              const isLoadingThis = isReading && readingGuideId === guide.id;
              const isLoaded = hasText;
              return (
                <button
                  key={guide.id}
                  onClick={() => handleSelectGuide(guide)}
                  className={`text-left rounded-3xl border-2 p-6 transition-all duration-300 ${
                    isSelected ? 'border-teal-400 bg-teal-50/40' : 'border-slate-200 hover:border-teal-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-black text-slate-800">{guide.title}</h4>
                      <p className="text-sm text-slate-500 mt-1">{guide.description}</p>
                    </div>
                    {isLoaded && (
                      <div className="flex items-center gap-1 text-teal-600 text-xs font-semibold">
                        <CheckCircleIcon className="w-4 h-4" /> Ready
                      </div>
                    )}
                  </div>
                  <div className="mt-4 text-[10px] uppercase tracking-widest font-black text-slate-400">
                    {isLoadingThis
                      ? 'Loading guide…'
                      : isLoaded
                      ? 'Guide loaded'
                      : mixedBlockEnabled
                      ? 'Needed for mixed block'
                      : isSelected
                      ? 'Selected'
                      : 'Select module'}
                  </div>
                </button>
              );
            })}
          </div>

          {isReading && (
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}

          {loadError && (
            <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 rounded-xl border border-rose-100 text-rose-600 text-xs font-semibold">
              <ExclamationTriangleIcon className="w-4 h-4" />
              {loadError}
            </div>
          )}

          {isTruncated && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 rounded-xl border border-amber-100 text-amber-700 text-xs font-semibold">
              <ExclamationTriangleIcon className="w-4 h-4" />
              Text truncated for model limits. Consider a shorter guide for higher fidelity.
            </div>
          )}
        </div>

        <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100 space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <AdjustmentsHorizontalIcon className="w-5 h-5 text-slate-400" />
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Configuration</h3>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-xs font-bold text-slate-600">Selected Module</div>
            <div className="text-sm font-semibold text-teal-700 mt-1">
              {mixedBlockEnabled ? 'Pulm + Heme (Mixed)' : selectedGuide ? selectedGuide.title : 'None selected'}
            </div>
          </div>

          {!isCheatSheetMode && (
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-slate-600">Question Count</span>
                <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">{preferences.questionCount} Questions</span>
              </div>
              <input 
                type="range" 
                min="3" max="20" 
                value={preferences.questionCount}
                onChange={(e) => setPreferences(p => ({ ...p, questionCount: parseInt(e.target.value, 10), autoQuestionCount: false }))}
                className="w-full accent-teal-600 h-1.5 bg-slate-100 rounded-full appearance-none cursor-pointer"
              />
            </div>
          )}

          {!isCheatSheetMode && (
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-slate-600">Session Mode</span>
                {preferences.sessionStyle === 'block' && preferences.sessionMode !== 'funnel' && (
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                    Time limit: {formatSeconds(preferences.questionCount * 90)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPreferences(p => ({ ...p, sessionStyle: 'practice', sessionMode: 'standard' }))}
                  className={`px-3 py-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors ${
                    preferences.sessionMode !== 'funnel' && preferences.sessionStyle !== 'block'
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Practice (Immediate)
                </button>
                <button
                  type="button"
                  onClick={() => setPreferences(p => ({ ...p, sessionStyle: 'block', sessionMode: 'standard' }))}
                  className={`px-3 py-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors ${
                    preferences.sessionMode !== 'funnel' && preferences.sessionStyle === 'block'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  NBME Block (Timed)
                </button>
                <button
                  type="button"
                  onClick={() => setPreferences(p => ({ ...p, sessionStyle: 'practice', sessionMode: 'funnel' }))}
                  className={`px-3 py-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors ${
                    preferences.sessionMode === 'funnel'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Funnel (Adaptive)
                </button>
              </div>
              {preferences.sessionStyle === 'block' && preferences.sessionMode !== 'funnel' && (
                <div className="mt-2 text-[11px] text-slate-500 font-semibold">
                  No explanations until you submit the block or time expires.
                </div>
              )}
              {preferences.sessionMode === 'funnel' && (
                <div className="mt-2 text-[11px] text-slate-500 font-semibold">
                  Adaptive targeting based on correctness, time, tutor usage, and Anki rating. Uses bank first; generates only if needed.
                </div>
              )}
            </div>
          )}

          {!isCheatSheetMode && (preferences.sessionStyle === 'block' || preferences.sessionMode === 'funnel') && (
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-slate-600">
                  {preferences.sessionStyle === 'block' && preferences.sessionMode !== 'funnel' ? 'Block Mix' : 'Module Mix'}
                </span>
                {mixedBlockEnabled && (
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                    Pulm + Heme
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMixedBlockEnabled(false)}
                  disabled={isReading}
                  className={`px-3 py-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors ${
                    !mixedBlockEnabled
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  } ${isReading ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  Single Module
                </button>
                <button
                  type="button"
                  onClick={enableMixedBlock}
                  disabled={isReading}
                  className={`px-3 py-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-colors ${
                    mixedBlockEnabled
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  } ${isReading ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  Pulm + Heme
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 font-semibold">
                Splits questions roughly 50/50 to simulate exam conditions.
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Focus Instructions (Optional)</label>
            <textarea
              value={preferences.customInstructions}
              onChange={(e) => setPreferences(p => ({ ...p, customInstructions: e.target.value }))}
              placeholder={isCheatSheetMode
                ? 'e.g., Emphasize last-minute review, include key tables and pitfalls'
                : 'e.g., Emphasize pulmonology + hematology, include next-best-step questions'}
              className="w-full p-3 rounded-2xl border border-slate-200 text-xs bg-white focus:ring-2 focus:ring-teal-500/20 outline-none resize-none h-20 transition-all"
            />
          </div>

          {!isCheatSheetMode && (
            <div className="border border-slate-200 rounded-2xl p-4 bg-white/80">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Custom Generator</div>
                  <div className="text-sm font-semibold text-slate-700">
                    Want to set difficulty + topic?
                  </div>
                </div>
                <button
                  onClick={toggleCustomGenerator}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50"
                >
                  {showCustomGenerator ? 'Hide' : 'Try generating your own questions'}
                </button>
              </div>

              {showCustomGenerator && (
                <div className="mt-4 space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                    Topic Focus (Optional)
                    <input
                      value={customTopic}
                      onChange={(e) => setCustomTopic(e.target.value)}
                      placeholder="e.g., Hemolytic anemia, ARDS, COPD exacerbation"
                      className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 bg-white"
                    />
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                    Difficulty
                    <select
                      value={preferences.difficulty}
                      onChange={(e) => setPreferences(p => ({ ...p, difficulty: e.target.value as DifficultyLevel }))}
                      className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 bg-white"
                    >
                      <option value={DifficultyLevel.EASY}>Easy</option>
                      <option value={DifficultyLevel.MEDIUM}>Medium</option>
                      <option value={DifficultyLevel.HARD}>Hard</option>
                      <option value={DifficultyLevel.CLINICAL_VIGNETTE}>Clinical Vignette (USMLE Style)</option>
                    </select>
                  </label>
                  <button
                    onClick={handleCustomSubmit}
                    disabled={isLoading || !selectedGuide || !studyGuideText.trim() || isReading || !onGenerateCustom}
                    className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all ${
                      isLoading || isReading || !selectedGuide || !studyGuideText.trim() || !onGenerateCustom
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {isLoading ? 'Processing...' : 'Generate Custom Questions'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-8 pt-4 bg-white border-t border-slate-100 sticky bottom-0 z-10">
        <div className={`grid gap-3 ${isCheatSheetMode ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
          {isCheatSheetMode && onUsePrefab && (
            <button
              onClick={() => selectedGuide && onUsePrefab(selectedGuide)}
              disabled={!selectedGuide || isReading}
              className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all transform active:scale-95 ${
                !selectedGuide || isReading
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-white text-teal-700 border border-teal-200 hover:bg-teal-50'
              }`}
            >
              Open Quick Review
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={isLoading || isReading || !canSubmit}
            className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all transform active:scale-95 ${
              isLoading || isReading || !canSubmit
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-teal-600 text-white shadow-xl shadow-teal-500/30 hover:bg-teal-700 hover:shadow-teal-500/40'
            }`}
          >
            {isLoading
              ? 'Processing...'
              : isCheatSheetMode
              ? 'Generate Cheat Sheet'
              : preferences.sessionMode === 'funnel'
              ? 'Start Funnel'
              : preferences.sessionStyle === 'block'
              ? 'Start NBME Block'
              : 'Generate Practice Questions'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InputSection;
