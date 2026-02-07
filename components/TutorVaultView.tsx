import React, { useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import {
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  DocumentTextIcon,
  ClipboardDocumentCheckIcon
} from '@heroicons/react/24/solid';
import type { TutorAnkiCard, TutorExportItem, TutorExportKind } from '../types';

type Props = {
  user?: any;
  exports: TutorExportItem[];
  onDelete: (id: string) => void;
  onClearAll: () => void;
};

type FilterKind = 'all' | TutorExportKind;

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
};

const downloadText = (text: string, filename: string, mime = 'text/plain;charset=utf-8') => {
  downloadBlob(new Blob([text], { type: mime }), filename);
};

const escapeCsvField = (value: string) => {
  const safe = String(value ?? '');
  const normalized = safe.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `"${normalized.replace(/"/g, '""')}"`;
};

const cardsToBasicCsv = (cards: TutorAnkiCard[]) => {
  return cards
    .map((c) => {
      const front = escapeCsvField(String(c.front ?? '').replace(/\n/g, '<br>'));
      const back = escapeCsvField(String(c.back ?? '').replace(/\n/g, '<br>'));
      return `${front},${back}`;
    })
    .join('\n');
};

const cardsToClozeCsv = (cards: TutorAnkiCard[]) => {
  // For Cloze note type: import as a single "Text" field.
  return cards
    .map((c) => {
      const front = String(c.front ?? '').trim();
      const back = String(c.back ?? '').trim();
      const text = `${front}\n\n{{c1::${back}}}`;
      return escapeCsvField(text.replace(/\n/g, '<br>'));
    })
    .join('\n');
};

const exportTextAsPdf = (title: string, body: string, filename: string) => {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 40;
  const marginTop = 44;
  const marginBottom = 44;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(title, marginX, marginTop);
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(11);

  const maxWidth = pageWidth - marginX * 2;
  const lines = pdf.splitTextToSize(body, maxWidth) as string[];
  let y = marginTop + 26;
  const lineH = 14;
  lines.forEach((line) => {
    if (y > pageHeight - marginBottom) {
      pdf.addPage();
      y = marginTop;
    }
    pdf.text(String(line), marginX, y);
    y += lineH;
  });

  pdf.save(filename);
};

const exportTextAsDocx = async (title: string, body: string, filename: string) => {
  const lines = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: title,
                bold: true,
                size: 32
              })
            ]
          }),
          ...lines.map(
            (line) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: line,
                    font: 'Courier New'
                  })
                ]
              })
          )
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, filename);
};

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const kindLabel = (kind: TutorExportKind) => {
  if (kind === 'session') return 'Session';
  if (kind === 'anki') return 'Anki';
  if (kind === 'table') return 'Table';
  if (kind === 'mnemonic') return 'Mnemonic';
  return kind;
};

type ParsedPipeTable = {
  headers: string[];
  rows: string[][];
};

const splitPipeRow = (line: string) => {
  const trimmed = String(line ?? '').trim();
  const noEdgePipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return noEdgePipes
    .split('|')
    .map((cell) => String(cell ?? '').trim());
};

const isSeparatorRow = (cells: string[]) => {
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(String(cell ?? '').trim()));
};

const parsePipeTable = (raw: string): ParsedPipeTable | null => {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const headerCells = splitPipeRow(lines[0]).filter((c) => c.length > 0);
  if (headerCells.length < 2) return null;

  const maybeSepCells = splitPipeRow(lines[1]);
  const hasSeparator = isSeparatorRow(maybeSepCells);

  const colCount = headerCells.length;
  const rows: string[][] = [];
  for (let i = hasSeparator ? 2 : 1; i < lines.length; i += 1) {
    const cells = splitPipeRow(lines[i]);
    if (cells.every((c) => c.trim().length === 0)) continue;
    const normalized = Array.from({ length: colCount }, (_, idx) => String(cells[idx] ?? '').trim());
    rows.push(normalized);
  }

  if (rows.length === 0) return null;
  return { headers: headerCells, rows };
};

