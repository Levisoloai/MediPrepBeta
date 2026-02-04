
import React, { useState } from 'react';
import { StoredQuestion } from '../types';
import { TrashIcon, CalendarIcon, Square2StackIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { deleteQuestion, clearAllQuestions } from '../services/storageService';
import { exportToAnki } from '../services/exportService';

interface LibraryProps {
  questions: StoredQuestion[];
  onRefresh: () => void;
}

const Library: React.FC<LibraryProps> = ({ questions, onRefresh }) => {
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this specific question? This action cannot be undone.")) {
      await deleteQuestion(id);
      onRefresh();
    }
  };

  const handleClearAll = async () => {
    if (window.confirm("CRITICAL ACTION: Are you sure you want to PERMANENTLY delete ALL questions in your bank? This includes cloud and local data.")) {
      const secondCheck = window.confirm("Double-check: Do you have a backup? This will wipe your entire MediBank progress.");
      if (secondCheck) {
        setIsDeletingAll(true);
        try {
          await clearAllQuestions();
          onRefresh();
        } finally {
          setIsDeletingAll(false);
        }
      }
    }
  };

  const handleAnkiExport = () => {
    if (questions.length === 0) return;
    exportToAnki(questions);
  };

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 animate-in fade-in">
        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
           <TrashIcon className="w-10 h-10 opacity-20" />
        </div>
        <p className="font-bold text-slate-500">Your MediBank is empty.</p>
        <p className="text-sm mt-1">Predict items or save them during review to build your cloud bank.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden h-full flex flex-col animate-in fade-in duration-500">
      <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-slate-900 text-white rounded-2xl">
             <Square2StackIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">MediBank Storage</h2>
            <div className="flex items-center gap-2">
               <span className="text-[10px] font-black uppercase text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md tracking-widest">{questions.length} Items Indexed</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleClearAll}
            disabled={isDeletingAll}
            className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest text-red-600 border border-red-100 bg-red-50/50 rounded-xl hover:bg-red-100 transition-all active:scale-95 disabled:opacity-50"
          >
            {isDeletingAll ? (
              <div className="w-3 h-3 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <TrashIcon className="w-4 h-4" />
            )}
            Clear Bank
          </button>
          <button
            onClick={handleAnkiExport}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white bg-slate-800 rounded-xl hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/10 active:scale-95"
          >
            <Square2StackIcon className="w-4 h-4" />
            Anki Export
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-slate-100">
            <tr>
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Question Fragment</th>
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest w-40">Type</th>
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest w-40">Next Review</th>
              <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {questions.map((q) => {
              const due = q.srs.nextReviewDate <= Date.now();
              return (
                <tr key={q.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="p-6">
                    <div className="flex flex-col gap-1.5">
                       <p className="text-sm text-slate-800 font-bold line-clamp-2 tracking-tight leading-snug">{q.questionText}</p>
                       <div className="flex gap-2">
                          {q.studyConcepts.slice(0, 2).map(c => (
                            <span key={c} className="text-[9px] font-black px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200 uppercase tracking-tighter">{c}</span>
                          ))}
                       </div>
                    </div>
                  </td>
                  <td className="p-6">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter bg-slate-50 px-2 py-1 rounded-lg">
                      {q.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-6">
                    <div className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-tighter ${due ? 'text-amber-600' : 'text-slate-400'}`}>
                      <CalendarIcon className="w-4 h-4" />
                      {due ? 'Review Now' : new Date(q.srs.nextReviewDate).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="p-6 text-right">
                    <button 
                      onClick={() => handleDelete(q.id)}
                      className="p-3 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-90 group-hover:text-slate-400"
                      title="Delete Item"
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Library;
