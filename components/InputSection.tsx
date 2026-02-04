import React, { useState, useEffect } from 'react';
import { UserPreferences, QuestionType, DifficultyLevel, StudyFile, ExamFormat, CardStyle, StudyGuideItem } from '../types';
import { ClipboardDocumentCheckIcon, ExclamationTriangleIcon, AdjustmentsHorizontalIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
import { buildStudyGuideItems } from '../utils/studyGuide';
import { betaGuides, BetaGuide } from '../utils/betaGuides';

interface InputSectionProps {
  onGenerate: (
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
    subjectId?: string
  ) => void;
  isLoading: boolean;
  mode?: 'questions' | 'summary';
  onOpenOnboarding?: () => void;
}

const MAX_TEXT_CHARS = 120000;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, isLoading, onOpenOnboarding }) => {
  const [selectedGuide, setSelectedGuide] = useState<BetaGuide | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [studyGuideText, setStudyGuideText] = useState('');
  const [isTruncated, setIsTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    const saved = localStorage.getItem('mediprep_beta_prefs');
    if (saved) {
      const parsed = JSON.parse(saved);
      const safeCount = Math.min(20, Math.max(3, Number(parsed.questionCount) || 10));
      return {
        ...parsed,
        questionCount: safeCount,
        autoQuestionCount: false
      };
    }
    return {
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
  });

  useEffect(() => {
    localStorage.setItem('mediprep_beta_prefs', JSON.stringify(preferences));
  }, [preferences]);

  const handleSelectGuide = async (guide: BetaGuide) => {
    if (isReading) return;
    if (selectedGuide?.id === guide.id && studyGuideText) return;
    setSelectedGuide(guide);
    setStudyGuideText('');
    setIsTruncated(false);
    setLoadError(null);
    setIsReading(true);
    setUploadProgress(0);

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

      setStudyGuideText(fullText.trim());
    } catch (err) {
      console.error('Guide extraction failed', err);
      setLoadError('Failed to load this guide. Please try again or check the PDF path.');
      setStudyGuideText('');
    } finally {
      setIsReading(false);
      setUploadProgress(0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGuide || !studyGuideText.trim()) return;

    const { guideHash, guideItems } = await buildStudyGuideItems(studyGuideText);

    onGenerate(
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
      }
    );
  };

  return (
    <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-white h-full flex flex-col overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-teal-400 to-indigo-400" />

      <div className="p-8 pb-4">
        <div className="flex items-center gap-4 mb-2">
           <div className="p-3 rounded-2xl bg-teal-50 text-teal-600">
             <ClipboardDocumentCheckIcon className="w-8 h-8" />
           </div>
           <div>
               <h2 className="text-2xl font-black text-slate-800 tracking-tight">Choose Your Beta Module</h2>
               <p className="text-sm text-slate-500 font-medium">Select Heme or Pulm to generate NBME-style practice questions.</p>
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
            <div><span className="text-slate-800 font-black">2.</span> Adjust question count and difficulty.</div>
            <div><span className="text-slate-800 font-black">3.</span> Generate questions and begin practicing.</div>
            <div><span className="text-slate-800 font-black">4.</span> Try Deep Dive for focused concept drills.</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {betaGuides.map((guide) => {
              const isSelected = selectedGuide?.id === guide.id;
              const isLoaded = isSelected && studyGuideText.trim().length > 0;
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
                    {isSelected ? (isReading ? 'Loading guide…' : isLoaded ? 'Guide loaded' : 'Selected') : 'Select module'}
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
              {selectedGuide ? selectedGuide.title : 'None selected'}
            </div>
          </div>

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

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Focus Instructions (Optional)</label>
            <textarea
              value={preferences.customInstructions}
              onChange={(e) => setPreferences(p => ({ ...p, customInstructions: e.target.value }))}
              placeholder="e.g., Emphasize pulmonology + hematology, include next-best-step questions"
              className="w-full p-3 rounded-2xl border border-slate-200 text-xs bg-white focus:ring-2 focus:ring-teal-500/20 outline-none resize-none h-20 transition-all"
            />
          </div>
        </div>
      </div>

      <div className="p-8 pt-4 bg-white border-t border-slate-100 sticky bottom-0 z-10">
        <button
          onClick={handleSubmit}
          disabled={isLoading || !selectedGuide || !studyGuideText.trim() || isReading}
          className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all transform active:scale-95 ${isLoading || isReading || !selectedGuide || !studyGuideText.trim() ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-teal-600 text-white shadow-xl shadow-teal-500/30 hover:bg-teal-700 hover:shadow-teal-500/40'}`}
        >
          {isLoading ? 'Processing...' : 'Generate Practice Questions'}
        </button>
      </div>
    </div>
  );
};

export default InputSection;
