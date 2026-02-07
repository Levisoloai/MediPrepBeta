
import React, { useState, useRef } from 'react';
import { CameraIcon, PhotoIcon, SparklesIcon, ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid';
import { analyzeMcqScreenshot } from '../services/geminiService';
import katex from 'katex';
import DOMPurify from 'dompurify';

const QuestionSolverView: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('');
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert("Please upload an image file (PNG, JPG).");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setImage(base64);
      setMimeType(file.type);
      setAnalysis(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSolve = async () => {
    if (!image) return;

    setIsLoading(true);
    setError(null);
    setAnalysis(null);
    
    try {
      const result = await analyzeMcqScreenshot(image, mimeType);
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message || "Analysis failed. Ensure the screenshot is clear and contains a medical question.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderInline = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts.map((part, i) => {
      if (part.startsWith('$$')) {
        const math = part.slice(2, -2);
        try {
          const html = katex.renderToString(math, {
            displayMode: true,
            throwOnError: false,
            trust: false,
            maxExpand: 1000
          });
          const safeHtml = DOMPurify.sanitize(html);
          return <div key={i} dangerouslySetInnerHTML={{ __html: safeHtml }} className="my-2" />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else if (part.startsWith('$')) {
        const math = part.slice(1, -1);
        try {
          const html = katex.renderToString(math, {
            displayMode: false,
            throwOnError: false,
            trust: false,
            maxExpand: 1000
          });
          const safeHtml = DOMPurify.sanitize(html);
          return <span key={i} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else {
        const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
        return (
          <span key={i}>
            {boldParts.map((sub, j) => {
              if (sub.startsWith('**') && sub.endsWith('**')) return <strong key={j} className="font-bold text-indigo-900">{sub.slice(2, -2)}</strong>;
              return <span key={j}>{sub.replace(/[#\*]/g, '')}</span>;
            })}
          </span>
        );
      }
    });
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let currentTable: string[][] = [];

    const flushTable = (key: number) => {
      if (currentTable.length > 0) {
        const tableKey = `table-${key}`;
        const hasSeparator = currentTable.length > 1 && currentTable[1].some(cell => cell.includes('---'));
        const headerRows = currentTable.length > 0 ? [currentTable[0]] : [];
        const bodyRows = hasSeparator ? currentTable.slice(2) : currentTable.slice(1);

        elements.push(
          <div key={tableKey} className="my-6 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left table-fixed border-collapse">
              <thead className="bg-indigo-600 text-white">
                {headerRows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <th key={j} className="p-3 text-xs font-black uppercase tracking-wider border-r border-indigo-500 last:border-0 break-words">
                        {renderInline(cell.trim())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {bodyRows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    {row.map((cell, j) => (
                      <td key={j} className="p-3 text-sm text-slate-700 break-words border-r border-slate-50 last:border-0 align-top">
                        {renderInline(cell.trim())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        currentTable = [];
      }
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('|')) {
        const cols = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
        if (cols.length > 0) {
           currentTable.push(cols);
        }
      } else {
        flushTable(index);
        if (trimmed) {
          elements.push(
            <div key={index} className="mb-4 text-slate-700 leading-relaxed">
              {renderInline(line)}
            </div>
          );
        } else {
          elements.push(<div key={index} className="h-4" />);
        }
      }
    });
    flushTable(lines.length);
    return elements;
  };

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full p-4 animate-in fade-in duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center p-3 bg-indigo-100 text-indigo-700 rounded-2xl mb-4">
          <CameraIcon className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-black text-slate-800 mb-2">Question Solver</h1>
        <p className="text-slate-500 max-w-lg mx-auto">
          Drop a screenshot of any MCQ. AI will solve it and walk you through the clinical logic.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 min-h-0">
        {/* Upload Column */}
        <div className="flex flex-col gap-4">
           <div 
             onClick={() => fileInputRef.current?.click()}
             className={`flex-1 border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${image ? 'border-indigo-400 bg-indigo-50/30' : 'border-slate-200 hover:border-indigo-400 hover:bg-slate-50'}`}
           >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
              {image ? (
                <img 
                  src={`data:${mimeType};base64,${image}`} 
                  className="max-h-full object-contain rounded-xl shadow-lg border border-white" 
                  alt="Question Screenshot"
                />
              ) : (
                <div className="text-center">
                  <PhotoIcon className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                  <p className="font-bold text-slate-500">Upload Screenshot</p>
                  <p className="text-xs text-slate-400 mt-1">PNG, JPG or JPEG</p>
                </div>
              )}
           </div>
           
           <button 
             onClick={handleSolve}
             disabled={!image || isLoading}
             className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 shadow-xl shadow-indigo-500/20 active:scale-95"
           >
             {isLoading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <SparklesIcon className="w-5 h-5" />}
             {isLoading ? 'Deconstructing...' : 'Solve & Walkthrough'}
           </button>

           {error && (
             <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-center gap-3">
                <ExclamationCircleIcon className="w-5 h-5 shrink-0" />
                <p className="text-xs font-medium">{error}</p>
             </div>
           )}
        </div>

        {/* Analysis Column */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden flex flex-col min-h-[300px]">
           <div className="p-4 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Preceptor Analysis</span>
              {analysis && <span className="px-2 py-1 bg-green-100 text-green-700 rounded-md text-[10px] font-black uppercase">Complete</span>}
           </div>
           <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              {analysis ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-500 text-slate-800">
                   {renderMarkdown(analysis)}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
                   <div className="w-12 h-12 border-2 border-slate-200 rounded-xl mb-4 border-dashed" />
                   <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                     {isLoading ? 'Analyzing Screenshot...' : 'Awaiting Input'}
                   </p>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default QuestionSolverView;
