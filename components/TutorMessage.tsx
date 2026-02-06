import React from 'react';
import { parseChatBlocks } from '../utils/chatBlocks';

type TutorMessageProps = {
  text: string;
  renderInline: (text: string) => React.ReactNode;
};

const renderTableCell = (content: React.ReactNode, key: string, isHeader: boolean) => {
  const base = isHeader
    ? 'px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white bg-slate-900 align-top border-r border-slate-800 last:border-r-0'
    : 'px-3 py-2 text-[12px] text-slate-700 align-top border-t border-slate-200 border-r border-slate-100 last:border-r-0 break-words';
  return <td key={key} className={base}>{content}</td>;
};

const TutorMessage: React.FC<TutorMessageProps> = ({ text, renderInline }) => {
  const blocks = parseChatBlocks(text);

  return (
    <div className="space-y-3">
      {blocks.map((block, idx) => {
        if (block.type === 'table') {
          const header = block.header || [];
          const rows = block.rows || [];

          return (
            <div key={`tbl-${idx}`} className="overflow-x-auto">
              <div className="min-w-[560px] border border-slate-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full border-collapse">
                  {header.length > 0 && (
                    <thead>
                      <tr>
                        {header.map((cell, cIdx) =>
                          renderTableCell(
                            <span className="whitespace-normal">{renderInline(cell)}</span>,
                            `h-${idx}-${cIdx}`,
                            true
                          )
                        )}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {rows.map((row, rIdx) => (
                      <tr key={`r-${idx}-${rIdx}`} className={rIdx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'}>
                        {row.map((cell, cIdx) =>
                          renderTableCell(
                            <span className="whitespace-normal">{renderInline(cell)}</span>,
                            `c-${idx}-${rIdx}-${cIdx}`,
                            false
                          )
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        return (
          <div key={`txt-${idx}`} className="whitespace-pre-wrap">
            {renderInline(block.text)}
          </div>
        );
      })}
    </div>
  );
};

export default TutorMessage;

