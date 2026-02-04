import { HistologyEntry } from '../types';
import { generateHistologyVignettes, HistologyVignetteSeed } from './geminiService';

const CACHE_KEY = 'mediprep_histology_vignettes_v1';

const loadCache = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveCache = (cache: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failures
  }
};

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
  forceRefresh: boolean = false
): Promise<Record<string, string>> => {
  const cache = loadCache();
  const missing = forceRefresh
    ? entries
    : entries.filter((entry) => !cache[entry.id]);
  if (missing.length > 0) {
    const seeds: HistologyVignetteSeed[] = missing.map((entry) => ({
      id: entry.id,
      title: entry.title,
      keywords: entry.keywords,
      conceptTags: entry.conceptTags,
      caption: entry.caption
    }));
    try {
      const generated = await generateHistologyVignettes(seeds);
      missing.forEach((entry) => {
        cache[entry.id] = generated[entry.id] || buildFallbackVignette(entry);
      });
      saveCache(cache);
    } catch {
      missing.forEach((entry) => {
        cache[entry.id] = buildFallbackVignette(entry);
      });
      saveCache(cache);
    }
  }

  const result: Record<string, string> = {};
  entries.forEach((entry) => {
    result[entry.id] = cache[entry.id] || buildFallbackVignette(entry);
  });
  return result;
};
