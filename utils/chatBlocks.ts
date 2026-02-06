export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] };

const isTableLine = (line: string) => {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  const pipeCount = (t.match(/\|/g) || []).length;
  return pipeCount >= 2;
};

const parseTableRow = (line: string) => {
  const t = line.trim();
  let parts = t.split('|');
  if (parts.length && parts[0].trim() === '') parts = parts.slice(1);
  if (parts.length && parts[parts.length - 1].trim() === '') parts = parts.slice(0, -1);
  return parts.map((p) => p.trim());
};

const isSeparatorRow = (cells: string[]) =>
  cells.length > 0 &&
  cells.every((cell) => {
    const normalized = cell.replace(/\s+/g, '').replace(/:/g, '');
    return normalized.length >= 3 && /^-+$/.test(normalized);
  });

const padRow = (row: string[], length: number) => {
  if (row.length === length) return row;
  if (row.length > length) return row.slice(0, length);
  return [...row, ...new Array(length - row.length).fill('')];
};

const parseTableBlock = (lines: string[]): ChatBlock => {
  const parsedRows = lines.map(parseTableRow).filter((row) => row.some((c) => c !== ''));
  const header = parsedRows[0] || [];
  const bodyStart = parsedRows.length > 1 && isSeparatorRow(parsedRows[1]) ? 2 : 1;
  const rows = parsedRows.slice(bodyStart);

  const colCount = Math.max(
    header.length,
    ...rows.map((r) => r.length),
    0
  );

  return {
    type: 'table',
    header: padRow(header, colCount),
    rows: rows.map((r) => padRow(r, colCount))
  };
};

export const parseChatBlocks = (text: string): ChatBlock[] => {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ChatBlock[] = [];

  let textBuf: string[] = [];
  let tableBuf: string[] = [];

  const flushText = () => {
    if (textBuf.length === 0) return;
    const joined = textBuf.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (joined.trim() !== '') blocks.push({ type: 'text', text: joined });
    textBuf = [];
  };

  const flushTable = () => {
    if (tableBuf.length === 0) return;
    blocks.push(parseTableBlock(tableBuf));
    tableBuf = [];
  };

  for (const line of lines) {
    if (isTableLine(line)) {
      flushText();
      tableBuf.push(line);
      continue;
    }

    if (tableBuf.length) flushTable();
    textBuf.push(line);
  }

  if (tableBuf.length) flushTable();
  if (textBuf.length) flushText();

  return blocks;
};