const TutorVaultView: React.FC<Props> = ({ user, exports, onDelete, onClearAll }) => {
  const [filter, setFilter] = useState<FilterKind>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exports.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!q) return true;
      const hay = [
        item.title,
        item.kind,
        item.questionId || '',
        item.guideHash || '',
        item.sourceType || '',
        item.kind === 'session' ? item.messages.map((m) => m.text).join('\n') : '',
        item.kind === 'anki' ? item.cards.map((c) => `${c.front} ${c.back}`).join('\n') : '',
        item.kind === 'table' ? item.tableText : '',
        item.kind === 'mnemonic' ? item.mnemonic : ''
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [exports, filter, query]);

  const allAnkiCards = useMemo(() => {
    const cards: TutorAnkiCard[] = [];
    exports.forEach((item) => {
      if (item.kind === 'anki') cards.push(...item.cards);
    });
    return cards;
  }, [exports]);

  const exportAllAnki = (mode: 'basic' | 'cloze') => {
    if (allAnkiCards.length === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    if (mode === 'basic') {
      const csv = cardsToBasicCsv(allAnkiCards);
      downloadText(csv, `mediprep_anki_prompts_basic_${date}.csv`, 'text/csv;charset=utf-8');
      return;
    }
    const csv = cardsToClozeCsv(allAnkiCards);
    downloadText(csv, `mediprep_anki_prompts_cloze_${date}.csv`, 'text/csv;charset=utf-8');
  };

  return (
    <div className="h-full flex flex-col p-6 md:p-10">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
            <ArchiveBoxIcon className="w-4 h-4" />
            Tutor Vault
          </div>
          <h2 className="mt-4 text-3xl md:text-4xl font-black tracking-tight text-slate-900">
            Saved tutor outputs
          </h2>
          <p className="mt-3 text-slate-600 text-sm md:text-base font-medium max-w-3xl leading-relaxed">
            Save full sessions, Anki prompts, tables, and mnemonics directly from the tutor. Export Anki-ready files or
            compile study notes for last minute review.
          </p>
          <div className="mt-3 text-[11px] text-slate-500 font-semibold">
            {user?.email ? `Signed in as ${user.email}.` : 'Not signed in (saved locally).'} Total saved: {exports.length}
          </div>
        </div>

        <div className="w-full lg:w-[420px] p-4 rounded-3xl border border-slate-200 bg-white/90 shadow-sm">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Quick export</div>
              <button
                type="button"
                onClick={() => {
                  if (!exports.length) return;
                  const ok = window.confirm('Clear all saved tutor exports on this device?');
                  if (!ok) return;
                  onClearAll();
                }}
                disabled={exports.length === 0}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                  exports.length === 0
                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                }`}
              >
                <TrashIcon className="w-4 h-4" />
                Clear all
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={allAnkiCards.length === 0}
                onClick={() => exportAllAnki('basic')}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                  allAnkiCards.length === 0
                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                }`}
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                Export all Anki (Basic)
              </button>
              <button
                type="button"
                disabled={allAnkiCards.length === 0}
                onClick={() => exportAllAnki('cloze')}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                  allAnkiCards.length === 0
                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                }`}
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                Export all Anki (Cloze)
              </button>
            </div>

            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Search</div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by concept, question, or text…"
                className="mt-2 w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-700"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(['all', 'session', 'anki', 'table', 'mnemonic'] as FilterKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${
              filter === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {k === 'all' ? 'All' : kindLabel(k)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-24 pr-2 custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="p-8 rounded-3xl border border-slate-200 bg-white/90 shadow-sm">
            <div className="text-sm text-slate-700 font-semibold">No saved items yet.</div>
            <div className="mt-2 text-[12px] text-slate-500 font-medium">
              Open the AI tutor, then use the Save buttons above the input box to capture Anki prompts, tables, mnemonics, or the full session.
            </div>
          </div>
        ) : (
          filtered.map((item) => {
            const date = formatDateTime(item.createdAt);
            return (
              <div
                key={item.id}
                className="rounded-3xl border border-white/60 bg-white/45 backdrop-blur-xl shadow-[0_22px_70px_-55px_rgba(15,23,42,0.35)] overflow-hidden"
              >
                <div className="p-4 md:p-6">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-3 py-1.5 rounded-full bg-slate-900/85 text-white text-[10px] font-black uppercase tracking-widest">
                          {kindLabel(item.kind)}
                        </span>
                        <span className="px-3 py-1.5 rounded-full border border-white/60 bg-white/40 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-slate-700">
                          {date}
                        </span>
                        {item.guideHash && (
                          <span className="px-3 py-1.5 rounded-full border border-white/60 bg-white/40 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-slate-700">
                            {String(item.guideHash).slice(0, 10)}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 text-lg font-black text-slate-900">{item.title}</div>
                      {item.questionId && (
                        <div className="mt-1 text-[11px] text-slate-500 font-semibold">Question: {item.questionId}</div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      {item.kind === 'anki' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const csv = cardsToBasicCsv(item.cards);
                              downloadText(csv, `${item.title.replace(/\s+/g, '_')}_anki_basic.csv`, 'text/csv;charset=utf-8');
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                            Basic CSV
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const csv = cardsToClozeCsv(item.cards);
                              downloadText(csv, `${item.title.replace(/\s+/g, '_')}_anki_cloze.csv`, 'text/csv;charset=utf-8');
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                            Cloze CSV
                          </button>
                        </>
                      )}

                      {(item.kind === 'table' || item.kind === 'mnemonic' || item.kind === 'session') && (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              const title = item.title;
                              const body =
                                item.kind === 'table'
                                  ? item.tableText
                                  : item.kind === 'mnemonic'
                                  ? item.mnemonic
                                  : item.messages.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n');
                              await exportTextAsDocx(title, body, `${title.replace(/\s+/g, '_')}.docx`);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest hover:bg-white"
                          >
                            <DocumentTextIcon className="w-4 h-4" />
                            DOCX
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const title = item.title;
                              const body =
                                item.kind === 'table'
                                  ? item.tableText
                                  : item.kind === 'mnemonic'
                                  ? item.mnemonic
                                  : item.messages.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n');
                              exportTextAsPdf(title, body, `${title.replace(/\s+/g, '_')}.pdf`);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest hover:bg-white"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                            PDF
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => onDelete(item.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-black uppercase tracking-widest hover:bg-rose-100"
                      >
                        <TrashIcon className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-5">
                    {item.kind === 'anki' && (
                      <div className="p-4 rounded-2xl border border-white/60 bg-white/50 backdrop-blur-md">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cards</div>
                        <div className="mt-2 text-sm font-semibold text-slate-800">
                          {item.cards.length} prompts
                        </div>
                        <div className="mt-3 space-y-3">
                          {item.cards.slice(0, 3).map((card, idx) => (
                            <div key={idx} className="text-[12px] text-slate-700">
                              <div className="font-black">Front:</div>
                              <div className="font-semibold text-slate-600">{card.front}</div>
                              <div className="mt-1 font-black">Back:</div>
                              <div className="font-semibold text-slate-600">{card.back}</div>
                            </div>
                          ))}
                          {item.cards.length > 3 && (
                            <div className="text-[11px] text-slate-500 font-semibold">
                              Showing first 3 of {item.cards.length}.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {item.kind === 'table' && (
                      <div className="p-4 rounded-2xl border border-white/60 bg-white/50 backdrop-blur-md">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          <ClipboardDocumentCheckIcon className="w-4 h-4" />
                          Compare table
                        </div>
                        {(() => {
                          const parsed = parsePipeTable(item.tableText);
                          if (!parsed) {
                            return (
                              <pre className="mt-3 text-[12px] leading-relaxed text-slate-800 font-semibold whitespace-pre-wrap overflow-x-auto">
                                {item.tableText}
                              </pre>
                            );
                          }
                          return (
                            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-md">
                              <table className="min-w-full text-[12px] text-slate-800">
                                <thead className="bg-slate-900/90 text-white">
                                  <tr>
                                    {parsed.headers.map((h, idx) => (
                                      <th
                                        key={idx}
                                        scope="col"
                                        className="px-4 py-3 text-left font-black uppercase tracking-widest text-[10px] whitespace-nowrap"
                                      >
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {parsed.rows.map((row, rowIdx) => (
                                    <tr
                                      key={rowIdx}
                                      className={rowIdx % 2 === 0 ? 'bg-white/70' : 'bg-slate-50/80'}
                                    >
                                      {row.map((cell, cellIdx) => (
                                        <td
                                          key={cellIdx}
                                          className="px-4 py-3 align-top font-semibold text-slate-800 border-t border-slate-200/70 whitespace-normal break-words"
                                        >
                                          {cell}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {item.kind === 'mnemonic' && (
                      <div className="p-4 rounded-2xl border border-white/60 bg-white/50 backdrop-blur-md">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Mnemonic</div>
                        <div className="mt-2 text-sm font-semibold text-slate-800">{item.mnemonic}</div>
                      </div>
                    )}

                    {item.kind === 'session' && (
                      <div className="p-4 rounded-2xl border border-white/60 bg-white/50 backdrop-blur-md">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Session</div>
                        {item.questionPreview?.questionText && (
                          <div className="mt-2 text-[12px] text-slate-700 font-semibold">
                            <span className="font-black">Question preview:</span> {item.questionPreview.questionText.slice(0, 220)}
                            {item.questionPreview.questionText.length > 220 ? '…' : ''}
                          </div>
                        )}
                        <div className="mt-3 space-y-3">
                          {item.messages.slice(-6).map((m, idx) => (
                            <div key={idx} className="text-[12px] text-slate-700">
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                {m.role}
                              </div>
                              <div className="whitespace-pre-wrap font-semibold">{m.text}</div>
                            </div>
                          ))}
                          {item.messages.length > 6 && (
                            <div className="text-[11px] text-slate-500 font-semibold">
                              Showing last 6 messages (saved: {item.messages.length}).
                            </div>
                          )}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const body = item.messages.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n');
                              downloadText(body, `${item.title.replace(/\s+/g, '_')}.txt`);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                            TXT
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              downloadText(JSON.stringify(item, null, 2), `${item.title.replace(/\s+/g, '_')}.json`, 'application/json;charset=utf-8');
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/80 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest hover:bg-white"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                            JSON
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TutorVaultView;
