
import React, { useState, useRef, useEffect } from 'react';
import { StudyPlanItem, StudyFile, Subject } from '../types';
import { generateStudyPlan } from '../services/geminiService';
import { getLatestStudyPlan, saveStudyPlan, deleteStudyPlan, getSubjects } from '../services/storageService';
import { 
  CalendarDaysIcon, 
  ArrowUpTrayIcon, 
  SparklesIcon, 
  ArrowPathIcon,
  CheckCircleIcon,
  AcademicCapIcon,
  BoltIcon,
  ClockIcon,
  InboxIcon,
  MapIcon,
  CalendarIcon,
  TrashIcon
} from '@heroicons/react/24/solid';

interface SchedulePlannerViewProps {
  onLaunchTopic?: (topic: string) => void;
}

const SchedulePlannerView: React.FC<SchedulePlannerViewProps> = ({ onLaunchTopic }) => {
  const [file, setFile] = useState<StudyFile | null>(null);
  const [plan, setPlan] = useState<StudyPlanItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing plan and subjects on mount
  useEffect(() => {
    const loadData = async () => {
      const existingPlan = await getLatestStudyPlan();
      if (existingPlan) setPlan(existingPlan);
      
      const subs = await getSubjects();
      setSubjects(subs);
    };
    loadData();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const isIcal = f.name.toLowerCase().endsWith('.ics');
    const reader = new FileReader();
    
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setFile({ 
        name: f.name, 
        mimeType: isIcal ? 'text/calendar' : f.type, 
        data: base64 
      });
      setPlan(null);
    };
    reader.readAsDataURL(f);
  };

  const handleGenerate = async () => {
    if (!file) return;
    setIsLoading(true);
    try {
      const items = await generateStudyPlan(file);
      setPlan(items);
      // Persist to Supabase/IDB immediately
      await saveStudyPlan(items, selectedSubjectId || undefined);
    } catch (err: any) {
      alert(err.message || "Failed to parse schedule. Try a clearer PDF or ICS file.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    if (window.confirm("Are you sure you want to clear your current study plan?")) {
      await deleteStudyPlan();
      setPlan(null);
      setFile(null);
    }
  };

  const getTypeIcon = (type: string) => {
    switch(type) {
      case 'EXAM': return <BoltIcon className="w-5 h-5 text-rose-500" />;
      case 'LECTURE': return <AcademicCapIcon className="w-5 h-5 text-teal-500" />;
      case 'CLINICAL': return <ClockIcon className="w-5 h-5 text-indigo-500" />;
      default: return <SparklesIcon className="w-5 h-5 text-amber-500" />;
    }
  };

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full p-4 animate-in fade-in duration-500 overflow-y-auto custom-scrollbar pb-24">
      <div className="text-center mb-10 mt-6">
        <div className="inline-flex items-center justify-center p-3 bg-teal-100 text-teal-700 rounded-2xl mb-4">
          <MapIcon className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-black text-slate-800 mb-2">Study Flow Planner</h1>
        <p className="text-slate-500 max-w-lg mx-auto">
          Upload your semester schedule, syllabus, or <span className="text-teal-600 font-bold">iCal/ICS calendar</span>. AI will sync your events and map out tailored study blocks.
        </p>
      </div>

      {!plan && (
        <div className="max-w-xl mx-auto w-full space-y-6">
           <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Optional: Link to Subject</label>
              <select 
                value={selectedSubjectId} 
                onChange={e => setSelectedSubjectId(e.target.value)}
                className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-4 focus:ring-teal-500/10 transition-all"
              >
                <option value="">No Subject (General Schedule)</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
           </div>

           <div 
             onClick={() => fileInputRef.current?.click()}
             className={`border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all ${file ? 'border-teal-400 bg-teal-50/30' : 'border-slate-200 hover:border-teal-400 hover:bg-slate-50'}`}
           >
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".pdf,image/*,.ics" />
              {file?.name.endsWith('.ics') ? (
                <CalendarIcon className="w-12 h-12 mx-auto mb-4 text-teal-500 animate-bounce" />
              ) : (
                <ArrowUpTrayIcon className={`w-12 h-12 mx-auto mb-4 ${file ? 'text-teal-500' : 'text-slate-300'}`} />
              )}
              <h3 className="font-bold text-slate-700">{file ? file.name : 'Drop Schedule or Calendar (.ics)'}</h3>
              <p className="text-xs text-slate-400 mt-2">PDF, ICS, Image Grid, or Rotation Calendar</p>
           </div>
           
           {file && (
             <button 
               onClick={handleGenerate}
               disabled={isLoading}
               className="w-full mt-6 py-4 bg-teal-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-teal-700 shadow-xl shadow-teal-500/20 active:scale-95 transition-all flex items-center justify-center gap-3"
             >
               {isLoading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <SparklesIcon className="w-5 h-5" />}
               {isLoading ? 'Syncing Calendar...' : 'Build AI Study Plan'}
             </button>
           )}
        </div>
      )}

      {plan && (
        <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700">
           <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-xl font-black text-slate-800">Dynamic Study Timeline</h2>
              <div className="flex gap-4">
                 <button onClick={handleReset} className="text-xs font-bold text-slate-400 hover:text-rose-500 flex items-center gap-1 transition-colors">
                    <TrashIcon className="w-3 h-3" /> Clear Plan
                 </button>
                 <button onClick={() => setPlan(null)} className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1 transition-colors">
                    <ArrowPathIcon className="w-3 h-3" /> Upload New
                 </button>
              </div>
           </div>
           
           <div className="grid grid-cols-1 gap-4">
             {plan.map((item, idx) => (
               <div key={idx} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col md:flex-row gap-6 relative overflow-hidden group hover:border-teal-200 transition-all">
                  {item.priority === 'HIGH' && <div className="absolute top-0 left-0 w-1.5 h-full bg-rose-500" />}
                  
                  <div className="w-32 shrink-0">
                     <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Timing</div>
                     <div className="text-sm font-black text-slate-800">{item.date}</div>
                  </div>

                  <div className="flex-1">
                     <div className="flex items-center gap-2 mb-2">
                        {getTypeIcon(item.type)}
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.type}</span>
                        {item.priority === 'HIGH' && <span className="px-2 py-0.5 bg-rose-50 text-rose-600 text-[9px] font-black rounded uppercase tracking-tighter border border-rose-100 animate-pulse">Critical</span>}
                     </div>
                     <h3 className="font-bold text-lg text-slate-800 mb-1">{item.activityName}</h3>
                     <p className="text-xs text-slate-500 leading-relaxed">{item.description}</p>
                  </div>

                  <div className="w-full md:w-64 bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-between">
                     <div>
                        <div className="text-[10px] font-black text-teal-600 uppercase tracking-widest mb-2 flex items-center gap-1">
                           <CheckCircleIcon className="w-3.5 h-3.5" /> Study Target
                        </div>
                        <div className="text-sm font-bold text-slate-700 leading-tight">{item.suggestedTopic}</div>
                     </div>
                     <button 
                        onClick={() => onLaunchTopic?.(item.suggestedTopic)}
                        className="mt-4 w-full py-2 bg-white border border-slate-200 text-teal-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-50 transition-all shadow-sm group-hover:border-teal-300"
                     >
                        Deep Dive
                     </button>
                  </div>
               </div>
             ))}
           </div>
           
           <div className="text-center py-10 opacity-30">
              <InboxIcon className="w-12 h-12 mx-auto mb-2" />
              <p className="text-xs font-bold uppercase tracking-widest">End of visible schedule</p>
           </div>
        </div>
      )}
    </div>
  );
};

export default SchedulePlannerView;
