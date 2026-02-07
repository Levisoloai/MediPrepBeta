import type { TutorAnkiCard } from '../types';

const normalizeText = (raw: string) =>
  String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

const findSectionStart = (lines: string[], patterns: RegExp[]) => {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (patterns.some((re) => re.test(line))) return i;
  }
  return -1;
};

const collectUntilNextHeader = (lines: string[], startIdx: number) => {
  const out: string[] = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (
      i !== startIdx &&
      (trimmed.toLowerCase().startsWith('mnemonic:') ||
        trimmed.toLowerCase().startsWith('anki prompts:') ||
        trimmed.toLowerCase().startsWith('compare table:') ||
        trimmed.toLowerCase().startsWith('bottom line:') ||
        trimmed.toLowerCase().startsWith('key idea:'))
    ) {
      break;
    }
    out.push(line);
  }
  return out;
};

export const extractAnkiCardsFromTutorText = (raw: string): TutorAnkiCard[] => {
  const text = normalizeText(raw);
  const lines = text.split('\n');

  const start = findSectionStart(lines, [/^anki prompts\s*:/i]);
  const windowLines = start >= 0 ? lines.slice(start + 1) : lines;

  const cards: TutorAnkiCard[] = [];
  for (const line of windowLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Stop if we hit another major section.
    if (/^(mnemonic|compare table|bottom line|key idea)\s*:/i.test(trimmed)) break;

    // Expected format:
    // - Front: ... Back: ...
    const match = trimmed.match(/^\-?\s*front\s*:\s*(.+?)\s*back\s*:\s*(.+)\s*$/i);
    if (!match) continue;
    const front = String(match[1] ?? '').trim();
    const back = String(match[2] ?? '').trim();
    if (!front || !back) continue;
    cards.push({ front, back });
  }
  return cards;
};

export const extractMnemonicFromTutorText = (raw: string): string | null => {
  const text = normalizeText(raw);
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^mnemonic\s*:\s*(.+)\s*$/i);
    if (match) {
      const value = String(match[1] ?? '').trim();
      return value || null;
    }
  }
  return null;
};

export const extractCompareTableFromTutorText = (raw: string): string | null => {
  const text = normalizeText(raw);
  const lines = text.split('\n');

  const start = findSectionStart(lines, [/^compare table\s*:/i]);
  const scan = start >= 0 ? lines.slice(start + 1) : lines;

  const tableLines: string[] = [];
  for (const line of scan) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (tableLines.length > 0) break;
      continue;
    }
    if (/^(mnemonic|anki prompts|bottom line|key idea)\s*:/i.test(trimmed)) break;
    if (!trimmed.includes('|')) {
      if (tableLines.length > 0) break;
      continue;
    }
    tableLines.push(line);
  }

  if (tableLines.length < 2) return null;
  return tableLines.join('\n').trim();
};

export const extractStudyToolsFromTutorText = (raw: string) => {
  const table = extractCompareTableFromTutorText(raw);
  const mnemonic = extractMnemonicFromTutorText(raw);
  const cards = extractAnkiCardsFromTutorText(raw);
  return { table, mnemonic, cards };
};

