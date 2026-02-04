import { StudyGuideItem } from '../types';

export const normalizeText = (text: string) => text.trim().replace(/\s+/g, ' ');

export const hashText = async (text: string) => {
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef?.subtle) {
    throw new Error('Crypto API not available in this environment.');
  }
  const data = new TextEncoder().encode(text);
  const digest = await cryptoRef.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const isHeadingLine = (line: string) => {
  if (!line) return false;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^[A-Z0-9\s\-]{6,}$/.test(line) && line === line.toUpperCase()) return true;
  if (/^([A-Z][a-z0-9]+)(\s+[A-Z][a-z0-9]+){0,5}:$/.test(line)) return true;
  if (/^(\d+|[A-Z])[)\.]\s+/.test(line)) return true;
  return false;
};

const isBulletLine = (line: string) => /^[-*•]\s+/.test(line);

const cleanLine = (line: string) => line.replace(/^[-*•]\s+/, '').replace(/^#{1,6}\s+/, '').trim();

export const parseStudyGuideItems = (text: string): Array<{ title: string; content: string }> => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const markerCount = lines.filter((line) => isHeadingLine(line) || isBulletLine(line)).length;
  if (markerCount < 3) {
    return [{ title: 'Study Guide', content: text.trim() }];
  }

  const items: Array<{ title: string; contentLines: string[] }> = [];
  let current: { title: string; contentLines: string[] } | null = null;

  lines.forEach((line) => {
    if (isHeadingLine(line)) {
      if (current) items.push(current);
      current = { title: cleanLine(line).replace(/:$/, ''), contentLines: [] };
      return;
    }
    if (isBulletLine(line)) {
      if (current) items.push(current);
      const cleaned = cleanLine(line);
      current = { title: cleaned.split(' ').slice(0, 6).join(' '), contentLines: [cleaned] };
      return;
    }
    if (!current) {
      current = { title: 'Study Guide Item', contentLines: [line] };
    } else {
      current.contentLines.push(line);
    }
  });

  if (current) items.push(current);

  return items
    .map((item) => ({
      title: item.title || 'Study Guide Item',
      content: item.contentLines.join(' ').trim()
    }))
    .filter((item) => item.content.length > 0);
};

export const buildStudyGuideItems = async (text: string) => {
  const normalizedText = normalizeText(text);
  const guideHash = await hashText(normalizedText);
  const rawItems = parseStudyGuideItems(text);
  const guideItems: StudyGuideItem[] = await Promise.all(
    rawItems.map(async (item, idx) => ({
      id: `item-${idx + 1}`,
      title: item.title,
      content: item.content,
      contentHash: await hashText(normalizeText(item.content))
    }))
  );

  return { guideHash, guideItems };
};
