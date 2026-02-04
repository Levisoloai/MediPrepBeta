
import React, { useState, useEffect } from 'react';
import { getConceptMastery } from '../services/storageService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { ConceptMastery } from '../types';
import { 
  BoltIcon, 
  ChartBarIcon, 
  ShieldExclamationIcon, 
  CloudIcon, 
  CheckBadgeIcon,
  SignalIcon
} from '@heroicons/react/24/outline';
import AdUnit from './AdUnit';

const Dashboard: React.FC = () => {
  const [mastery, setMastery] = useState<ConceptMastery[]>([]);
  
  useEffect(() => {
    const fetch = async () => {
      const data = await getConceptMastery();
      setMastery(data);
    };
    fetch();
  }, []);
  
  const struggling = mastery
    .filter(m => m.attempts >= 1)
    .sort((a, b) => (a.correct / a.attempts) - (b.correct / b.attempts))
    .slice(0, 5);

  const totalAttempts = mastery.reduce((acc, m) => acc + m.attempts, 0);
  const totalCorrect = mastery.reduce((acc, m) => acc + m.correct, 0);
  const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

  return (
    <div className="space-y-6 h-full overflow-y-auto pr-2 custom-scrollbar">
      {/* Cloud Connectivity Status Bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${isSupabaseConfigured ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-600'}`}>
            <CloudIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-black text-slate-800 uppercase tracking-tight">Supabase Sync</div>
            <div className="text-[10px] text-slate-400 font-bold uppercase">{isSupabaseConfigured ? 'Connected: zdfhzyqewtgfnnyeklsx' : 'Disconnected'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isSupabaseConfigured ? 'bg-teal-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{isSupabaseConfigured ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ChartBarIcon className="w-12 h-12" />
          </div>
          <div className="flex items-center gap-2 text-teal-600 mb-2">
            <SignalIcon className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-wider">Board Accuracy</span>
          </div>
          <div className="text-3xl font-black text-slate-800">{accuracy}%</div>
          <p className="text-[10px] text-slate-400 mt-1 font-bold">Based on {totalAttempts} items</p>
        </div>
        
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <BoltIcon className="w-12 h-12" />
          </div>
          <div className="flex items-center gap-2 text-indigo-600 mb-2">
            <CheckBadgeIcon className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-wider">Mastery Points</span>
          </div>
          <div className="text-3xl font-black text-slate-800">{mastery.length}</div>
          <p className="text-[10px] text-slate-400 mt-1 font-bold">Distinct Concepts</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ShieldExclamationIcon className="w-12 h-12" />
          </div>
          <div className="flex items-center gap-2 text-rose-600 mb-2">
            <ShieldExclamationIcon className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-wider">High Risk Gaps</span>
          </div>
          <div className="text-3xl font-black text-slate-800">{struggling.filter(m => (m.correct/m.attempts) < 0.6).length}</div>
          <p className="text-[10px] text-slate-400 mt-1 font-bold">Critical Remediation</p>
        </div>

        {/* NATIVE AD CARD */}
        <AdUnit variant="card" className="h-full flex flex-col justify-center" />
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-100 text-rose-600 rounded-xl">
              <ShieldExclamationIcon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Topic Remediation Queue</h3>
          </div>
          <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-lg uppercase">Priority Sort</span>
        </div>
        <div className="divide-y divide-slate-50">
          {struggling.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm italic">
              Complete your first predicted exam to see clinical weak spots.
            </div>
          ) : (
            struggling.map((m, i) => {
              const rate = Math.round((m.correct / m.attempts) * 100);
              return (
                <div key={i} className="p-5 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                  <div>
                    <div className="text-sm font-black text-slate-800 tracking-tight">{m.concept}</div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase">{m.attempts} Attempts in Bank</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-black ${rate < 50 ? 'text-rose-600' : 'text-amber-600'}`}>{rate}%</div>
                    <div className="w-24 h-2 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                      <div className={`h-full transition-all duration-1000 ${rate < 50 ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${rate}%` }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 p-8 rounded-3xl text-white shadow-xl shadow-indigo-200 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-8 -mt-8 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl">
            <BoltIcon className="w-6 h-6 text-white" />
          </div>
          <h3 className="text-xl font-black tracking-tight">AI Diagnostic Engine</h3>
        </div>
        <p className="text-indigo-100 text-sm leading-relaxed mb-6 max-w-lg">
          We've detected {struggling.length} clinical gaps. Next time you click <strong>Predict Exam</strong>, the generator will automatically prioritize these mechanisms to ensure total board readiness.
        </p>
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest bg-white/10 w-fit px-3 py-1.5 rounded-full">
          <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          Remediation System Active
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
