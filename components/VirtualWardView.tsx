
import React, { useState, useEffect, useRef } from 'react';
import { ClinicalCase, ChatMessage, CaseLabResult, CaseEvaluation, WardMode } from '../types';
import { startClinicalCase, interactWithPatient, orderMedicalTests, evaluateCase, chatWithPreceptor } from '../services/geminiService';
import { 
  UserIcon, 
  HeartIcon, 
  BeakerIcon, 
  ClipboardDocumentCheckIcon, 
  ChatBubbleLeftRightIcon, 
  PaperAirplaneIcon, 
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  AcademicCapIcon,
  SparklesIcon,
  XMarkIcon
} from '@heroicons/react/24/solid';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

const VirtualWardView: React.FC = () => {
  // Setup State
  const [specialty, setSpecialty] = useState('Cardiology');
  const [difficulty, setDifficulty] = useState('Resident');
  const [mode, setMode] = useState<WardMode>(WardMode.LEARNING);
  const [persona, setPersona] = useState<'Benevolent' | 'Socratic' | 'Rigorous'>('Socratic');
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Game State
  const [activeCase, setActiveCase] = useState<ClinicalCase | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [labResults, setLabResults] = useState<CaseLabResult[]>([]);
  const [evaluation, setEvaluation] = useState<CaseEvaluation | null>(null);
  
  // Preceptor Portal State
  const [showConsult, setShowConsult] = useState(false);
  const [consultHistory, setConsultHistory] = useState<ChatMessage[]>([]);
  const [consultInput, setConsultInput] = useState('');
  const [isConsultLoading, setIsConsultLoading] = useState(false);

  // UI State
  const [isChartExpanded, setIsChartExpanded] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [labInput, setLabInput] = useState('');
  const [diagnosisInput, setDiagnosisInput] = useState('');
  const [planInput, setPlanInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  
  // Modals
  const [showLabModal, setShowLabModal] = useState(false);
  const [showDischargeModal, setShowDischargeModal] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const consultEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isProcessing]);

  useEffect(() => {
    if (showConsult) {
      consultEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consultHistory, isConsultLoading, showConsult]);

  const handleStartCase = async () => {
    setIsInitializing(true);
    setChatHistory([]);
    setConsultHistory([]);
    setLabResults([]);
    setEvaluation(null);
    setDiagnosisInput('');
    setPlanInput('');
    
    try {
      const newCase = await startClinicalCase(specialty, difficulty);
      setActiveCase(newCase);
      setChatHistory([{ role: 'model', text: `Patient admitted. You are the lead physician. Walk in and start the interview whenever you are ready.` }]);
      setConsultHistory([{ role: 'model', text: `I am the Senior Resident on duty. Let me know if you need help with your differential or ordering labs.` }]);
    } catch (e) {
      alert("Failed to admit patient. Please try again.");
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !activeCase || isProcessing) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsProcessing(true);

    try {
      const response = await interactWithPatient(activeCase, [...chatHistory, userMsg], userMsg.text);
      setChatHistory(prev => [...prev, { role: 'model', text: response }]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendConsult = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!consultInput.trim() || !activeCase || isConsultLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: consultInput };
    setConsultHistory(prev => [...prev, userMsg]);
    setConsultInput('');
    setIsConsultLoading(true);

    try {
      const response = await chatWithPreceptor(activeCase, [...consultHistory, userMsg], userMsg.text, persona);
      setConsultHistory(prev => [...prev, { role: 'model', text: response }]);
    } catch (err) {
      setConsultHistory(prev => [...prev, { role: 'model', text: "Resident is paged to the ER. Try again in a moment." }]);
    } finally {
      setIsConsultLoading(false);
    }
  };

  const handleOrderLabs = async () => {
    if (!labInput.trim() || !activeCase) return;
    setIsProcessing(true);
    try {
      const results = await orderMedicalTests(activeCase, labInput);
      setLabResults(prev => [...results, ...prev]);
      setLabInput('');
      setShowLabModal(false);
    } catch (err) {
      alert("Lab system offline.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmitDiagnosis = async () => {
    if (!diagnosisInput.trim() || !activeCase) return;
    setIsEvaluating(true);
    try {
      const result = await evaluateCase(
        activeCase, 
        chatHistory, 
        labResults.map(l => l.testName), 
        diagnosisInput,
        planInput
      );
      setEvaluation(result);
      setShowDischargeModal(false);
    } catch (err) {
      alert("Attending is busy. Try again.");
    } finally {
      setIsEvaluating(false);
    }
  };

  const sanitizeFeedback = (text: string) => {
    return text.split('\n').map((line, i) => {
       const cleanLine = line.replace(/[#\*]/g, '');
       if (!cleanLine.trim()) return <div key={i} className="h-4" />;
       const isHeader = cleanLine === cleanLine.toUpperCase() && cleanLine.length > 5;
       return (
         <p key={i} className={`mb-2 text-sm leading-relaxed ${isHeader ? 'font-black text-slate-800 uppercase tracking-widest mt-6' : 'text-slate-600'}`}>
            {cleanLine}
         </p>
       );
    });
  };

  if (!activeCase) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-slate-50 overflow-y-auto">
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-10 text-center m-4">
          <div className="w-20 h-20 bg-teal-50 rounded-3xl flex items-center justify-center mx-auto mb-8 text-teal-600 shadow-inner rotate-3 hover:rotate-0 transition-transform">
             <HeartIcon className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-black text-slate-800 mb-2">Virtual Ward</h2>
          <p className="text-slate-500 mb-10 font-medium text-sm">Simulate high-fidelity clinical rotations with AI.</p>

          <div className="space-y-6 text-left mb-10">
            <div>
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Training Mode</label>
               <div className="flex p-1 bg-slate-100 rounded-xl mt-1.5 font-bold text-xs">
                 <button onClick={() => setMode(WardMode.LEARNING)} className={`flex-1 py-3 rounded-lg transition-all ${mode === WardMode.LEARNING ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'}`}>Learning</button>
                 <button onClick={() => setMode(WardMode.EXAM)} className={`flex-1 py-3 rounded-lg transition-all ${mode === WardMode.EXAM ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500'}`}>Exam</button>
               </div>
            </div>

            {mode === WardMode.LEARNING && (
               <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Preceptor Strictness</label>
                  <div className="grid grid-cols-3 p-1 bg-slate-100 rounded-xl mt-1.5 font-bold text-[10px]">
                    <button onClick={() => setPersona('Benevolent')} className={`py-2 rounded-lg transition-all ${persona === 'Benevolent' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-400'}`}>Benevolent</button>
                    <button onClick={() => setPersona('Socratic')} className={`py-2 rounded-lg transition-all ${persona === 'Socratic' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>Socratic</button>
                    <button onClick={() => setPersona('Rigorous')} className={`py-2 rounded-lg transition-all ${persona === 'Rigorous' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>Rigorous</button>
                  </div>
               </div>
            )}

            <div>
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Rotation Specialty</label>
               <select value={specialty} onChange={e => setSpecialty(e.target.value)} className="w-full mt-1.5 p-4 rounded-2xl border border-slate-200 bg-slate-50 font-bold text-slate-700 outline-none">
                  <option>Cardiology</option>
                  <option>Hematology</option>
                  <option>Pulmonology</option>
                  <option>Emergency Medicine</option>
                  <option>Infectious Disease</option>
                  <option>Endocrinology</option>
               </select>
            </div>
          </div>

          <button onClick={handleStartCase} disabled={isInitializing} className="w-full py-5 bg-teal-600 hover:bg-teal-700 text-white font-black rounded-2xl shadow-xl shadow-teal-500/30 transition-all active:scale-95 flex items-center justify-center gap-3 uppercase tracking-widest text-sm">
            {isInitializing ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <PlayIcon className="w-5 h-5" />}
            {isInitializing ? 'Preparing Room...' : 'Start Rounds'}
          </button>
        </div>
      </div>
    );
  }

  if (evaluation) {
     return (
        <div className="h-full overflow-y-auto p-6 md:p-10 bg-slate-50 animate-fade-in custom-scrollbar">
           <div className="max-w-4xl mx-auto space-y-8 pb-10">
              <button onClick={() => setActiveCase(null)} className="text-slate-400 font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:text-slate-800 transition-colors"><ArrowLeftIcon className="w-4 h-4" /> Exit Room</button>
              
              <div className="bg-white rounded-[2rem] p-10 border border-slate-200 shadow-xl text-center relative overflow-hidden">
                 <div className={`absolute top-0 left-0 w-full h-2 ${evaluation.score >= 70 ? 'bg-green-500' : 'bg-red-500'}`} />
                 <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Board Performance Record</h2>
                 <div className="text-7xl font-black text-slate-800 mb-4">{evaluation.score}%</div>
                 <p className="text-slate-500 font-bold text-lg">{evaluation.score >= 70 ? "Satisfactory clinical reasoning." : "Incomplete medical workup."}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm"><h3 className="text-[10px] font-black text-teal-600 uppercase tracking-widest mb-3">GOLD STANDARD DIAGNOSIS</h3><p className="text-2xl font-black text-slate-800">{evaluation.correctDiagnosis}</p></div>
                 <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200 shadow-sm"><h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">YOUR SUBMISSION</h3><p className="text-2xl font-black text-slate-600">{evaluation.userDiagnosis}</p></div>
              </div>

              {/* Critical Feedback Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {evaluation.criticalErrors && evaluation.criticalErrors.length > 0 && (
                    <div className="bg-rose-50 rounded-3xl p-8 border border-rose-100 shadow-sm">
                       <h3 className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                          <ExclamationTriangleIcon className="w-4 h-4" /> Safety Errors
                       </h3>
                       <ul className="space-y-2">
                          {evaluation.criticalErrors.map((err, i) => (
                             <li key={i} className="text-sm font-bold text-rose-800 leading-snug">• {err}</li>
                          ))}
                       </ul>
                    </div>
                 )}
                 {evaluation.missedSteps && evaluation.missedSteps.length > 0 && (
                    <div className="bg-amber-50 rounded-3xl p-8 border border-amber-100 shadow-sm">
                       <h3 className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                          <ClipboardDocumentCheckIcon className="w-4 h-4" /> Missed Workup
                       </h3>
                       <ul className="space-y-2">
                          {evaluation.missedSteps.map((step, i) => (
                             <li key={i} className="text-sm font-medium text-amber-800 leading-snug">• {step}</li>
                          ))}
                       </ul>
                    </div>
                 )}
              </div>

              <div className="bg-white rounded-3xl p-10 border border-slate-200 shadow-sm">
                 <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-3"><AcademicCapIcon className="w-6 h-6 text-teal-600" /> FEEDBACK & LOGIC</h3>
                 <div className="prose prose-slate max-w-none">{sanitizeFeedback(evaluation.feedback)}</div>
              </div>

              <div className="flex justify-center pt-8"><button onClick={() => setActiveCase(null)} className="px-12 py-4 bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-slate-800 transition-all active:scale-95">Discharge Patient</button></div>
           </div>
        </div>
     );
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-slate-100 overflow-hidden relative">
      
      {/* LEFT: PATIENT CHART & LABS */}
      <div className={`w-full md:w-96 bg-white border-r border-slate-200 flex flex-col z-20 shadow-2xl transition-all duration-500 ${!isChartExpanded ? 'h-16 md:w-20 overflow-hidden' : 'h-[30vh] md:h-full'}`}>
         <div className="p-6 border-b border-slate-100 bg-white flex items-center justify-between shrink-0">
            <div className={`flex items-center gap-3 transition-opacity ${!isChartExpanded && 'md:opacity-0'}`}>
               <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400"><UserIcon className="w-6 h-6" /></div>
               <div>
                  <h3 className="font-black text-slate-800 text-sm truncate max-w-[150px]">{activeCase.patientName}</h3>
                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">{activeCase.age}yo {activeCase.gender}</p>
               </div>
            </div>
            <button onClick={() => setIsChartExpanded(!isChartExpanded)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors md:hidden">{isChartExpanded ? <ChevronUpIcon className="w-5 h-5 text-slate-400" /> : <ChevronDownIcon className="w-5 h-5 text-slate-400" />}</button>
         </div>

         <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            <div>
               <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Physical Vitals</div>
               <div className="grid grid-cols-2 gap-3">
                  {Object.entries(activeCase.vitals).map(([key, val]) => (
                    <div key={key} className="bg-slate-50 p-3 rounded-2xl border border-slate-100"><span className="block text-[9px] text-slate-400 font-black uppercase tracking-tighter">{key}</span><span className="font-mono font-black text-slate-700 text-sm">{val}</span></div>
                  ))}
               </div>
            </div>
            <div>
               <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Entrance Assessment</div>
               <p className="text-xs text-slate-600 bg-teal-50/50 p-4 rounded-2xl italic border border-teal-100 leading-relaxed">"{activeCase.appearance}"</p>
            </div>
            <div className="border-t border-slate-100 pt-6">
               <div className="flex items-center justify-between mb-4"><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Medical Workup</div><span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-black">{labResults.length}</span></div>
               <div className="space-y-2 pb-10">
                  {labResults.map((lab, i) => (
                    <div key={i} className="flex justify-between items-center bg-white border border-slate-100 p-3 rounded-xl text-xs shadow-sm"><span className="font-black text-slate-700">{lab.testName}</span><span className={`font-mono font-bold ${lab.flag !== 'normal' ? 'text-rose-600' : 'text-slate-400'}`}>{lab.result}</span></div>
                  ))}
               </div>
            </div>
         </div>
      </div>

      {/* RIGHT: INTERACTION AREA (Redesigned with fixed footer to prevent overlap) */}
      <div className="flex-1 flex flex-col h-full bg-slate-50">
         {/* Main Chat Content */}
         <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6 custom-scrollbar scroll-smooth">
            {chatHistory.map((msg, i) => (
               <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                  <div className={`max-w-[85%] md:max-w-[70%] p-5 rounded-[1.5rem] shadow-sm text-sm leading-relaxed ${
                     msg.role === 'user' 
                     ? 'bg-teal-600 text-white rounded-br-none shadow-teal-500/10' 
                     : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none shadow-slate-200/20'
                  }`}>
                     {msg.text}
                  </div>
               </div>
            ))}
            {isProcessing && (
               <div className="flex justify-start">
                  <div className="bg-white p-4 rounded-2xl rounded-bl-none shadow-sm border border-slate-200">
                     <div className="flex gap-1.5"><div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" /><div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce delay-150" /><div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce delay-300" /></div>
                  </div>
               </div>
            )}
            <div ref={chatEndRef} className="h-4" />
         </div>

         {/* Fixed Static Footer Bar (No overlap) */}
         <div className="p-4 md:p-6 bg-white border-t border-slate-100 shrink-0 z-30">
            <div className="max-w-4xl mx-auto">
               <div className="bg-slate-50 border border-slate-200 shadow-inner rounded-[2rem] p-2 flex gap-2">
                  
                  {mode === WardMode.LEARNING && (
                     <button onClick={() => setShowConsult(true)} className="p-4 rounded-2xl bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all flex flex-col items-center justify-center min-w-[75px] active:scale-95 group">
                        <AcademicCapIcon className="w-6 h-6 mb-0.5 group-hover:scale-110 transition-transform" />
                        <span className="text-[9px] font-black uppercase tracking-tighter">Consult</span>
                     </button>
                  )}

                  <button onClick={() => setShowLabModal(true)} className="p-4 rounded-2xl bg-slate-200/50 text-slate-600 hover:bg-slate-200 transition-all flex flex-col items-center justify-center min-w-[75px] active:scale-95 group">
                     <BeakerIcon className="w-6 h-6 mb-0.5 group-hover:rotate-12 transition-transform" />
                     <span className="text-[9px] font-black uppercase tracking-tighter">Workup</span>
                  </button>

                  <form onSubmit={handleSendMessage} className="flex-1 flex gap-2">
                     <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Interview the patient..." className="flex-1 bg-white border border-slate-200 rounded-2xl px-6 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all font-medium text-sm" disabled={isProcessing} />
                     <button type="submit" disabled={!chatInput.trim() || isProcessing} className="bg-teal-600 text-white p-4 rounded-2xl hover:bg-teal-700 transition-all shadow-lg shadow-teal-500/20 active:scale-90 flex items-center justify-center"><PaperAirplaneIcon className="w-6 h-6" /></button>
                  </form>

                  <button onClick={() => setShowDischargeModal(true)} className="p-4 rounded-2xl bg-slate-900 text-white hover:bg-slate-800 transition-all flex flex-col items-center justify-center min-w-[75px] active:scale-95">
                     <ClipboardDocumentCheckIcon className="w-6 h-6 mb-0.5" />
                     <span className="text-[9px] font-black uppercase tracking-tighter">Submit</span>
                  </button>
               </div>
            </div>
         </div>
      </div>

      {/* CONSULT WINDOW (New Side Portal) */}
      {showConsult && (
         <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md z-[60] flex justify-end p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-lg h-full rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-full duration-500">
               <div className="p-8 border-b border-slate-100 bg-indigo-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/20"><AcademicCapIcon className="w-7 h-7" /></div>
                     <div>
                        <h3 className="font-black text-slate-800 text-lg">Senior Resident</h3>
                        <p className="text-[10px] text-indigo-600 font-black uppercase tracking-widest">{persona} Persona Active</p>
                     </div>
                  </div>
                  <button onClick={() => setShowConsult(false)} className="p-2 hover:bg-slate-200 rounded-xl transition-colors"><XMarkIcon className="w-6 h-6 text-slate-400" /></button>
               </div>
               
               <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50 custom-scrollbar">
                  {consultHistory.map((msg, i) => (
                     <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] p-5 rounded-[1.5rem] shadow-sm text-sm leading-relaxed ${
                           msg.role === 'user' 
                           ? 'bg-indigo-600 text-white rounded-br-none shadow-indigo-500/10' 
                           : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none shadow-slate-200/10'
                        }`}>
                           {msg.text}
                        </div>
                     </div>
                  ))}
                  {isConsultLoading && (
                     <div className="flex justify-start">
                        <div className="bg-white p-4 rounded-2xl rounded-bl-none shadow-sm border border-slate-200"><div className="flex gap-1.5"><div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" /><div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-150" /><div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-300" /></div></div>
                     </div>
                  )}
                  <div ref={consultEndRef} />
               </div>

               <form onSubmit={handleSendConsult} className="p-6 bg-white border-t border-slate-100 flex gap-3">
                  <input type="text" value={consultInput} onChange={e => setConsultInput(e.target.value)} placeholder="Ask for advice or lab help..." className="flex-1 bg-slate-100 border border-slate-200 rounded-2xl px-6 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-medium text-sm" />
                  <button type="submit" disabled={!consultInput.trim() || isConsultLoading} className="bg-indigo-600 text-white p-4 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg active:scale-90 flex items-center justify-center"><PaperAirplaneIcon className="w-6 h-6" /></button>
               </form>
            </div>
         </div>
      )}

      {/* LAB MODAL */}
      {showLabModal && (
         <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl">
               <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-3"><div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl"><BeakerIcon className="w-6 h-6" /></div> Order Workup</h3>
               <textarea value={labInput} onChange={e => setLabInput(e.target.value)} placeholder="e.g. CBC, BMP, Chest X-ray, ECG..." className="w-full h-40 p-5 bg-slate-50 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 mb-6 resize-none font-medium text-sm" />
               <div className="flex gap-4"><button onClick={() => setShowLabModal(false)} className="flex-1 py-4 font-black text-xs uppercase tracking-widest text-slate-400 hover:bg-slate-50 rounded-2xl">Cancel</button><button onClick={handleOrderLabs} disabled={isProcessing} className="flex-1 py-4 bg-indigo-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">{isProcessing ? 'Simulating...' : 'Submit Order'}</button></div>
            </div>
         </div>
      )}

      {/* DISCHARGE MODAL */}
      {showDischargeModal && (
         <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl">
               <h3 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-3"><div className="p-2 bg-teal-100 text-teal-600 rounded-xl"><CheckCircleIcon className="w-6 h-6" /></div> Final Clinical Submission</h3>
               <div className="space-y-6 mb-10">
                  <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Working Diagnosis</label><input value={diagnosisInput} onChange={e => setDiagnosisInput(e.target.value)} placeholder="What is the most likely diagnosis?" className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 font-bold text-slate-800" /></div>
                  <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Management & Disposition</label><textarea value={planInput} onChange={e => setPlanInput(e.target.value)} placeholder="Stabilization plan and next best steps..." className="w-full h-40 p-4 bg-slate-50 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 resize-none font-medium text-sm" /></div>
               </div>
               <div className="flex gap-4"><button onClick={() => setShowDischargeModal(false)} className="flex-1 py-4 font-black text-xs uppercase tracking-widest text-slate-400 hover:bg-slate-50 rounded-2xl">Cancel</button><button onClick={handleSubmitDiagnosis} disabled={isEvaluating} className="flex-1 py-4 bg-teal-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-teal-700 shadow-xl shadow-teal-500/20 active:scale-95 transition-all">{isEvaluating ? 'Presenting to Attending...' : 'Submit to Attending'}</button></div>
            </div>
         </div>
      )}
    </div>
  );
};

export default VirtualWardView;
