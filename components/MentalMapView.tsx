
import React, { useState, useRef } from 'react';
import { MapIcon, ArrowDownTrayIcon, SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { generateMentalMap } from '../services/geminiService';
import katex from 'katex';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

const MentalMapView: React.FC = () => {
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setIsLoading(true);
    setContent(null);
    try {
      const data = await generateMentalMap(topic);
      setContent(data);
    } catch (err) {
      alert("Failed to generate map. Try a clearer medical topic.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!contentRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(contentRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: 800,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(`MediPrep_MentalMap_${topic.replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error("PDF Export Error", err);
    } finally {
      setIsExporting(false);
    }
  };

  const renderInline = (text: string) => {
    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts.map((part, i) => {
      if (part.startsWith('$$')) {
        const math = part.slice(2, -2);
        try {
          const html = katex.renderToString(math, { displayMode: true });
          return <div key={i} dangerouslySetInnerHTML={{ __html: html }} className="my-2" />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else if (part.startsWith('$')) {
        const math = part.slice(1, -1);
        try {
          const html = katex.renderToString(math);
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch(e) { return <code key={i}>{math}</code> }
      } else {
        const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
        return (
          <span key={i}>
            {boldParts.map((sub, j) => {
              if (sub.startsWith('**')) return <strong key={j} className="font-bold text-indigo-900">{sub.slice(2, -2)}</strong>;
              return <span key={j}>{sub.replace(/[#\*]/g, '')}</span>;
            })}
          </span>
        );
      }
    });
  };

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactElement[] = [];
    let currentTable: string[][] = [];

    const flushTable = (key: number) => {
      if (currentTable.length > 0) {
        const hasSeparator = currentTable.length > 1 && currentTable[1].some(cell => cell.includes('---'));
        const headerRows = hasSeparator ? [currentTable[0]] : [currentTable[0]];
        const bodyRows = hasSeparator ? currentTable.slice(2) : currentTable.slice(1);

        elements.push(
          <div key={`table-${key}`} className="my-6 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
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
        currentTable.push(cols);
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
          <MapIcon className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-black text-slate-800 mb-2">Mental Mapping</h1>
        <p className="text-slate-500 max-w-lg mx-auto">
          Differentiate related medical concepts with step-by-step decision trees and side-by-side tables.
        </p>
      </div>

      <div className="max-w-2xl mx-auto w-full mb-8">
        <form onSubmit={handleGenerate} className="flex gap-2">
          <input 
            type="text" 
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="e.g. Macrocytic vs Microcytic Anemias..."
            className="flex-1 px-4 py-4 rounded-2xl border border-slate-200 shadow-sm text-lg outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all bg-white"
            disabled={isLoading}
          />
          <button 
            type="submit"
            disabled={!topic.trim() || isLoading}
            className="px-8 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {isLoading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <SparklesIcon className="w-5 h-5" />}
            Map
          </button>
        </form>
      </div>

      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center">
           <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4" />
           <p className="text-indigo-600 font-bold animate-pulse">Building Decision Tree...</p>
        </div>
      )}

      {content && (
        <div className="flex-1 flex flex-col animate-in slide-in-from-bottom-8 duration-500">
          <div className="flex justify-end mb-4">
             <button 
               onClick={handleExportPDF} 
               disabled={isExporting}
               className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-50"
             >
               <ArrowDownTrayIcon className="w-4 h-4" /> 
               {isExporting ? 'Exporting...' : 'Export PDF'}
             </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-100 p-10 md:p-14 mb-8">
            <div ref={contentRef} className="max-w-4xl mx-auto">
               <div className="mb-10 border-b border-slate-100 pb-6 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                     <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black">MP</div>
                     <div>
                        <h4 className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">MediPrep Mental Map</h4>
                        <h1 className="text-2xl font-black text-slate-900 leading-tight">{topic}</h1>
                     </div>
                  </div>
               </div>
               <div className="space-y-4">
                  {renderMarkdown(content)}
               </div>
            </div>
          </div>
        </div>
      )}

      {!content && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center opacity-40">
           <MapIcon className="w-20 h-20 text-slate-200 mb-4" />
           <p className="text-sm font-bold text-slate-400">Ready to map out your logic.</p>
        </div>
      )}
    </div>
  );
};

export default MentalMapView;
