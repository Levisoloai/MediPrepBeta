
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from './components/Navigation';
import InputSection from './components/InputSection';
import QuestionCard from './components/QuestionCard';
import EmptyState from './components/EmptyState';
import Library from './components/Library';
import StudySession from './components/StudySession';
import Dashboard from './components/Dashboard';
import SubjectManager from './components/SubjectManager';
import SummaryView from './components/SummaryView';
import ClerkshipView from './components/ClerkshipView';
import DeepDiveView from './components/DeepDiveView';
import MentalMapView from './components/MentalMapView';
import QuestionSolverView from './components/QuestionSolverView';
import BlueprintBreakdownView from './components/BlueprintBreakdownView';
import VirtualWardView from './components/VirtualWardView';
import { generateQuestions, generateConceptFlashcards, generateCheatSheet, chatWithTutor } from './services/geminiService';
import { Question, UserPreferences, StudyFile, StoredQuestion, QuestionType, ChatMessage } from './types';
import { SparklesIcon, XMarkIcon, ChatBubbleLeftRightIcon, PaperAirplaneIcon, BoltIcon } from '@heroicons/react/24/solid';
import katex from 'katex';
import { getDueQuestions, getStoredQuestions, saveBatchQuestions, getWeakestConcepts } from './services/storageService';

