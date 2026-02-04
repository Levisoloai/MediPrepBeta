import { HistologyEntry } from '../types';

const buildFallbackVignette = (entry: HistologyEntry) => {
  const caption = entry.caption?.trim();
  if (caption) {
    return caption;
  }
  const tags = entry.conceptTags?.length ? entry.conceptTags.slice(0, 2).join(', ') : entry.keywords.slice(0, 2).join(', ');
  return tags ? `Clinical vignette suggests ${tags}.` : `Clinical vignette suggests ${entry.title}.`;
};

export const getHistologyVignettes = async (
  entries: HistologyEntry[],
  _forceRefresh: boolean = false
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  entries.forEach((entry) => {
    result[entry.id] = entry.vignette?.trim() || buildFallbackVignette(entry);
  });
  return result;
};
