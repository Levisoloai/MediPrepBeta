
import React, { useState } from 'react';
import { generateClerkshipInfo } from '../services/geminiService';
import { MagnifyingGlassIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import { SparklesIcon } from '@heroicons/react/24/solid';
import katex from 'katex';

interface ClerkshipViewProps {
}

const SUGGESTIONS = [
  "Acute Pancreatitis",
  "Doxorubicin",
  "Lumbar Puncture",
  "Small Cell Lung Cancer",
  "Lisinopril",
  "Central Line Placement"
];

const ClerkshipView: React.FC<ClerkshipViewProps> = () => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent, term?: string) => {
    if (e) e.preventDefault();
    const q = term || query;
    if (!q.trim()) return;

    setQuery(q);
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await generateClerkshipInfo(q);
      setResult(data);
    } catch (err: any) {
      setError("Failed to fetch clinical data. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, index) => {
      // Headers
      if (line.startsWith('# ')) {
        return <h1 key={index} className="text-3xl font-black text-teal-800 mb-6 border-b-2 border-teal-100 pb-2">{line.replace('# ', '')}</h1>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={index} className="text-lg font-bold text-slate-700 mt-6 mb-3 uppercase tracking-wide flex items-center gap-2">
            <span className="w-1.5 h-4 bg-teal-500 rounded-full inline-block"></span>
            {line.replace('## ', '')}
        </h2>;
      }
      
      const parts = line.split(/(\*\*[\s\S]*?\*\*|\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
      
      // Check for List Items
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        return (
          <li key={index} className="ml-4 pl-4 text-slate-700 leading-relaxed mb-1.5 relative list-none">
            <span className="absolute left-0 top-2.5 w-1.5 h-1.5 rounded-full bg-teal-300"></span>
             {parts.map((part, i) => renderPart(part, i))}
          </li>
        );
      }
      
      // Empty lines
      if (!line.trim()) return <div key={index} className="h-2" />;

      // Standard Paragraph
      return (
        <p key={index} className="text-slate-700 leading-relaxed mb-2">
          {parts.map((part, i) => renderPart(part, i))}
        </p>
      );
    });
  };

  const renderPart = (part: string, index: number) => {
     if (part.startsWith('$$')) {
        const math = part.slice(2, -2);
        try {
           const html = katex.renderToString(math, { displayMode: true });
           return <span key={index} dangerouslySetInnerHTML={{ __html: html }} className="block my-2" />;
        } catch(e) { return <code key={index}>{math}</code> }
     } else if (part.startsWith('$')) {
        const math = part.slice(1, -1);
        try {
           const html = katex.renderToString(math);
           return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch(e) { return <code key={index}>{math}</code> }
     } else if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
     } else {
        return <span key={index}>{part.replace(/^[\-*] /, '')}</span>;
     }
  };

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full p-2">
      <div className="text-center mb-8 mt-4">
        <div className="inline-flex items-center justify-center p-3 bg-teal-100 text-teal-700 rounded-2xl mb-4">
          <ClipboardDocumentListIcon className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-black text-slate-800 mb-2">Clerkship Companion</h1>
        <p className="text-slate-500 max-w-lg mx-auto">
          Your AI Preceptor for rotations. Enter a disease, drug, or procedure for an instant high-yield summary.
        </p>
      </div>

      {/* Search Bar */}
      <div className="max-w-2xl mx-auto w-full relative mb-6 z-20">
        <form onSubmit={(e) => handleSearch(e)} className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className={`w-6 h-6 transition-colors ${isLoading ? 'text-teal-500 animate-pulse' : 'text-slate-400 group-focus-within:text-teal-600'}`} />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search e.g., 'Appendicitis', 'Metformin', 'Thoracentesis'..."
            className="w-full pl-14 pr-4 py-4 rounded-2xl border border-slate-200 shadow-sm text-lg outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 transition-all bg-white"
            disabled={isLoading}
          />
          <button 
             type="submit"
             disabled={!query.trim() || isLoading}
             className="absolute right-2 top-2 bottom-2 bg-teal-600 text-white px-6 rounded-xl font-bold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? 'Thinking...' : 'Consult'}
          </button>
        </form>
        
        {/* Suggestions */}
        {!result && !isLoading && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map(s => (
              <button 
                key={s} 
                onClick={() => handleSearch(undefined, s)}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-xs font-bold hover:bg-slate-200 hover:text-slate-800 transition-colors flex items-center gap-1"
              >
                <SparklesIcon className="w-3 h-3 text-slate-400" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Result Area */}
      {error && (
        <div className="max-w-2xl mx-auto p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-center">
          {error}
        </div>
      )}

      {result && (
        <div className="flex-1 overflow-y-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
           <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 md:p-12 mb-8">
              <div className="prose prose-slate max-w-none">
                {renderContent(result)}
              </div>
              
              <div className="mt-12 pt-6 border-t border-slate-100 text-center">
                 <p className="text-xs text-slate-400 italic">
                   *This content is generated by AI for educational purposes only. Always verify with standard clinical guidelines (UpToDate, CDC) before patient care.
                 </p>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default ClerkshipView;