type ViewMode = 'generate' | 'practice' | 'library' | 'study' | 'performance' | 'subjects' | 'summary' | 'clerkship' | 'deepdive' | 'cheatsheets' | 'mentalmap' | 'solver' | 'breakdown' | 'virtualward';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('generate');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [summaryContent, setSummaryContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryQuestions, setLibraryQuestions] = useState<StoredQuestion[]>([]);
  const [dueQuestions, setDueQuestions] = useState<StoredQuestion[]>([]);

  // Chat State for Practice Mode
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeQuestionForChat, setActiveQuestionForChat] = useState<Question | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [tutorModel, setTutorModel] = useState<'flash' | 'pro'>('flash');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Chat Resizing State
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);
  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = document.body.clientWidth - mouseMoveEvent.clientX;
        if (newWidth > 320 && newWidth < 800) {
          setSidebarWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  const refreshStorage = async () => {
    const stored = await getStoredQuestions();
    const due = await getDueQuestions();
    setLibraryQuestions(stored);
    setDueQuestions(due);
  };

  useEffect(() => {
    refreshStorage();
  }, [view]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (isChatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isChatOpen]);

  const handleGenerate = async (
    content: string,
    lectureFiles: StudyFile[],
    studyGuideFile: StudyFile | null,
    prefs: UserPreferences,
    _context?: { guideHash: string; guideItems: any[]; guideTitle: string },
    subjectId?: string
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      if (prefs.generationMode === 'summary') {
        const summary = await generateCheatSheet(lectureFiles, studyGuideFile, prefs);
        setSummaryContent(summary);
        setView('summary');
        return;
      }

      const weakConcepts = await getWeakestConcepts(3);
      const generatedQuestions = await generateQuestions(content, lectureFiles, studyGuideFile, prefs);
      setQuestions(generatedQuestions);
      
      if (prefs.questionType === QuestionType.FLASHCARD) {
        await saveBatchQuestions(generatedQuestions, subjectId);
        await refreshStorage();
        setView('study');
      } else {
        setView('practice');
        if (subjectId) {
          await saveBatchQuestions(generatedQuestions, subjectId);
        }
      }

      if (weakConcepts.length > 0) {
        setIsGeneratingFlashcards(true);
        try {
          const autoCards = await generateConceptFlashcards(weakConcepts, lectureFiles);
          if (autoCards.length > 0) {
            await saveBatchQuestions(autoCards, subjectId);
            await refreshStorage();
          }
        } catch (fcError) {
          console.error("Failed to auto-generate gap-filling flashcards", fcError);
        } finally {
          setIsGeneratingFlashcards(false);
        }
      }

    } catch (err: any) {
      setError(err.message || "Failed to generate content.");
    } finally {
      setIsLoading(false);
    }
  };

  const openChatForQuestion = (q: Question) => {
    setActiveQuestionForChat(q);
    setChatHistory([]);
    setChatInput('');
    setIsChatOpen(true);
  };

  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading || !activeQuestionForChat) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const responseText = await chatWithTutor(activeQuestionForChat, chatHistory, userMsg.text, tutorModel);
      setChatHistory(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error) {
      setChatHistory(prev => [...prev, { role: 'model', text: "Sorry, connection error." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const renderMessageContent = (text: string) => {
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
        const boldParts = part.split(/(\*\*.*?\*\*)/g);
        return (
          <span key={index}>
            {boldParts.map((subPart, subIdx) => {
              if (subPart.startsWith('**') && subPart.endsWith('**')) {
                return <strong key={subIdx}>{subPart.slice(2, -2)}</strong>;
              }
              return <span key={subIdx}>{subPart}</span>;
            })}
          </span>
        );
      }
    });
  };

  const isImmersiveView = ['virtualward', 'practice', 'study', 'breakdown', 'clerkship', 'deepdive', 'mentalmap', 'solver'].includes(view);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row overflow-hidden relative selection:bg-teal-100">
      
      {/* Background Decor */}
      <div className="fixed top-0 left-0 w-full h-96 bg-gradient-to-b from-teal-50/50 to-transparent pointer-events-none z-0" />

      {/* SIDEBAR NAVIGATION */}
      <Navigation 
        currentView={view} 
        setView={(v) => { setView(v as ViewMode); setIsChatOpen(false); }} 
        activeQuestionCount={questions.length}
        dueCount={dueQuestions.length}
      />

      <main 
        className={`flex-1 md:ml-24 flex flex-col relative z-10 h-screen transition-all duration-300 ${
          isImmersiveView ? 'p-0' : 'max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6'
        }`}
      >
        
        {/* Mobile Header */}
        {!isImmersiveView && (
          <div className="md:hidden flex items-center justify-center py-4 mb-4 border-b border-slate-200/60 sticky top-0 bg-slate-50/80 backdrop-blur-md z-20">
              <h1 className="text-sm font-black tracking-tighter bg-gradient-to-r from-teal-700 to-teal-500 bg-clip-text text-transparent">
                MEDIPREP AI
              </h1>
          </div>
        )}

        <div className={`flex-1 flex flex-col ${!isImmersiveView ? 'overflow-y-auto no-scrollbar pb-24 md:pb-8' : 'h-full overflow-hidden'}`}>
          {(view === 'generate' || view === 'cheatsheets') && (
            <div className="h-full flex flex-col items-center justify-center max-w-4xl mx-auto w-full animate-in fade-in zoom-in-95 duration-300">
              <div className="w-full h-full">
                 <InputSection 
                   onGenerate={handleGenerate} 
                   isLoading={isLoading} 
                   mode={view === 'cheatsheets' ? 'summary' : 'questions'}
                 />
              </div>
            </div>
          )}

          {view === 'summary' && (
            <SummaryView content={summaryContent} onBack={() => setView('generate')} />
          )}
          
          {view === 'clerkship' && <ClerkshipView />}
          {view === 'deepdive' && <DeepDiveView />}
          {view === 'mentalmap' && <MentalMapView />}
          {view === 'solver' && <QuestionSolverView />}
          {view === 'breakdown' && <BlueprintBreakdownView />}
          {view === 'virtualward' && <VirtualWardView />}

          {view === 'practice' && (
            <div 
              className="h-full flex flex-col transition-all duration-300 ease-out p-6 md:p-10"
              style={{ 
                marginRight: isChatOpen && window.innerWidth >= 1024 ? sidebarWidth : 0 
              }}
            >
               <div className="mb-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Practice Session</h2>
                    <p className="text-slate-500 text-sm font-medium">Predicted items based on your upload.</p>
                  </div>
               </div>
               
               {questions.length > 0 ? (
                 <div className="flex-1 overflow-y-auto space-y-8 pb-32 pr-2 custom-scrollbar">
                   {questions.map((q, idx) => (
                     <QuestionCard 
                       key={q.id} 
                       question={q} 
                       index={idx} 
                       onChat={openChatForQuestion} 
                     />
                   ))}
                 </div>
               ) : (
                 <EmptyState onViewChange={(newView) => setView(newView as ViewMode)} />
               )}
            </div>
          )}

          {view === 'performance' && <Dashboard />}
          {view === 'subjects' && <SubjectManager onSelect={(id) => setView('generate')} />}
          {view === 'library' && <Library questions={libraryQuestions} onRefresh={refreshStorage} />}
          {view === 'study' && (
            <div className="h-full">
              {dueQuestions.length > 0 ? (
                <StudySession dueQuestions={dueQuestions} onComplete={refreshStorage} onExit={() => setView('generate')} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 animate-in fade-in">
                   <div className="w-24 h-24 bg-teal-50 rounded-full flex items-center justify-center mb-6 shadow-inner">
                      <SparklesIcon className="w-12 h-12 text-teal-300" />
                   </div>
                   <h2 className="text-2xl font-black text-slate-800 mb-2">All Caught Up!</h2>
                   <p className="text-slate-500 text-sm mb-8 max-w-xs mx-auto">Your spaced repetition queue is empty. Great work!</p>
                   <button onClick={() => setView('generate')} className="bg-teal-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-teal-500/30 hover:shadow-teal-500/40 hover:-translate-y-0.5 transition-all">
                      Predict New Items
                   </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* LOADING & ERROR OVERLAYS */}
        {isLoading && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center animate-in fade-in">
             <div className="w-20 h-20 relative">
               <div className="absolute inset-0 border-4 border-slate-200 rounded-full"></div>
               <div className="absolute inset-0 border-4 border-teal-500 rounded-full border-t-transparent animate-spin"></div>
             </div>
             <h3 className="text-xl font-bold text-slate-800 mt-6 animate-pulse uppercase tracking-widest">Analysing...</h3>
          </div>
        )}
        {error && (
           <div className="fixed top-10 right-1/2 translate-x-1/2 md:translate-x-0 md:right-10 max-w-sm bg-white border border-red-100 p-4 rounded-2xl shadow-xl shadow-red-500/10 z-[101] flex items-start gap-3 animate-in slide-in-from-right-8">
             <div className="bg-red-50 p-2 rounded-full text-red-500 shrink-0">
                <XMarkIcon className="w-5 h-5" />
             </div>
             <div>
               <p className="text-red-700 text-sm font-bold">Error</p>
               <p className="text-slate-500 text-xs mt-1">{error}</p>
               <button onClick={() => setError(null)} className="text-xs text-red-500 mt-2 font-bold hover:underline">Dismiss</button>
             </div>
           </div>
        )}

        {/* CHAT DRAWER */}
        <div 
          ref={sidebarRef}
          className={`fixed inset-y-0 right-0 bg-white/95 backdrop-blur-xl shadow-2xl transform transition-transform duration-300 ease-out z-[102] flex flex-col border-l border-slate-200 ${isChatOpen && (view === 'practice' || view === 'study') ? 'translate-x-0' : 'translate-x-full'}`}
          style={{ width: sidebarWidth }}
        >
          <div 
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-teal-500/50 transition-colors z-50"
            onMouseDown={startResizing}
          />
          <div className="p-5 border-b border-slate-100 bg-white/50">
            <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-teal-100 text-teal-600 rounded-lg">
                    <ChatBubbleLeftRightIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">AI Tutor</h3>
                  </div>
               </div>
               <button onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <XMarkIcon className="w-5 h-5" />
               </button>
            </div>
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button onClick={() => setTutorModel('flash')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tutorModel === 'flash' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>Fast</button>
              <button onClick={() => setTutorModel('pro')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tutorModel === 'pro' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>Reasoning</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[90%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user' ? 'bg-teal-600 text-white rounded-br-sm' : 'bg-white text-slate-700 border border-slate-100 rounded-bl-sm'
                }`}>
                  {renderMessageContent(msg.text)}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                 <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-sm flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" />
                   <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                   <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
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
              className="flex-1 px-4 py-3.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-teal-500 transition-all bg-slate-50" 
            />
            <button 
              type="submit" 
              className="bg-teal-600 text-white p-3.5 rounded-xl hover:bg-teal-700 active:scale-90 transition-transform"
            >
              <PaperAirplaneIcon className="w-5 h-5" />
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default App;
