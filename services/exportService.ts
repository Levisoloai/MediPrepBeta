import { Question } from '../types';

/**
 * Exports questions to a CSV format compatible with Anki.
 * Format: "Front","Back"
 * The Front contains the question and options (if MC).
 * The Back contains the answer, explanation, and concepts.
 */
export const exportToAnki = (questions: Question[]) => {
  const escapeCsv = (str: string) => {
    if (!str) return '""';
    // Replace double quotes with double-double quotes and wrap in quotes
    return `"${str.replace(/"/g, '""')}"`;
  };

  const rows = questions.map(q => {
    // --- Front Card Construction ---
    let frontHtml = `<p><strong>${q.questionText}</strong></p>`;
    
    if (q.options && q.options.length > 0) {
      frontHtml += `<ul>`;
      q.options.forEach((opt, i) => {
         const label = String.fromCharCode(65 + i);
         frontHtml += `<li>${label}. ${opt}</li>`;
      });
      frontHtml += `</ul>`;
    }

    // --- Back Card Construction ---
    let backHtml = `<p><strong>Correct Answer: ${q.correctAnswer}</strong></p>`;
    backHtml += `<hr>`;
    backHtml += `<p><em>Explanation:</em><br>${q.explanation}</p>`;
    
    if (q.studyConcepts && q.studyConcepts.length > 0) {
      backHtml += `<br><p><small>Tags: ${q.studyConcepts.join(', ')}</small></p>`;
    }

    return `${escapeCsv(frontHtml)},${escapeCsv(backHtml)}`;
  });

  // Combine header and rows (Anki doesn't strictly require headers, but it helps)
  // Actually Anki usually expects NO header by default, or you map fields. 
  // We will output raw rows.
  const csvContent = rows.join('\n');
  
  // Create download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `mediprep_anki_export_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};