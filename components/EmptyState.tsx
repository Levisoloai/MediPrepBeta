
import React from 'react';
import { AcademicCapIcon } from '@heroicons/react/24/outline';

interface EmptyStateProps {
  onViewChange?: (view: string) => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ onViewChange }) => {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
      <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
        <AcademicCapIcon className="w-12 h-12 text-slate-300" />
      </div>
      <h3 className="text-xl font-semibold text-slate-700 mb-2">Ready to Practice?</h3>
      <p className="max-w-md mx-auto mb-8 text-slate-500">
        Select a beta module (Heme or Pulm) to generate high-yield NBME-style practice questions.
      </p>
      
      <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto text-sm text-left">
        <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
          <span className="block font-medium text-teal-600 mb-1">Clinical Vignettes</span>
          Detailed patient scenarios to test diagnosis skills.
        </div>
        <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
          <span className="block font-medium text-teal-600 mb-1">Deep Dive</span>
          Jump into a focused tutor session for tricky topics.
        </div>
      </div>
      
      {onViewChange && (
        <button 
          onClick={() => onViewChange('deepdive')}
          className="mt-6 text-xs font-bold text-indigo-500 hover:text-indigo-700 hover:underline"
        >
          Want to learn a specific concept? Try Deep Dive Tutor &rarr;
        </button>
      )}
    </div>
  );
};

export default EmptyState;
