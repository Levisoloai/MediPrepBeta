
import React, { useState, useEffect, useRef } from 'react';
import { Subject, ChatMessage } from '../types';
import { getSubjects, deleteSubject, updateSubjectChatHistory, getSubjectDetails } from '../services/storageService';
import { chatWithSubject } from '../services/geminiService';
import { FolderIcon, TrashIcon, PresentationChartBarIcon, ClipboardDocumentCheckIcon, PlusIcon, InboxIcon, ChatBubbleLeftRightIcon, ArrowLeftIcon, BoltIcon, SparklesIcon, PaperAirplaneIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import katex from 'katex';
import DOMPurify from 'dompurify';

interface SubjectManagerProps {
  onSelect: (id: string) => void;
}

const SubjectManager: React.FC<SubjectManagerProps> = ({ onSelect }) => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const isMountedRef = useRef(true);
  
  // Chat State
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [tutorModel, setTutorModel] = useState<'flash' | 'pro'>('flash');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchSubjects = async () => {
    const data = await getSubjects();
    if (isMountedRef.current) {
      setSubjects(data);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchSubjects();
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (activeSubject) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, activeSubject]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this subject and all saved materials?')) {
      await deleteSubject(id);
      if (activeSubject?.id === id) setActiveSubject(null);
      await fetchSubjects();
    }
  };

  const handleStartChat = async (e: React.MouseEvent, subject: Subject) => {
    e.stopPropagation();
    
    // Set view immediately with metadata
    setActiveSubject(subject);
    setChatHistory(subject.chatHistory || []);
    setChatInput('');
    
    // Start loading state to block input while we fetch file content
    setIsChatLoading(true);

    try {
      // Fetch full details (including base64 file content) from storage/cloud
      const fullSubject = await getSubjectDetails(subject.id);
      
      if (isMountedRef.current && fullSubject) {
        // Update active subject with the one containing data
        setActiveSubject(fullSubject);
        // Merge chat history if the full fetch has more recent/different history
        // (Though currently cloud history isn't fully implemented, this is future-proof)
        if (fullSubject.chatHistory && fullSubject.chatHistory.length > 0) {
           setChatHistory(fullSubject.chatHistory);
        }
      }
    } catch (err) {
      console.error("Failed to load subject context:", err);
      // Optional: Show error toast
    } finally {
      if (isMountedRef.current) {
        setIsChatLoading(false);
      }
    }
  };

  const handleBack = () => {
    setActiveSubject(null);
    fetchSubjects(); // Refresh list to get updated history summaries if we add them later
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading || !activeSubject) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    const optimisticHistory = [...chatHistory, userMsg];
    
    // 1. Optimistic Update
    setChatHistory(optimisticHistory);
    setChatInput('');
    setIsChatLoading(true);

    // Capture ID for background persistence
    const subjectId = activeSubject.id;
    const currentSub = activeSubject;

    // 2. Persist User Message Immediately
    await updateSubjectChatHistory(subjectId, optimisticHistory);

    try {
      // 3. API Call (This continues even if component unmounts)
      const responseText = await chatWithSubject(currentSub, optimisticHistory, userMsg.text, tutorModel);
      
      const aiMsg: ChatMessage = { role: 'model', text: responseText };
      const finalHistory = [...optimisticHistory, aiMsg];

      // 4. Persist AI Message Immediately (Background Safe)
      await updateSubjectChatHistory(subjectId, finalHistory);

      // 5. Update UI only if still mounted
      if (isMountedRef.current) {
        setChatHistory(finalHistory);
      }
    } catch (error) {
      console.error("Subject Chat Error", error);
      const errorMsg: ChatMessage = { role: 'model', text: "Sorry, I had trouble connecting to the source materials." };
      const errorHistory = [...optimisticHistory, errorMsg];
      
      // Persist error state so user sees it on return
      await updateSubjectChatHistory(subjectId, errorHistory);

      if (isMountedRef.current) {
         setChatHistory(errorHistory);
      }
    } finally {
      if (isMountedRef.current) {
        setIsChatLoading(false);
      }
    }
  };

  const renderMessageContent = (text: string) => {
    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts.map((part, index) => {
      if (part.startsWith('$$') && part.endsWith('$$')) {
        const math = part.slice(2, -2);
        try {
          const html = katex.renderToString(math, {
            displayMode: true,
            throwOnError: false,
            trust: false,
            maxExpand: 1000
          });
          const safeHtml = DOMPurify.sanitize(html);
          return <div key={index} dangerouslySetInnerHTML={{ __html: safeHtml }} className="my-2" />;
        } catch (e) {
          return <code key={index} className="block bg-slate-100 p-2 rounded">{math}</code>;
        }
      } else if (part.startsWith('$') && part.endsWith('$')) {
        const math = part.slice(1, -1);
        try {
          const html = katex.renderToString(math, {
            displayMode: false,
            throwOnError: false,
            trust: false,
            maxExpand: 1000
          });
          const safeHtml = DOMPurify.sanitize(html);
          return <span key={index} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
        } catch (e) {
          return <code key={index} className="bg-slate-100 px-1 rounded">{math}</code>;
        }
      } else {
        // Handle Bold (**text**)
        const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
        return (
          <span key={index}>
            {boldParts.map((subPart, subIdx) => {
              if (subPart.startsWith('**') && subPart.endsWith('**') && subPart.length >= 4) {
                return <strong key={subIdx} className="font-bold">{subPart.slice(2, -2)}</strong>;
              }
              // Handle remaining asterisks (simple strip)
              return <span key={subIdx}>{subPart.replace(/\*/g, '')}</span>;
            })}
          </span>
        );
      }
    });
  };

  if (activeSubject) {
    return (
      <div className="h-full flex flex-col bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-white overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Chat Header */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/80 backdrop-blur-md flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-3">
            <button 
              onClick={handleBack}
              className="p-2 hover:bg-slate-200 rounded-xl transition-colors text-slate-500"
            >
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-sm font-bold text-slate-800">{activeSubject.name}</h2>
              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                <span className="flex items-center gap-1"><PresentationChartBarIcon className="w-3 h-3" /> {activeSubject.lectureFiles.length} Notes</span>
                {activeSubject.studyGuideFiles && activeSubject.studyGuideFiles.length > 0 && 
                  <span className="flex items-center gap-1"><ClipboardDocumentCheckIcon className="w-3 h-3" /> {activeSubject.studyGuideFiles.length} Blueprint(s)</span>}
              </div>
            </div>
          </div>

          <div className="bg-slate-200 p-1 rounded-xl flex text-[10px] font-bold">
            <button 
              onClick={() => setTutorModel('flash')}
              className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg transition-all ${tutorModel === 'flash' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <BoltIcon className="w-3 h-3" /> Fast
            </button>
            <button 
              onClick={() => setTutorModel('pro')}
              className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg transition-all ${tutorModel === 'pro' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <SparklesIcon className="w-3 h-3" /> Deep
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
          {chatHistory.length === 0 && !isChatLoading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
              <ChatBubbleLeftRightIcon className="w-16 h-16 mb-4 text-slate-200" />
              <p className="text-sm font-bold text-slate-500">Chat with {activeSubject.name}</p>
              <p className="text-xs">Ask specifically about lecture slides or concepts.</p>
            </div>
          )}
          
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
               <div className={`max-w-[85%] rounded-2xl px-5 py-4 shadow-sm text-sm leading-relaxed ${
                 msg.role === 'user' 
                   ? 'bg-teal-600 text-white rounded-br-sm' 
                   : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm'
               }`}>
                 {renderMessageContent(msg.text)}
               </div>
            </div>
          ))}

          {isChatLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                {chatHistory.length === 0 && <span className="text-xs text-slate-400 ml-2 font-medium">Downloading context...</span>}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-slate-100 flex gap-3 shrink-0 items-center z-10">
          <input 
            type="text" 
            value={chatInput} 
            onChange={(e) => setChatInput(e.target.value)} 
            placeholder={isChatLoading ? "Loading files..." : `Ask about ${activeSubject.name}...`}
            className="flex-1 px-4 py-3.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all bg-slate-50 focus:bg-white" 
            disabled={isChatLoading} 
          />
          <button 
            type="submit" 
            disabled={!chatInput.trim() || isChatLoading} 
            className="bg-teal-600 text-white p-3.5 rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:scale-95 transition-all shadow-lg shadow-teal-500/20 active:scale-90"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full overflow-y-auto pr-2 custom-scrollbar">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">My Subjects</h2>
          <p className="text-xs text-slate-500 font-medium">Persistent storage for your classes and lectures.</p>
        </div>
        <button 
          onClick={() => onSelect('')}
          className="bg-white border border-slate-200 px-4 py-2 rounded-xl text-xs font-bold text-slate-600 flex items-center gap-2 hover:bg-slate-50 shadow-sm transition-all hover:scale-105 active:scale-95"
        >
          <PlusIcon className="w-4 h-4" /> New Subject
        </button>
      </div>

      {subjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-dashed border-slate-200 text-slate-400">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
             <InboxIcon className="w-10 h-10 opacity-30" />
          </div>
          <p className="text-sm font-bold text-slate-600">No subjects in DB yet.</p>
          <p className="text-xs mt-1">Upload materials and save them to a subject in the Predict tab.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjects.map(s => (
            <div 
              key={s.id} 
              onClick={() => onSelect(s.id)}
              className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 hover:border-slate-200 transition-all cursor-pointer group flex flex-col justify-between relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => handleDelete(s.id, e)}
                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    title="Delete Subject"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
              </div>

              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl flex items-center justify-center text-blue-600 shadow-inner">
                    <FolderIcon className="w-6 h-6" />
                  </div>
                </div>
                <h3 className="font-bold text-slate-800 group-hover:text-teal-600 transition-colors truncate text-lg">{s.name}</h3>
                <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-tight">
                    {new Date(s.dateCreated).toLocaleDateString()}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase bg-slate-50 px-2 py-1 rounded-lg">
                      <PresentationChartBarIcon className="w-3 h-3 text-teal-500" />
                      {s.lectureFiles.length} PDFs
                   </div>
                   <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-1 rounded-lg ${s.studyGuideFiles && s.studyGuideFiles.length > 0 ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-400'}`}>
                      <ClipboardDocumentCheckIcon className="w-3 h-3" />
                      {s.studyGuideFiles && s.studyGuideFiles.length > 0 ? `${s.studyGuideFiles.length} Blueprint${s.studyGuideFiles.length > 1 ? 's' : ''}` : 'No Guide'}
                   </div>
                </div>
                
                <button 
                  onClick={(e) => handleStartChat(e, s)}
                  className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all active:scale-95 group-hover:shadow-sm"
                >
                  <ChatBubbleLeftRightIcon className="w-4 h-4" /> 
                  {s.chatHistory && s.chatHistory.length > 0 ? 'Continue Chat' : 'Chat Source'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SubjectManager;
