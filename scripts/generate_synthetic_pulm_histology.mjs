import fs from 'fs';
import path from 'path';

const outDir = path.resolve('public/histology/pulm/synthetic');
fs.mkdirSync(outDir, { recursive: true });

const concepts = [
  { concept: 'COPD', tags: ['COPD', 'chronic obstructive pulmonary disease', 'emphysema', 'chronic bronchitis'] },
  { concept: 'Asthma', tags: ['asthma', 'bronchial asthma'] },
  { concept: 'Lung Cancer', tags: ['lung cancer', 'bronchogenic carcinoma'] },
  { concept: 'Lung Cancer Treatment', tags: ['lung cancer treatment', 'oncology'] },
  { concept: 'Tobacco Cessation', tags: ['tobacco cessation', 'smoking'] },
  { concept: 'Pediatric Lung Diseases', tags: ['pediatric lung disease', 'pediatrics'] },
  { concept: 'Obstructive Sleep Apnea', tags: ['obstructive sleep apnea', 'OSA'] },
  { concept: 'Sarcoidosis', tags: ['sarcoidosis', 'noncaseating granulomas'] },
  { concept: 'Lung Injury & Interstitial Lung Disease Pathology', tags: ['interstitial lung disease', 'ILD', 'lung injury'] },
  { concept: 'Interstitial Lung Disease', tags: ['interstitial lung disease', 'ILD', 'pulmonary fibrosis'] },
  { concept: 'Pulmonary Embolism', tags: ['pulmonary embolism', 'PE'] },
  { concept: 'ARDS', tags: ['ARDS', 'acute respiratory distress syndrome'] },
  { concept: 'Obstructive vs Restrictive PFTs', tags: ['obstructive', 'restrictive', 'PFT', 'pulmonary function tests'] },
  { concept: 'COPD 1', tags: ['COPD', 'chronic obstructive pulmonary disease'] },
  { concept: 'COPD 2', tags: ['COPD', 'chronic obstructive pulmonary disease'] },
  { concept: 'Asthma 1', tags: ['asthma'] },
  { concept: 'Asthma 2', tags: ['asthma'] },
  { concept: 'Lung Cancer 1', tags: ['lung cancer'] },
  { concept: 'Lung Cancer 2', tags: ['lung cancer'] }
];

const countPerConcept = 2;

const palettes = [
  { bg: '#f8e6e6', cell: '#f2c9d1', nucleus: '#6b4fa1', accent: '#bb7ca4' },
  { bg: '#f5ebe0', cell: '#f1d4c2', nucleus: '#5f4b8b', accent: '#c17c74' },
  { bg: '#f1eaf7', cell: '#d8c1f0', nucleus: '#4f3d8b', accent: '#c39bd3' },
  { bg: '#f7f0e8', cell: '#f0d2c0', nucleus: '#6f4c8b', accent: '#c889a0' }
];

const slugify = (text) => text
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$|/g, '');

const hashString = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const createRng = (seed) => {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
};

const renderSvg = (seed, palette) => {
  const rng = createRng(seed);
  const width = 900;
  const height = 600;
  const cells = 120 + Math.floor(rng() * 60);
  const nucleusCount = 70 + Math.floor(rng() * 40);

  const shapes = [];
  shapes.push(`<rect width="100%" height="100%" fill="${palette.bg}" />`);

  for (let i = 0; i < cells; i += 1) {
    const cx = Math.floor(rng() * width);
    const cy = Math.floor(rng() * height);
    const r = 8 + Math.floor(rng() * 22);
    const opacity = 0.35 + rng() * 0.25;
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.cell}" opacity="${opacity.toFixed(2)}" />`);
  }

  for (let i = 0; i < nucleusCount; i += 1) {
    const cx = Math.floor(rng() * width);
    const cy = Math.floor(rng() * height);
    const r = 3 + Math.floor(rng() * 9);
    const opacity = 0.55 + rng() * 0.35;
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.nucleus}" opacity="${opacity.toFixed(2)}" />`);
  }

  for (let i = 0; i < 30; i += 1) {
    const x1 = Math.floor(rng() * width);
    const y1 = Math.floor(rng() * height);
    const x2 = x1 + Math.floor(rng() * 120) - 60;
    const y2 = y1 + Math.floor(rng() * 120) - 60;
    const strokeWidth = 1 + rng() * 2.5;
    shapes.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${palette.accent}" stroke-width="${strokeWidth.toFixed(2)}" opacity="0.2" />`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    shapes.join('\n') +
    '\n</svg>';
};

const keywordize = (tags) => {
  const tokens = [];
  tags.forEach((tag) => {
    tag.toLowerCase().split(/[^a-z0-9]+/g).forEach((token) => {
      if (token.length >= 3 && !tokens.includes(token)) tokens.push(token);
    });
  });
  return tokens;
};

const entries = [];

concepts.forEach((item, index) => {
  const slug = slugify(item.concept) || `concept-${index}`;
  for (let i = 1; i <= countPerConcept; i += 1) {
    const seed = hashString(`${item.concept}-${i}`);
    const palette = palettes[(seed + i) % palettes.length];
    const svg = renderSvg(seed, palette);
    const filename = `${slug}-${i}.svg`;
    const imagePath = path.join(outDir, filename);
    fs.writeFileSync(imagePath, svg);

    entries.push({
      id: `pulm-synth-${slug}-${i}`,
      module: 'pulm',
      title: `${item.concept} (synthetic)` ,
      caption: '',
      keywords: keywordize(item.tags),
      conceptTags: item.tags,
      imageUrl: `/histology/pulm/synthetic/${filename}`,
      source: 'Synthetic (beta)'
    });
  }
});

// Merge into histologyBank
const bankPath = path.resolve('utils/histologyBank.ts');
let existing = [];
if (fs.existsSync(bankPath)) {
  const raw = fs.readFileSync(bankPath, 'utf8');
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      existing = JSON.parse(match[0]);
    } catch (e) {
      existing = [];
    }
  }
}

const existingIds = new Set(existing.map((e) => e.id));
const merged = existing.concat(entries.filter((e) => !existingIds.has(e.id)));
fs.writeFileSync(
  bankPath,
  `import { HistologyEntry } from '../types';\n\nexport const histologyBank: HistologyEntry[] = ${JSON.stringify(merged, null, 2)};\n`
);

console.log('Generated synthetic pulmonology histology images:', entries.length);
console.log('Updated histology bank size:', merged.length);
