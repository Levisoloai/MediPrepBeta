
import React, { useState, useEffect, useRef } from 'react';
import { Subject, BlueprintTopic, StudyFile, ExamFormat } from '../types';
import { getSubjects, saveBatchQuestions, getSubjectDetails, getBlueprintSession, saveBlueprintSession, deleteBlueprintSession } from '../services/storageService';
import { analyzeBlueprintStructure, generateTopicContent } from '../services/geminiService';
import { 
  DocumentTextIcon, 
  ArrowPathIcon, 
  ChevronDownIcon, 
  ChevronUpIcon,
  SparklesIcon,
  AcademicCapIcon,
  CheckCircleIcon,
  BookmarkSquareIcon,
  ExclamationCircleIcon,
  ArrowDownTrayIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  TrashIcon
} from '@heroicons/react/24/solid';
import { DocumentMagnifyingGlassIcon, CloudArrowUpIcon, DocumentIcon } from '@heroicons/react/24/outline';
import QuestionCard from './QuestionCard';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

const BlueprintBreakdownView: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedBlueprintIndex, setSelectedBlueprintIndex] = useState<number>(0);
  const [uploadedFile, setUploadedFile] = useState<StudyFile | null>(null);
  const [breakdown, setBreakdown] = useState<BlueprintTopic[] | null>(null);
  
  // Loading State
  const [isLoading, setIsLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);

  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set());
  
  const [error, setError] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
  const [examMode, setExamMode] = useState<ExamFormat>(ExamFormat.IN_HOUSE);
  
  // PDF State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  
  // Ref for temporary printing
  const printContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSubjects().then(setSubjects);
  }, []);

  // Effect: Load previous session when a subject is selected
  useEffect(() => {
    if (selectedSubjectId) {
      loadSavedSession(selectedSubjectId);
    } else {
      setBreakdown(null);
    }
  }, [selectedSubjectId]);

  const loadSavedSession = async (subjectId: string) => {
    const session = await getBlueprintSession(subjectId);
    if (session && session.length > 0) {
      setBreakdown(session);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert("Please upload a PDF blueprint.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setUploadedFile({
        name: file.name,
        mimeType: file.type,
        data: base64
      });
      setSelectedSubjectId('');
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const updateBreakdown = (newBreakdown: BlueprintTopic[]) => {
    setBreakdown(newBreakdown);
    // Auto-save if working on a subject
    if (selectedSubjectId) {
      saveBlueprintSession(selectedSubjectId, newBreakdown);
    }
  };

  const retryTopic = async (index: number) => {
    if (!breakdown) return;
    const items = [...breakdown];
    const item = items[index];
    
    // Refresh lectures if possible
    let lectures: StudyFile[] = [];
    if (selectedSubjectId) {
        const fullSubject = await getSubjectDetails(selectedSubjectId);
        lectures = fullSubject?.lectureFiles || [];
    }

    item.status = 'generating';
    updateBreakdown([...items]); // Trigger UI update

    try {
        const content = await generateTopicContent(item.topic, item.itemCount, lectures, examMode);
        item.explanation = content.explanation;
        item.questions = content.questions;
        item.status = 'completed';
    } catch (e) {
        console.error(e);
        item.status = 'error';
    }
    updateBreakdown([...items]);
  };

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setBreakdown(null);
    setExpandedTopics(new Set());
    setProgressMsg('Initializing...');
    setProgressPercent(5);

    let blueprint: StudyFile | null = null;
    let lectures: StudyFile[] = [];

    try {
      if (uploadedFile) {
        blueprint = uploadedFile;
      } else if (selectedSubjectId) {
        setProgressMsg('Fetching subject files from cloud...');
        const fullSubject = await getSubjectDetails(selectedSubjectId);
        
        if (fullSubject && fullSubject.studyGuideFiles && fullSubject.studyGuideFiles.length > 0) {
          blueprint = fullSubject.studyGuideFiles[selectedBlueprintIndex] || fullSubject.studyGuideFiles[0];
          lectures = fullSubject.lectureFiles;
        } else {
           throw new Error("Failed to load subject files or no blueprint found.");
        }
      }

      if (!blueprint || !blueprint.data) {
        throw new Error("Blueprint file content is empty or missing. Please re-upload.");
      }

      setProgressMsg('Step 1: Analyzing Blueprint Structure...');
      setProgressPercent(10);

      // Step 1: Agent 1 - Structural Analysis
      const skeleton = await analyzeBlueprintStructure(blueprint);
      
      updateBreakdown(skeleton);
      setProgressPercent(20);

      // Step 2: Agent 2 - Content Generation Loop
      const filledBreakdown = [...skeleton];
      
      for (let i = 0; i < filledBreakdown.length; i++) {
        const item = filledBreakdown[i];
        
        setProgressMsg(`Step 2: Processing Topic ${i + 1}/${filledBreakdown.length}: ${item.topic}`);
        const currentPercent = 20 + Math.floor(((i) / filledBreakdown.length) * 80);
        setProgressPercent(currentPercent);
        
        item.status = 'generating';
        setBreakdown([...filledBreakdown]); 

        try {
          const content = await generateTopicContent(item.topic, item.itemCount, lectures, examMode);
          item.explanation = content.explanation;
          item.questions = content.questions;
          item.status = 'completed';
        } catch (e) {
          console.error(`Failed topic ${item.topic}`, e);
          item.status = 'error';
        }
        
        updateBreakdown([...filledBreakdown]);
      }

      setProgressMsg('Finalizing...');
      setProgressPercent(100);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to analyze blueprint.");
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  const handleReset = async () => {
    if (window.confirm("Clear this breakdown session? This will remove saved progress.")) {
      setBreakdown(null);
      if (selectedSubjectId) {
        await deleteBlueprintSession(selectedSubjectId);
      }
    }
  };

  const toggleTopic = (index: number) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const expandAll = () => {
    if (!breakdown) return;
    setExpandedTopics(new Set(breakdown.map((_, i) => i)));
  };

  const collapseAll = () => {
    setExpandedTopics(new Set());
  };

  const saveToBank = async (topicIndex: number) => {
    if (!breakdown) return;
    const topic = breakdown[topicIndex];
    if (topic.questions) {
      try {
        await saveBatchQuestions(topic.questions, selectedSubjectId || undefined);
        setSavedStatus(prev => ({ ...prev, [topicIndex]: true }));
        setTimeout(() => {
          setSavedStatus(prev => ({ ...prev, [topicIndex]: false }));
        }, 2000);
      } catch (e) {
        alert("Failed to save questions.");
      }
    }
  };

  // --- PDF Export Logic ---
  const handleExportPDF = async () => {
    if (!breakdown || !printContainerRef.current) return;
    setIsExporting(true);
    setExportProgress('Starting...');
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 10;
      const contentWidth = pageWidth - (margin * 2);
      let cursorY = margin;
      
      const addElementToPdf = async (element: HTMLElement) => {
        // Use a fixed smaller window width to prevent rendering huge/wide canvases
        const canvas = await html2canvas(element, {
          scale: 1.5, // Slightly reduced scale for performance on large docs
          useCORS: true,
          backgroundColor: '#ffffff',
          windowWidth: 800,
          logging: false
        });
        
        if (canvas.height === 0 || canvas.width === 0) return;

        const imgData = canvas.toDataURL('image/png');
        const imgHeight = (canvas.height * contentWidth) / canvas.width;
        
        // --- Single Page Fit Check ---
        // If it fits on the current page, just add it
        if (cursorY + imgHeight <= pageHeight - margin) {
          pdf.addImage(imgData, 'PNG', margin, cursorY, contentWidth, imgHeight);
          cursorY += imgHeight + 2; 
          return;
        }

        // --- Multi-Page Split Logic ---
        // If element is HUGE (taller than a page), or just doesn't fit remaining space
        let heightLeft = imgHeight;
        let position = 0; // Position relative to the *top of the element* image

        // 1. Fill remainder of current page first (if there's decent space)
        const spaceOnCurrentPage = pageHeight - margin - cursorY;
        
        if (spaceOnCurrentPage > 20) { // Only fill if >20mm space
           // We use a negative offset to "crop" the top of the image
           // Note: jsPDF clips content outside the page. 
           // To print the TOP chunk of the image at cursorY:
           pdf.addImage(imgData, 'PNG', margin, cursorY, contentWidth, imgHeight); 
           
           // We've "used" the top chunk. 
           // The next page needs to start printing from (spaceOnCurrentPage) down the image.
           heightLeft -= spaceOnCurrentPage;
           position -= spaceOnCurrentPage; // Shift future renders UP by this amount
           
           pdf.addPage();
           cursorY = margin;
        } else {
           // Not enough space, start fresh page
           pdf.addPage();
           cursorY = margin;
        }

        // 2. Loop to add full pages until done
        while (heightLeft > 0) {
           // We place the image at (margin, cursorY + position)
           // Since position is negative, it shifts the image UP, effectively revealing the lower parts
           // We must be on a new page here (cursorY = margin)
           pdf.addImage(imgData, 'PNG', margin, cursorY + position, contentWidth, imgHeight);
           
           const printedHeight = Math.min(heightLeft, pageHeight - (margin * 2));
           heightLeft -= printedHeight;
           position -= printedHeight;
           
           if (heightLeft > 0) {
              pdf.addPage();
              cursorY = margin;
           } else {
              cursorY += printedHeight + 2;
           }
        }
      };

      const activeTopics = breakdown.filter(item => item.status === 'completed');

      // 1. Loop through topics
      for (let i = 0; i < activeTopics.length; i++) {
        setExportProgress(`Processing Topic ${i + 1}/${activeTopics.length}...`);
        
        // Topic Title
        const titleEl = printContainerRef.current.querySelector(`.pdf-topic-title-${i}`) as HTMLElement;
        if (titleEl) await addElementToPdf(titleEl);

        // Explanation (This handles long explanations now)
        const explEl = printContainerRef.current.querySelector(`.pdf-topic-explanation-${i}`) as HTMLElement;
        if (explEl) await addElementToPdf(explEl);

        // Questions
        const questionEls = printContainerRef.current.querySelectorAll(`.pdf-topic-question-${i}`);
        for (let q = 0; q < questionEls.length; q++) {
           await addElementToPdf(questionEls[q] as HTMLElement);
        }

        // Add some spacing between topics
        cursorY += 5;
        // If we are near bottom, force new page for next topic title
        if (cursorY > pageHeight - 40) {
            pdf.addPage();
            cursorY = margin;
        }
      }

      // 2. Answer Key Header
      setExportProgress('Generating Answer Key...');
      pdf.addPage();
      cursorY = margin;
      const keyHeader = printContainerRef.current.querySelector('.pdf-key-header') as HTMLElement;
      if (keyHeader) await addElementToPdf(keyHeader);

      // 3. Answer Key Items
      for (let i = 0; i < activeTopics.length; i++) {
         const keyTopicTitle = printContainerRef.current.querySelector(`.pdf-key-topic-title-${i}`) as HTMLElement;
         if (keyTopicTitle) await addElementToPdf(keyTopicTitle);

         const keyQuestions = printContainerRef.current.querySelectorAll(`.pdf-key-question-${i}`);
         for (let q = 0; q < keyQuestions.length; q++) {
            await addElementToPdf(keyQuestions[q] as HTMLElement);
         }
         cursorY += 2;
      }

      setExportProgress('Saving File...');
      pdf.save('MediPrep_Blueprint_Report.pdf');
    } catch (err) {
      console.error("PDF Export Error", err);
      alert("Failed to export PDF. The content might be too large for the browser's memory.");
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  };

  const renderInline = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts.map((part, i) => {
      if (part.startsWith('$$')) {
        const math = part.slice(2, -2);
        try {
          const html = katex.renderToString(math, {
            displayMode: true,
            throwOnError: false,
            trust: false,
            maxExpand: 1000
          });
          const safeHtml = DOMPurify.sanitize(html);
          return <div key={i} dangerouslySetInnerHTML={{ __html: safeHtml }} className="my-2" />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else if (part.startsWith('$')) {
        const math = part.slice(1, -1);
        try {
          const html = katex.renderToString(math, {
            displayMode: false,
            throwOnError: false,
            trust: false,
            maxExpand: 1000
          });
          const safeHtml = DOMPurify.sanitize(html);
          return <span key={i} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else {
        const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
        return (
          <span key={i}>
            {boldParts.map((sub, j) => {
              if (sub.startsWith('**') && sub.endsWith('**') && sub.length >= 4) {
                return <strong key={j} className="font-bold text-indigo-900">{sub.slice(2, -2)}</strong>;
              }
              return <span key={j}>{sub.replace(/[#\*]/g, '')}</span>;
            })}
          </span>
        );
      }
    });
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    const cleanText = text.replace(/<br\s*\/?>/gi, '\n');
    const lines = cleanText.split('\n');
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
            <div key={index} className="mb-2 text-slate-700 leading-relaxed">
              {renderInline(line)}
            </div>
          );
        } else {
          elements.push(<div key={index} className="h-2" />);
        }
      }
    });
    flushTable(lines.length);
    return elements;
  };

  const selectedSubject = subjects.find(s => s.id === selectedSubjectId);

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full p-4 animate-in fade-in duration-500 overflow-y-auto custom-scrollbar">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center p-3 bg-indigo-100 text-indigo-700 rounded-2xl mb-4">
          <DocumentMagnifyingGlassIcon className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-black text-slate-800 mb-2">Blueprint Breakdown</h1>
        <p className="text-slate-500 max-w-lg mx-auto">
          Convert your exam syllabus into a structured teaching session with predicted logic and items.
        </p>
      </div>

      {!breakdown && !isLoading && (
        <div className="max-w-2xl mx-auto w-full space-y-6">
          <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl space-y-8">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Choose Input Method</label>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Subject Selector */}
                <div className="space-y-4">
                  <div>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter block mb-2">Existing Subjects</span>
                    <select 
                      value={selectedSubjectId}
                      onChange={e => {
                        setSelectedSubjectId(e.target.value);
                        setSelectedBlueprintIndex(0);
                        setUploadedFile(null);
                      }}
                      className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                    >
                      <option value="">Select a subject...</option>
                      {subjects.filter(s => s.studyGuideFiles && s.studyGuideFiles.length > 0).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Secondary Blueprint Selector */}
                  {selectedSubject && selectedSubject.studyGuideFiles && selectedSubject.studyGuideFiles.length > 1 && (
                    <div className="animate-in fade-in slide-in-from-top-2">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter block mb-2">Select Blueprint File</span>
                      <div className="space-y-2">
                        {selectedSubject.studyGuideFiles.map((file, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedBlueprintIndex(idx)}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${selectedBlueprintIndex === idx ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200' : 'bg-white border-slate-100 hover:border-indigo-100'}`}
                          >
                            <DocumentIcon className={`w-5 h-5 ${selectedBlueprintIndex === idx ? 'text-indigo-600' : 'text-slate-300'}`} />
                            <span className={`text-xs font-bold truncate ${selectedBlueprintIndex === idx ? 'text-indigo-900' : 'text-slate-500'}`}>{file.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400">Only subjects with blueprints appear here.</p>
                </div>

                {/* Upload Trigger */}
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter block mb-2">New Blueprint</span>
                  <label className={`flex items-center justify-center gap-3 p-4 rounded-2xl border-2 border-dashed cursor-pointer transition-all h-[80px] ${uploadedFile ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-indigo-400 hover:bg-white'}`}>
                    <CloudArrowUpIcon className="w-5 h-5" />
                    <span className="text-sm font-bold truncate">
                      {uploadedFile ? uploadedFile.name : 'Upload PDF'}
                    </span>
                    <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} />
                  </label>
                </div>
              </div>
            </div>

            {/* Exam Mode Toggle */}
            <div>
              <span className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Exam Mode Context</span>
              <div className="p-1 bg-slate-100 rounded-xl flex font-bold text-xs">
                <button
                  onClick={() => setExamMode(ExamFormat.IN_HOUSE)}
                  className={`flex-1 py-3 rounded-lg transition-all flex items-center justify-center gap-2 ${examMode === ExamFormat.IN_HOUSE ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  🏫 In-House (Lecture Focused)
                </button>
                <button
                  onClick={() => setExamMode(ExamFormat.NBME)}
                  className={`flex-1 py-3 rounded-lg transition-all flex items-center justify-center gap-2 ${examMode === ExamFormat.NBME ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  📋 NBME (Board Standard)
                </button>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-2xl flex items-center gap-3 border border-red-100">
                <ExclamationCircleIcon className="w-5 h-5 shrink-0" />
                <p className="text-xs font-medium">{error}</p>
              </div>
            )}

            <button 
              onClick={handleGenerate}
              disabled={(!selectedSubjectId && !uploadedFile)}
              className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-indigo-500/20 hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-3"
            >
              Analyze Blueprint <SparklesIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Progress View */}
      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center">
           <div className="w-full max-w-md bg-slate-200 rounded-full h-4 mb-6 overflow-hidden">
              <div className="bg-indigo-600 h-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }}></div>
           </div>
           <h3 className="text-xl font-bold text-indigo-900 animate-pulse uppercase tracking-widest text-center">{progressMsg}</h3>
           <p className="text-slate-500 mt-2 font-medium">Please wait while our sub-agents compile your study guide...</p>
        </div>
      )}

      {breakdown && !isLoading && (
        <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700 pb-20">
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
             <div>
                <h2 className="text-2xl font-black text-slate-800">Concept Map</h2>
                <p className="text-slate-500 text-sm">{breakdown.length} high-yield topics identified.</p>
             </div>
             
             <div className="flex gap-2">
               <button 
                 onClick={expandedTopics.size === breakdown.length ? collapseAll : expandAll}
                 className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 flex items-center gap-2 bg-white border border-slate-200 rounded-lg shadow-sm transition-all"
               >
                 {expandedTopics.size === breakdown.length ? (
                   <><ArrowsPointingInIcon className="w-4 h-4" /> Collapse</>
                 ) : (
                   <><ArrowsPointingOutIcon className="w-4 h-4" /> Expand</>
                 )}
               </button>
               <button 
                 onClick={handleExportPDF}
                 disabled={isExporting}
                 className="px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 flex items-center gap-2 rounded-lg shadow-sm transition-all disabled:opacity-50 min-w-[130px] justify-center"
               >
                 {isExporting ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <ArrowDownTrayIcon className="w-4 h-4" />}
                 {isExporting ? exportProgress || 'Exporting...' : 'Export PDF'}
               </button>
               <button onClick={handleReset} className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-red-500 flex items-center gap-2">
                 <TrashIcon className="w-4 h-4" /> Reset
               </button>
             </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {breakdown.map((item, idx) => {
              const isExpanded = expandedTopics.has(idx);
              const hasContent = item.status === 'completed';
              
              return (
                <div key={idx} className={`bg-white rounded-3xl border ${item.status === 'generating' ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-100'} shadow-sm overflow-hidden transition-all hover:shadow-md`}>
                   <button 
                     onClick={() => hasContent && toggleTopic(idx)}
                     className="w-full flex items-center justify-between p-6 text-left group"
                     disabled={!hasContent && item.status !== 'error'}
                   >
                     <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black transition-colors ${item.status === 'generating' ? 'bg-indigo-100 text-indigo-600 animate-pulse' : item.status === 'error' ? 'bg-red-100 text-red-600' : isExpanded ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
                           {item.status === 'error' ? '!' : idx + 1}
                        </div>
                        <div>
                           <h3 className={`font-bold text-lg ${item.status === 'error' ? 'text-red-700' : 'text-slate-800'}`}>{item.topic}</h3>
                           <div className="flex items-center gap-2 mt-0.5">
                              {item.itemCount > 0 && (
                                <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-100 font-bold uppercase tracking-widest">
                                  {item.itemCount} Blueprint Items
                                </span>
                              )}
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-widest ${item.status === 'completed' ? 'bg-green-50 text-green-700 border-green-100' : item.status === 'error' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                                {item.status === 'completed' ? '3 AI Predictions' : item.status === 'generating' ? 'Generating...' : item.status === 'error' ? 'Failed' : 'Pending'}
                              </span>
                           </div>
                        </div>
                     </div>
                     {hasContent ? (isExpanded ? <ChevronUpIcon className="w-6 h-6 text-slate-400" /> : <ChevronDownIcon className="w-6 h-6 text-slate-300" />) : <div className={`w-6 h-6 rounded-full animate-pulse ${item.status === 'generating' ? 'bg-indigo-200' : 'bg-slate-100'}`} />}
                   </button>

                   {/* Retry Button Block */}
                   {item.status === 'error' && (
                      <div className="px-6 pb-6 animate-in fade-in slide-in-from-top-2">
                        <div className="p-4 bg-red-50 rounded-xl flex items-center justify-between border border-red-100">
                            <div className="flex items-center gap-2 text-red-700">
                                <ExclamationCircleIcon className="w-5 h-5" />
                                <span className="text-xs font-bold uppercase tracking-wide">Generation failed</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); retryTopic(idx); }}
                                className="px-4 py-2 bg-white border border-red-200 text-red-700 text-xs font-black uppercase tracking-widest rounded-lg hover:bg-red-100 transition-colors shadow-sm"
                            >
                                Retry Topic
                            </button>
                        </div>
                      </div>
                   )}

                   {isExpanded && hasContent && item.explanation && (
                     <div className="p-8 pt-0 border-t border-slate-50 animate-in slide-in-from-top-4">
                        <div className="mt-8 mb-10">
                           <div className="flex items-center gap-2 mb-4">
                              <AcademicCapIcon className="w-5 h-5 text-indigo-500" />
                              <h4 className="text-xs font-black text-indigo-900 uppercase tracking-widest">Detailed Breakdown</h4>
                           </div>
                           <div className="bg-slate-50 p-8 rounded-2xl border border-slate-100">
                              {renderMarkdown(item.explanation)}
                           </div>
                        </div>

                        <div className="space-y-6">
                           <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2">
                                 <DocumentTextIcon className="w-5 h-5 text-teal-500" />
                                 <h4 className="text-xs font-black text-teal-900 uppercase tracking-widest">Predicted Exam Questions</h4>
                              </div>
                              <button 
                                onClick={() => saveToBank(idx)}
                                data-html2canvas-ignore
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${savedStatus[idx] ? 'bg-green-100 text-green-700' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                              >
                                 {savedStatus[idx] ? <><CheckCircleIcon className="w-4 h-4" /> Saved</> : <><BookmarkSquareIcon className="w-4 h-4" /> Save all to bank</>}
                              </button>
                           </div>
                           
                           <div className="grid grid-cols-1 gap-8">
                              {item.questions?.map((q, qIdx) => (
                                <QuestionCard key={q.id} question={q} index={qIdx} />
                              ))}
                           </div>
                        </div>
                     </div>
                   )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* HIDDEN PRINT CONTAINER FOR PDF GENERATION */}
      {breakdown && (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '800px' }} ref={printContainerRef}>
           {/* Loop Active Topics */}
           {breakdown.filter(item => item.status === 'completed').map((item, i) => (
             <div key={`pdf-group-${i}`} className="pdf-group">
                {/* 1. Header */}
                <div className={`pdf-element pdf-topic-title-${i} bg-white p-6 mb-2 border-b-2 border-slate-200`}>
                   <h1 className="text-2xl font-black text-slate-900">Topic {i+1}: {item.topic}</h1>
                </div>

                {/* 2. Explanation */}
                <div className={`pdf-element pdf-topic-explanation-${i} bg-white p-6 mb-4`}>
                   <h2 className="text-sm font-bold mb-2 uppercase tracking-widest text-indigo-800">Concept Breakdown</h2>
                   {renderMarkdown(item.explanation || '')}
                </div>

                {/* 3. Questions Loop */}
                {item.questions?.map((q, qIdx) => (
                   <div key={q.id} className={`pdf-element pdf-topic-question-${i} bg-white p-6 mb-4 border border-slate-200 rounded-xl`}>
                        <div className="flex items-center gap-2 mb-2">
                           <span className="bg-slate-900 text-white px-2 py-1 text-xs font-bold rounded">Q{qIdx+1}</span>
                           <span className="text-xs font-bold text-slate-400 uppercase">{q.difficulty}</span>
                        </div>
                        <p className="text-base font-medium mb-3">{q.questionText}</p>
                        <div className="space-y-1">
                           {q.options?.map((opt, oIdx) => (
                             <div key={oIdx} className="flex gap-4 p-2 border border-slate-100 rounded bg-white text-sm">
                                <span className="font-bold text-slate-400">{String.fromCharCode(65+oIdx)}</span>
                                <span>{opt}</span>
                             </div>
                           ))}
                        </div>
                   </div>
                ))}
             </div>
           ))}

           {/* Answer Key Header */}
           <div className="pdf-element pdf-key-header bg-white p-6 mt-8">
               <h1 className="text-3xl font-black text-slate-900 text-center uppercase tracking-widest border-b-4 border-slate-900 pb-4">Answer Key</h1>
           </div>

           {/* Answer Key Items */}
           {breakdown.filter(item => item.status === 'completed').map((item, i) => (
              <div key={`pdf-key-group-${i}`}>
                 <div className={`pdf-element pdf-key-topic-title-${i} bg-white p-4 mt-4 bg-slate-100`}>
                    <h2 className="text-xl font-black text-slate-800">{i+1}. {item.topic}</h2>
                 </div>
                 {item.questions?.map((q, qIdx) => (
                    <div key={q.id} className={`pdf-element pdf-key-question-${i} bg-white p-4 mb-2 border-l-4 border-green-500`}>
                       <h3 className="font-bold text-sm mb-1">Question {qIdx+1}</h3>
                       <div className="text-xs text-slate-500 mb-2">Answer: <span className="font-bold text-green-700">{q.correctAnswer}</span></div>
                       <div className="text-xs text-slate-600">
                          {renderMarkdown(q.explanation)}
                       </div>
                    </div>
                 ))}
              </div>
           ))}
        </div>
      )}
    </div>
  );
};

export default BlueprintBreakdownView;
