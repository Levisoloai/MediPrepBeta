
import React, { useState, useEffect } from 'react';
import { getUsageStats, resetUsageStats } from '../services/usageService';
import { CpuChipIcon, TrashIcon } from '@heroicons/react/24/outline';

const TokenUsageDisplay: React.FC = () => {
  const [stats, setStats] = useState(getUsageStats());
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const handleUpdate = () => setStats(getUsageStats());
    window.addEventListener('usage_updated', handleUpdate);
    // Initial fetch to ensure client-side consistency
    handleUpdate();
    return () => window.removeEventListener('usage_updated', handleUpdate);
  }, []);

  const formatTokens = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
  };

  return (
    <div className="mt-auto px-4 w-full">
      <div 
        className={`bg-slate-900 rounded-xl overflow-hidden transition-all duration-300 border border-slate-700 ${isExpanded ? 'p-4' : 'p-2'}`}
      >
        <div 
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between cursor-pointer group"
        >
          <div className="flex items-center gap-2 text-slate-400 group-hover:text-teal-400 transition-colors">
            <CpuChipIcon className="w-5 h-5" />
            {!isExpanded && (
               <div className="flex flex-col items-start leading-none">
                 <span className="text-[10px] font-bold uppercase tracking-wider">Dev Cost</span>
                 <span className="text-xs font-mono text-white">${stats.estimatedCost.toFixed(4)}</span>
               </div>
            )}
          </div>
          {!isExpanded && stats.totalRequests > 0 && (
             <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" />
          )}
        </div>

        {isExpanded && (
          <div className="mt-4 space-y-3 animate-in slide-in-from-top-2">
            <div className="grid grid-cols-2 gap-2 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
               <div>Input</div>
               <div className="text-right text-slate-300 font-mono">{formatTokens(stats.totalInput)}</div>
               
               <div>Output</div>
               <div className="text-right text-teal-400 font-mono">{formatTokens(stats.totalOutput)}</div>
               
               <div>Calls</div>
               <div className="text-right text-white font-mono">{stats.totalRequests}</div>
            </div>

            <div className="pt-3 border-t border-slate-700 flex items-center justify-between">
               <div>
                  <div className="text-[9px] text-slate-500 uppercase font-black">Est. Cost</div>
                  <div className="text-lg font-mono text-white leading-none">${stats.estimatedCost.toFixed(4)}</div>
               </div>
               <button 
                 onClick={(e) => { e.stopPropagation(); resetUsageStats(); }}
                 className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                 title="Reset Stats"
               >
                 <TrashIcon className="w-4 h-4" />
               </button>
            </div>
            
            <p className="text-[9px] text-slate-600 italic text-center leading-tight">
               Estimates based on Gemini 3 Pro/Flash paid tier pricing (including >200k context rates).
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenUsageDisplay;
