
import React, { useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import katex from 'katex';
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

interface SummaryViewProps {
  content: string;
  onBack: () => void;
}

const SummaryView: React.FC<SummaryViewProps> = ({ content, onBack }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadPDF = async () => {
    if (!contentRef.current) return;
    
    setIsDownloading(true);
    
    try {
      // Small timeout to allow UI to update
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(contentRef.current, {
        scale: 2, // Higher scale for better quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 1000, // Wider base for tables
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgWidth = pdfWidth; 
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;
      
      // First page
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
      
      // Subsequent pages if content is long
      while (heightLeft > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      pdf.save('MediPrep_CheatSheet.pdf');
    } catch (error) {
      console.error("PDF Export failed", error);
      alert("Failed to generate PDF. You can try printing the page (Ctrl+P) and Save as PDF.");
    } finally {
      setIsDownloading(false);
    }
  };

  // Helper to render text with LaTeX and Markdown formatting
  const renderContent = (text: string) => {
    // Split by lines to handle headers and lists
    const lines = text.split('\n');
    // Fix: Using React.ReactElement[] instead of JSX.Element[] to resolve "Cannot find namespace 'JSX'" error
    const elements: React.ReactElement[] = [];
    let currentTable: string[][] = [];

    const flushTable = (key: number) => {
      if (currentTable.length > 0) {
        elements.push(
          <div key={`table-${key}`} className="my-6 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left table-fixed border-collapse">
              <thead className="bg-slate-100">
                <tr>
                  {currentTable[0].map((cell, i) => (
                    <th key={i} className="p-3 text-sm font-bold text-slate-700 border-r border-slate-200 last:border-0 break-words">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {currentTable.slice(1).filter(row => !row.some(cell => cell.includes('---'))).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="p-3 text-sm text-slate-600 break-words border-r border-slate-50 last:border-0 align-top">
                        {renderInline(cell)}
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

      // Handle Tables
      if (trimmed.startsWith('|')) {
        const cells = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
        currentTable.push(cells);
        return;
      } else {
        flushTable(index);
      }

      // Handle Headers
      if (line.startsWith('### ')) {
        elements.push(<h3 key={index} className="text-lg font-bold text-teal-700 mt-6 mb-3 border-b border-teal-100 pb-1">{renderInline(line.replace('### ', ''))}</h3>);
        return;
      }
      if (line.startsWith('## ')) {
        elements.push(<h2 key={index} className="text-xl font-black text-slate-800 mt-8 mb-4 uppercase tracking-tight">{renderInline(line.replace('## ', ''))}</h2>);
        return;
      }
      if (line.startsWith('# ')) {
        elements.push(<h1 key={index} className="text-2xl font-black text-slate-900 mb-6 border-b-2 border-slate-200 pb-2">{renderInline(line.replace('# ', ''))}</h1>);
        return;
      }

      // Handle Lists
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        elements.push(
          <li key={index} className="ml-4 pl-2 text-slate-700 leading-relaxed mb-1 list-disc marker:text-teal-500">
            {renderInline(line.replace(/^[\-*] /, ''))}
          </li>
        );
        return;
      }
      if (line.match(/^\d+\. /)) {
         elements.push(
          <div key={index} className="ml-4 pl-2 text-slate-700 leading-relaxed mb-1 flex gap-2">
            <span className="font-bold text-teal-600 min-w-[20px]">{line.match(/^\d+\./)?.[0]}</span>
            <span>{renderInline(line.replace(/^\d+\. /, ''))}</span>
          </div>
         );
         return;
      }

      // Empty lines
      if (!line.trim()) {
        elements.push(<div key={index} className="h-2" />);
        return;
      }

      // Standard Paragraph
      elements.push(<p key={index} className="text-slate-700 leading-relaxed mb-2">{renderInline(line)}</p>);
    });

    flushTable(lines.length);
    return elements;
  };

  const renderInline = (text: string) => {
    // Math
    // Fix: Restoring functional LaTeX splitting regex and removing corrupted artifacts
    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
    return parts.map((part, i) => {
      if (part.startsWith('$')) {
        const math = part.replace(/\$/g, '');
        try {
          const html = katex.renderToString(math, { throwOnError: false });
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch (e) {
          return <code key={i}>{math}</code>;
        }
      }
      // Bold - Use multiline safe regex
      const boldParts = part.split(/(\*\*[\s\S]*?\*\*)/g);
      return (
        <span key={i}>
          {boldParts.map((sub, j) => {
            if (sub.startsWith('**') && sub.endsWith('**') && sub.length >= 4) {
              return <strong key={j} className="text-slate-900 font-bold">{sub.slice(2, -2)}</strong>;
            }
            // Strip asterisks
            return sub.replace(/\*/g, '');
          })}
        </span>
      );
    });
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="flex items-center justify-between mb-4 px-2">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-700 font-bold text-sm"
        >
          <ArrowLeftIcon className="w-4 h-4" /> Back
        </button>
        <button 
          onClick={handleDownloadPDF}
          disabled={isDownloading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold shadow transition-colors ${
            isDownloading 
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
              : 'bg-slate-800 text-white hover:bg-slate-700'
          }`}
        >
          {isDownloading ? (
             <>Processing...</>
          ) : (
             <><ArrowDownTrayIcon className="w-4 h-4" /> Download PDF</>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto w-full px-4">
        <div 
           ref={contentRef}
           className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 max-w-4xl mx-auto w-full mb-12"
        >
           <div className="flex items-center gap-2 mb-8 pb-4 border-b border-slate-100">
             <div className="bg-teal-600 w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-xs">AI</div>
             <div>
               <h1 className="text-sm font-bold text-slate-800 uppercase tracking-widest">MediPrep Cheat Sheet</h1>
               <p className="text-[10px] text-slate-400">Generated Study Material</p>
             </div>
           </div>
           
           <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600">
             {renderContent(content)}
           </div>
        </div>
      </div>
    </div>
  );
};

export default SummaryView;
