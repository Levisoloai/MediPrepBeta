import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StoredQuestion, QuestionType, ChatMessage, CardStyle } from '../types';
import { processReview, calculateNextIntervals } from '../services/storageService';
import { chatWithTutor } from '../services/geminiService';
import { CheckCircleIcon, ArrowLeftIcon, TrophyIcon, ChatBubbleLeftRightIcon, XMarkIcon, PaperAirplaneIcon, ArrowPathIcon, SparklesIcon, BoltIcon, LightBulbIcon } from '@heroicons/react/24/solid';
import katex from 'katex';
import TutorMessage from './TutorMessage';

interface StudySessionProps {
  dueQuestions: StoredQuestion[];
  onComplete: () => void;
  onExit: () => void;
}

const StudySession: React.FC<StudySessionProps> = ({ dueQuestions, onComplete, onExit }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionQueue, setSessionQueue] = useState<StoredQuestion[]>(dueQuestions);
  const [completedCount, setCompletedCount] = useState(0);
  
  // Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);
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

  const currentQuestion = sessionQueue[currentIndex];
  const progress = Math.round((completedCount / (completedCount + sessionQueue.length - currentIndex)) * 100);

  useEffect(() => {
    // Reset chat on new question
    setChatHistory([]);
    setChatInput('');
  }, [currentIndex]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isChatOpen]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const responseText = await chatWithTutor(
        currentQuestion,
        chatHistory,
        userMsg.text,
        tutorModel,
        undefined,
        { showAnswer }
      );
      setChatHistory(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error) {
      console.error("Chat error", error);
      setChatHistory(prev => [...prev, { role: 'model', text: "Sorry, I'm having trouble connecting." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (chatHistory.length < 2 || isChatLoading) return;
    
    // Find the last user message
    let lastUserIndex = -1;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) return;

    const lastUserMsg = chatHistory[lastUserIndex];
    // Keep history up to that message
    const historyForRegen = chatHistory.slice(0, lastUserIndex);
    
    // UI Update: Remove messages after the user message (likely the AI response)
    setChatHistory(prev => prev.slice(0, lastUserIndex + 1));
    setIsChatLoading(true);

    try {
      const responseText = await chatWithTutor(
        currentQuestion,
        historyForRegen,
        lastUserMsg.text,
        tutorModel,
        undefined,
        { showAnswer }
      );
      setChatHistory(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error) {
      setChatHistory(prev => [...prev, { role: 'model', text: "Error regenerating response." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Helper to render text with LaTeX and basic Markdown (Bold), stripping asterisks
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
        // Handle Bold (**text**)
        // Use [\s\S] to match newlines inside bold tags
        const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
        return (
          <span key={index}>
            {boldParts.map((subPart, subIdx) => {
              if (subPart.startsWith('**') && subPart.endsWith('**') && subPart.length >= 4) {
                return <strong key={subIdx} className="font-bold text-slate-900">{subPart.slice(2, -2)}</strong>;
              }
              // Handle remaining asterisks (simple strip to satisfy "no asterisks")
              return <span key={subIdx}>{subPart.replace(/\*/g, '')}</span>;
            })}
          </span>
        );
      }
    });
  };

  // Render Cloze Card
  const renderClozeCard = (text: string, reveal: boolean) => {
    // Regex for {{...}}
    const parts = text.split(/(\{\{.*?\}\})/g);
    return (
      <div className="text-xl md:text-2xl font-medium text-slate-800 leading-relaxed">
        {parts.map((part, i) => {
          if (part.startsWith('{{') && part.endsWith('}}')) {
            const content = part.slice(2, -2);
            if (reveal) {
              return <span key={i} className="px-2 py-0.5 mx-1 bg-green-100 text-green-700 font-bold rounded-md shadow-sm border border-green-200 animate-in fade-in duration-300">{content}</span>;
            } else {
              return <span key={i} className="px-3 py-0.5 mx-1 bg-slate-100 text-slate-400 font-bold rounded-md border border-slate-300 select-none tracking-widest">[ ... ]</span>;
            }
          }
          return <span key={i}>{renderMessageContent(part)}</span>;
        })}
      </div>
    );
  };

  if (!currentQuestion) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mb-6">
          <TrophyIcon className="w-10 h-10 text-yellow-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Session Complete!</h2>
        <p className="text-slate-500 mb-8">You've cleared your queue in IndexedDB.</p>
        <button
          onClick={onComplete}
          className="px-6 py-3 bg-teal-600 text-white rounded-xl font-medium hover:bg-teal-700 transition-colors"
        >
          Finish Session
        </button>
      </div>
    );
  }

  const handleRating = async (rating: 1 | 2 | 3 | 4) => {
    await processReview(currentQuestion.id, rating);
    
    if (rating === 1) {
      setSessionQueue(prev => [...prev, currentQuestion]);
    }

    if (currentIndex < sessionQueue.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      if (rating !== 1) {
          onComplete();
          return;
      }
      setCurrentIndex(prev => prev + 1);
    }
    
    setShowAnswer(false);
    if (rating !== 1) setCompletedCount(prev => prev + 1);
  };

  const isMC = currentQuestion.type === QuestionType.MULTIPLE_CHOICE || currentQuestion.type === QuestionType.TRUE_FALSE;
  const isCloze = currentQuestion.cardStyle === CardStyle.CLOZE;
  const nextIntervals = calculateNextIntervals(currentQuestion.srs);

  const renderExplanation = (text: string) => {
    // Check for UWorld style headers (Educational Objective is the most distinct one)
    const isUWorldStyle = text.includes("**Educational Objective:**");

    if (isUWorldStyle) {
        let explanation = "";
        let choiceAnalysis = "";
        let educationalObjective = "";
        let references = "";

        // Regex parsing
        const explanationMatch = text.match(/\*\*Explanation:\*\*\s*([\s\S]*?)(?=\*\*Choice Analysis:|$)/i);
        const choiceMatch = text.match(/\*\*Choice Analysis:\*\*\s*([\s\S]*?)(?=\*\*Educational Objective:|$)/i);
        const objectiveMatch = text.match(/\*\*Educational Objective:\*\*\s*([\s\S]*?)(?=\*\*References:|$)/i);
        const refMatch = text.match(/\*\*References:\*\*\s*([\s\S]*)/i);

        if (explanationMatch) explanation = explanationMatch[1].trim();
        if (choiceMatch) choiceAnalysis = choiceMatch[1].trim();
        if (objectiveMatch) educationalObjective = objectiveMatch[1].trim();
        if (refMatch) references = refMatch[1].trim();

        return (
          <div className="mt-8 pt-8 border-t border-slate-200 animate-in fade-in slide-in-from-bottom-4 space-y-8 text-slate-800">
               {/* Answer block for non-MC */}
               {!isMC && !isCloze && (
                  <div className="p-4 bg-green-50 border border-green-100 rounded-xl text-green-900 mb-6">
                    <span className="font-bold block mb-1">Answer:</span>
                    {currentQuestion.correctAnswer}
                  </div>
               )}

               {/* Explanation */}
               <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Explanation</h4>
                  <div className="text-sm md:text-base leading-relaxed space-y-4">
                     {renderMessageContent(explanation)}
                  </div>
               </div>

               {/* Choice Analysis */}
               {choiceAnalysis && (
                 <div>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Choice Analysis</h4>
                    <div className="text-sm md:text-base leading-relaxed space-y-2 pl-2 border-l-2 border-slate-100">
                       {renderMessageContent(choiceAnalysis)}
                    </div>
                 </div>
               )}

               {/* Educational Objective Box */}
               <div className="border border-blue-200 rounded-lg overflow-hidden shadow-sm mt-4">
                   <div className="bg-blue-50 px-4 py-2 border-b border-blue-100 flex items-center gap-2">
                      <div className="bg-blue-500 rounded p-0.5 text-white">
                        <LightBulbIcon className="w-3 h-3" />
                      </div>
                      <h4 className="font-bold text-blue-900 text-xs uppercase tracking-wide">Educational Objective</h4>
                   </div>
                   <div className="p-4 bg-white text-sm md:text-base leading-relaxed text-slate-800">
                      {renderMessageContent(educationalObjective)}
                   </div>
               </div>

               {/* References */}
               {references && (
                 <div className="text-xs text-slate-400 mt-2">
                    <span className="font-bold text-slate-500">References:</span>
                    <div className="mt-1">{renderMessageContent(references)}</div>
                 </div>
               )}
               
               {/* Tags */}
               {Array.isArray(currentQuestion.studyConcepts) && currentQuestion.studyConcepts.length > 0 && (
                 <div className="flex flex-wrap gap-2 pt-2">
                     {currentQuestion.studyConcepts.map(c => (
                       <span key={c} className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded border border-slate-200 font-bold uppercase">{c}</span>
                     ))}
                 </div>
               )}
          </div>
        );
    }
    
    // Fallback for old questions or different format
    const hasStructure = text.includes("**Correct Answer Rationale:**");

    if (!hasStructure) {
      return (
        <div className="mt-6 pt-6 border-t border-slate-100 animate-in fade-in slide-in-from-bottom-4">
           {/* Answer block for non-MC */}
           {!isMC && !isCloze && (
              <div className="mb-6 p-4 bg-green-50 border border-green-100 rounded-xl text-green-900">
                <span className="font-bold block mb-1">Answer:</span>
                {currentQuestion.correctAnswer}
              </div>
           )}
           <div className="prose prose-slate max-w-none">
             <h4 className="text-sm font-bold uppercase text-slate-400 tracking-wider">Rationale</h4>
             <div className="text-slate-700 leading-relaxed whitespace-pre-wrap">{renderMessageContent(text)}</div>
             {Array.isArray(currentQuestion.studyConcepts) && currentQuestion.studyConcepts.length > 0 && (
               <div className="mt-4 flex flex-wrap gap-2">
                 {currentQuestion.studyConcepts.map(c => (
                   <span key={c} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200 font-bold uppercase">{c}</span>
                 ))}
               </div>
             )}
           </div>
        </div>
      );
    }

    // Parsing old structured text
    let rationale = "";
    let distractors = "";
    let memoryHook = "";

    const rationaleMatch = text.match(/\*\*Correct Answer Rationale:\*\*\s*([\s\S]*?)(?=\*\*Distractor Analysis:\*\*|$)/i);
    const distractorMatch = text.match(/\*\*Distractor Analysis:\*\*\s*([\s\S]*?)(?=\*\*Memory Hook:\*\*|$)/i);
    const memoryHookMatch = text.match(/\*\*Memory Hook:\*\*\s*([\s\S]*)/i);
    
    if (rationaleMatch) rationale = rationaleMatch[1].trim();
    if (distractorMatch) distractors = distractorMatch[1].trim();
    if (memoryHookMatch) memoryHook = memoryHookMatch[1].trim();

    return (
      <div className="mt-6 pt-6 border-t border-slate-100 animate-in fade-in slide-in-from-bottom-4 space-y-6">
           {/* Answer block for non-MC */}
           {!isMC && !isCloze && (
              <div className="p-4 bg-green-50 border border-green-100 rounded-xl text-green-900">
                <span className="font-bold block mb-1">Answer:</span>
                {currentQuestion.correctAnswer}
              </div>
           )}
           
           {/* Rationale Section */}
           <div className="bg-white p-5 rounded-xl border-l-4 border-teal-500 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-center gap-2 mb-3">
                  <CheckCircleIcon className="w-5 h-5 text-teal-600" />
                  <h4 className="text-sm font-bold text-teal-800 uppercase tracking-wide">Educational Objective</h4>
              </div>
              <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                  {renderMessageContent(rationale)}
              </div>
           </div>

           {/* Distractors */}
           {distractors && (
             <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Distractor Analysis</h4>
                <div className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">
                    {renderMessageContent(distractors)}
                </div>
             </div>
           )}

           {/* Memory Hook */}
           {memoryHook && (
             <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 flex gap-4 items-start shadow-sm">
                  <div className="bg-white p-2 rounded-full shadow-sm text-indigo-500">
                     <LightBulbIcon className="w-5 h-5" />
                  </div>
                  <div>
                     <h4 className="text-xs font-bold text-indigo-800 uppercase tracking-wide mb-1">Flash Fact</h4>
                     <div className="text-indigo-900 text-sm italic font-medium whitespace-pre-wrap">
                         {renderMessageContent(memoryHook)}
                     </div>
                  </div>
             </div>
           )}

           {/* Concepts */}
           {Array.isArray(currentQuestion.studyConcepts) && currentQuestion.studyConcepts.length > 0 && (
             <div className="flex flex-wrap gap-2 mt-2">
                 {currentQuestion.studyConcepts.map(c => (
                   <span key={c} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200 font-bold uppercase">{c}</span>
                 ))}
             </div>
           )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Main Content Area - Shifts when chat opens */}
      <div 
        className="flex flex-col h-full transition-all duration-300 ease-out"
        style={{ 
          marginRight: isChatOpen && window.innerWidth >= 1024 ? sidebarWidth : 0 
        }}
      >
        <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
          <div className="flex items-center justify-between mb-6">
            <button onClick={onExit} className="text-slate-400 hover:text-slate-600">
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <div className="flex-1 mx-6 bg-slate-200 rounded-full h-2">
              <div 
                className="bg-teal-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-500">
                {currentIndex + 1} / {sessionQueue.length}
              </span>
              <button 
                onClick={() => setIsChatOpen(!isChatOpen)}
                className={`p-2 rounded-lg transition-colors ${isChatOpen ? 'bg-teal-100 text-teal-600' : 'bg-white text-slate-400 hover:text-teal-600 hover:bg-teal-50 border border-slate-200 shadow-sm'}`}
              >
                <ChatBubbleLeftRightIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col relative">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 flex-1 flex flex-col p-8 overflow-y-auto min-h-[400px]">
              <div className="mb-8">
                <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 mb-4 uppercase">
                   {currentQuestion.type === QuestionType.FLASHCARD && isCloze ? 'Cloze Deletion' : currentQuestion.type.replace('_', ' ')}
                </span>
                
                {isCloze ? (
                   renderClozeCard(currentQuestion.questionText, showAnswer)
                ) : (
                   <h2 className="text-xl md:text-2xl font-medium text-slate-800 leading-relaxed whitespace-pre-wrap">
                     {renderMessageContent(currentQuestion.questionText)}
                   </h2>
                )}
              </div>

              {isMC && Array.isArray(currentQuestion.options) && currentQuestion.options.length > 0 && (
                <div className="space-y-3 mb-8">
                  {currentQuestion.options.map((opt, i) => (
                    <div key={i} className={`p-4 rounded-xl border ${showAnswer && opt === currentQuestion.correctAnswer ? 'bg-green-50 border-green-200 text-green-900 font-medium' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                        <span className="mr-3 opacity-50">{String.fromCharCode(65 + i)}.</span>
                        {renderMessageContent(opt)}
                        {showAnswer && opt === currentQuestion.correctAnswer && (
                          <CheckCircleIcon className="w-5 h-5 text-green-600 inline-block ml-2 align-text-bottom" />
                        )}
                    </div>
                  ))}
                </div>
              )}

              {showAnswer && renderExplanation(currentQuestion.explanation)}
            </div>
          </div>

          <div className="mt-6 h-20">
            {!showAnswer ? (
              <button 
                onClick={() => setShowAnswer(true)}
                className="w-full h-full bg-teal-600 text-white text-lg font-semibold rounded-2xl shadow-lg hover:bg-teal-700 transition-all"
              >
                Reveal Answer
              </button>
            ) : (
              <div className="grid grid-cols-4 gap-3 h-full">
                <button onClick={() => handleRating(1)} className="flex flex-col items-center justify-center bg-rose-100 text-rose-700 rounded-xl border border-rose-200 hover:bg-rose-200 transition-colors">
                  <span className="font-bold text-sm">Again</span>
                  <span className="text-[10px] font-medium opacity-70">{nextIntervals[0]}</span>
                </button>
                <button onClick={() => handleRating(2)} className="flex flex-col items-center justify-center bg-orange-100 text-orange-700 rounded-xl border border-orange-200 hover:bg-orange-200 transition-colors">
                  <span className="font-bold text-sm">Hard</span>
                  <span className="text-[10px] font-medium opacity-70">{nextIntervals[1]}</span>
                </button>
                <button onClick={() => handleRating(3)} className="flex flex-col items-center justify-center bg-blue-100 text-blue-700 rounded-xl border border-blue-200 hover:bg-blue-200 transition-colors">
                  <span className="font-bold text-sm">Good</span>
                  <span className="text-[10px] font-medium opacity-70">{nextIntervals[2]}</span>
                </button>
                <button onClick={() => handleRating(4)} className="flex flex-col items-center justify-center bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-200 hover:bg-emerald-200 transition-colors">
                  <span className="font-bold text-sm">Easy</span>
                  <span className="text-[10px] font-medium opacity-70">{nextIntervals[3]}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resizable Chat Drawer */}
      <div 
        ref={sidebarRef}
        className={`fixed inset-y-0 right-0 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-50 flex flex-col ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: sidebarWidth }}
      >
        {/* Resize Handle */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-teal-500/20 active:bg-teal-500 transition-colors z-50"
          onMouseDown={startResizing}
        />

        {/* Chat Header */}
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2 text-teal-700 font-bold text-sm">
                <ChatBubbleLeftRightIcon className="w-5 h-5" />
                AI Tutor
             </div>
             <button onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <XMarkIcon className="w-6 h-6" />
             </button>
          </div>
          
          {/* Model Toggle */}
          <div className="bg-slate-200 p-1 rounded-lg flex text-[10px] font-bold">
            <button 
              onClick={() => setTutorModel('flash')}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded transition-all ${tutorModel === 'flash' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <BoltIcon className="w-3 h-3" /> Fast (Flash)
            </button>
            <button 
              onClick={() => setTutorModel('pro')}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded transition-all ${tutorModel === 'pro' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <SparklesIcon className="w-3 h-3" /> Deep (Pro)
            </button>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 text-sm">
          {chatHistory.length === 0 && (
             <div className="text-center text-slate-400 text-xs mt-10 px-4">
               <p className="mb-2 font-semibold">Ask about this question!</p>
               <p>"Why is B incorrect?"</p>
               <p>"Explain the mechanism."</p>
             </div>
          )}
          
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[90%] rounded-2xl px-4 py-3 shadow-sm text-sm leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-teal-600 text-white' 
                  : 'bg-white text-slate-700 border border-slate-200'
              } whitespace-pre-wrap ${msg.role === 'model' ? 'tabular-nums' : ''}`}>
                {msg.role === 'model' ? (
                  <TutorMessage text={msg.text} renderInline={renderMessageContent} />
                ) : (
                  renderMessageContent(msg.text)
                )}
              </div>
              
              {/* Regenerate Button for last AI message */}
              {msg.role === 'model' && idx === chatHistory.length - 1 && !isChatLoading && (
                <button 
                  onClick={handleRegenerate}
                  className="mt-1 flex items-center gap-1 text-[10px] text-slate-400 hover:text-teal-600 font-medium transition-colors"
                >
                  <ArrowPathIcon className="w-3 h-3" /> Regenerate
                </button>
              )}
            </div>
          ))}
          
          {isChatLoading && (
            <div className="flex justify-start">
               <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm flex items-center gap-2">
                 <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                 <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                 <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
               </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat Input */}
        <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-slate-100 flex gap-3 shrink-0">
          <input 
            type="text" 
            value={chatInput} 
            onChange={(e) => setChatInput(e.target.value)} 
            placeholder={tutorModel === 'pro' ? "Ask a complex question..." : "Ask a quick question..."}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 outline-none text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 ease-in-out bg-slate-50 focus:bg-white focus:scale-[1.02] focus:shadow-md origin-bottom" 
            disabled={isChatLoading} 
          />
          <button 
            type="submit" 
            disabled={!chatInput.trim() || isChatLoading} 
            className="bg-teal-600 text-white p-3 rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-teal-500/20"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default StudySession;
