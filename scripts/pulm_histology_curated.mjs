import fs from 'fs';
import path from 'path';

const curatedPulm = [
  {
    id: 'pulm-goblet-cell-hyperplasia',
    title: 'Bronchial goblet cell hyperplasia',
    caption: 'Bronchial goblet cell hyperplasia.',
    conceptTags: ['chronic bronchitis', 'goblet cell hyperplasia', 'COPD'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/bf/Bronchial_goblet_cell_hyperplasia.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Bronchial_goblet_cell_hyperplasia.jpg',
    license: 'CC BY-SA 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
    attribution: 'Yale Rosen',
    filename: 'bronchial_goblet_cell_hyperplasia.jpg'
  },
  {
    id: 'pulm-charcot-leyden-crystal',
    title: 'Charcot-Leyden crystal (Asthma)',
    caption: 'Charcot-Leyden crystal in airway (asthma).',
    conceptTags: ['asthma', 'Charcot-Leyden crystals', 'eosinophils'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/Charcot-Leyden_crystal_-_Asthma.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Charcot-Leyden_crystal_-_Asthma.jpg',
    license: 'CC BY-SA 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
    attribution: 'Yale Rosen',
    filename: 'charcot_leyden_crystal_asthma.jpg'
  },
  {
    id: 'pulm-emphysema-low-mag',
    title: 'Emphysema (low magnification)',
    caption: 'Low magnification H&E micrograph of emphysema with enlarged airspaces.',
    conceptTags: ['emphysema', 'COPD', 'hyperinflation'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/66/Emphysema_low_mag.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Emphysema_low_mag.jpg',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Nephron',
    filename: 'emphysema_low_mag.jpg'
  },
  {
    id: 'pulm-sarcoidosis-granuloma',
    title: 'Sarcoidosis (non-necrotizing granuloma)',
    caption: 'Non-necrotizing granuloma in sarcoidosis.',
    conceptTags: ['sarcoidosis', 'noncaseating granuloma', 'granuloma'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/9c/Sarcoidosis_-_Non-necrotizing_granuloma_%286201646890%29.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sarcoidosis_-_Non-necrotizing_granuloma_(6201646890).jpg',
    license: 'CC BY-SA 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
    attribution: 'Yale Rosen',
    filename: 'sarcoidosis_non_necrotizing_granuloma.jpg'
  },
  {
    id: 'pulm-uip-honeycomb-fibrosis',
    title: 'Usual interstitial pneumonia (honeycomb fibrosis)',
    caption: 'Honeycomb fibrosis in UIP (IPF).',
    conceptTags: ['interstitial lung disease', 'usual interstitial pneumonia', 'IPF', 'honeycombing', 'pulmonary fibrosis'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/87/UIP_%28Usual_interstitial_pneumonia%29-Honeycomb_fibrosis_2.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:UIP_(Usual_interstitial_pneumonia)-Honeycomb_fibrosis_2.jpg',
    license: 'CC BY-SA 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
    attribution: 'Yale Rosen',
    filename: 'uip_honeycomb_fibrosis.jpg'
  },
  {
    id: 'pulm-adenocarcinoma-histopathology',
    title: 'Lung adenocarcinoma (acinar pattern)',
    caption: 'Histopathology of lung adenocarcinoma with acinar pattern, H&E stain.',
    conceptTags: ['lung adenocarcinoma', 'adenocarcinoma', 'lung cancer'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Histopathology_of_lung_adenocarcinoma_with_acinar_pattern.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Histopathology_of_lung_adenocarcinoma_with_acinar_pattern.png',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Chen CL et al. (Nat Commun 2021)',
    filename: 'lung_adenocarcinoma_acinar.png'
  },
  {
    id: 'pulm-squamous-cell-carcinoma',
    title: 'Squamous cell carcinoma of lung',
    caption: 'Micrograph showing keratin pearls in squamous cell carcinoma.',
    conceptTags: ['squamous cell carcinoma', 'lung cancer', 'keratin pearls'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a6/Squamous_Cell_Carcinoma_Lung_40x.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Squamous_Cell_Carcinoma_Lung_40x.jpg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'Calicut Medical College',
    filename: 'squamous_cell_carcinoma_lung.jpg'
  },
  {
    id: 'pulm-small-cell-carcinoma',
    title: 'Small cell carcinoma of lung',
    caption: 'Histopathologic image of small cell carcinoma (H&E).',
    conceptTags: ['small cell carcinoma', 'lung cancer'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/54/Lung_small_cell_carcinoma_%281%29_by_core_needle_biopsy.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lung_small_cell_carcinoma_(1)_by_core_needle_biopsy.jpg',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'KGH',
    filename: 'small_cell_carcinoma_lung.jpg'
  },
  {
    id: 'pulm-pe-ctpa',
    title: 'Pulmonary embolism (CT pulmonary angiography)',
    caption: 'CTPA showing saddle embolus and thrombus burden.',
    conceptTags: ['pulmonary embolism', 'PE'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/4d/Pulmonary_embolism_CTPA.JPEG',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Pulmonary_embolism_CTPA.JPEG',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    attribution: 'Aung Myat & Arif Ahsan',
    filename: 'pulmonary_embolism_ctpa.jpg'
  },
  {
    id: 'pulm-copd-cxr',
    title: 'COPD chest X-ray',
    caption: 'Chest X-ray showing severe COPD with hyperinflation.',
    conceptTags: ['COPD', 'hyperinflation', 'emphysema'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/0b/COPD.JPG',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:COPD.JPG',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'James Heilman, MD',
    filename: 'copd_chest_xray.jpg'
  },
  {
    id: 'pulm-copd-exacerbation-cxr',
    title: 'COPD exacerbation chest X-ray',
    caption: 'Chest X-ray of acute COPD exacerbation.',
    conceptTags: ['COPD exacerbation', 'COPD'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/36/X-ray_of_COPD_exacerbation_-_anteroposterior_view.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:X-ray_of_COPD_exacerbation_-_anteroposterior_view.jpg',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Mikael Häggström, MD',
    filename: 'copd_exacerbation_xray.jpg'
  },
  {
    id: 'pulm-ards-cxr',
    title: 'ARDS chest X-ray',
    caption: 'Chest X-ray of acute respiratory distress syndrome.',
    conceptTags: ['ARDS', 'acute respiratory distress syndrome'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/ARDS_X-Ray.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:ARDS_X-Ray.jpg',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Samir',
    filename: 'ards_xray.jpg'
  },
  {
    id: 'pulm-bronchiolitis-cxr',
    title: 'Bronchiolitis chest X-ray',
    caption: 'Chest radiograph showing hyperinflation in infant bronchiolitis.',
    conceptTags: ['bronchiolitis', 'pediatric lung disease', 'RSV'],
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/11/Bronchiolitis_chest_X-ray.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Bronchiolitis_chest_X-ray.jpg',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    attribution: 'Matteo Di Nardo et al.',
    filename: 'bronchiolitis_chest_xray.jpg'
  }
];

const curatedHeme = [
  {
    id: 'heme-auer-rods-aml',
    title: 'Auer rods in AML',
    caption: 'Myeloblasts with Auer rods (AML).',
    conceptTags: ['Auer rods', 'APL', 'acute promyelocytic leukemia', 'AML'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Myeloblast_with_Auer_rod_smear_2010-01-27.JPG',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Paulo Henrique Orlandi Mourao',
    filename: 'auer_rods_aml.jpg'
  },
  {
    id: 'heme-smudge-cells-cll',
    title: 'Smudge cells (CLL)',
    caption: 'Smudge cells in peripheral blood smear (CLL).',
    conceptTags: ['smudge cells', 'CLL', 'chronic lymphocytic leukemia'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Smudge_cell_in_a_peripheral_blood_smear.jpg',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Mikael Häggström',
    filename: 'smudge_cells_cll.jpg'
  },
  {
    id: 'heme-sickle-cells',
    title: 'Sickle cell blood smear',
    caption: 'Blood smear showing sickle cells and target cells.',
    conceptTags: ['sickle cell', 'drepanocytes', 'sickle cell disease'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sickle_Cell_Blood_Smear.JPG',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Keith Chambers',
    filename: 'sickle_cell_blood_smear.jpg'
  },
  {
    id: 'heme-spherocyte',
    title: 'Spherocyte',
    caption: 'Micrograph of a spherocyte.',
    conceptTags: ['spherocyte', 'hereditary spherocytosis', 'warm autoimmune hemolytic anemia'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Micrograph_of_a_spherocyte.jpg',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Mikael Häggström',
    filename: 'spherocyte_micrograph.jpg'
  },
  {
    id: 'heme-schistocytes',
    title: 'Schistocytes',
    caption: 'Schistocytes (fragmented red cells).',
    conceptTags: ['schistocytes', 'MAHA', 'TTP', 'DIC', 'hemolytic uremic syndrome'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Schistocytes.jpg',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Prof. Osaro Erhabor',
    filename: 'schistocytes.jpg'
  },
  {
    id: 'heme-target-cells',
    title: 'Target cells',
    caption: 'Target cells (codocytes) on peripheral smear.',
    conceptTags: ['target cells', 'thalassemia', 'liver disease', 'sickle cell'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Target_Cells,_Peripheral_Blood_Smear_(39144139915).jpg',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    attribution: 'Ed Uthman',
    filename: 'target_cells_peripheral_smear.jpg'
  },
  {
    id: 'heme-howell-jolly',
    title: 'Howell-Jolly bodies',
    caption: 'Howell-Jolly bodies in erythrocytes.',
    conceptTags: ['Howell-Jolly bodies', 'asplenia', 'splenectomy', 'sickle cell'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Howell-Jolly_smear_2010-11-17.JPG',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Paulo Henrique Orlandi Mourao',
    filename: 'howell_jolly_smear.jpg'
  },
  {
    id: 'heme-basophilic-stippling',
    title: 'Basophilic stippling',
    caption: 'Micrograph showing basophilic stippling.',
    conceptTags: ['basophilic stippling', 'lead poisoning', 'thalassemia', 'sideroblastic anemia'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Micrograph_of_a_red_blood_cell_with_basophilic_stippling.jpg',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Mikael Häggström',
    filename: 'basophilic_stippling.jpg'
  },
  {
    id: 'heme-hypersegmented-neutrophil',
    title: 'Hypersegmented neutrophil',
    caption: 'Hypersegmented neutrophil on peripheral smear.',
    conceptTags: ['hypersegmented neutrophil', 'megaloblastic anemia', 'B12 deficiency', 'folate deficiency'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hypersegmented_neutrophil.jpg',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    attribution: 'Ed Uthman',
    filename: 'hypersegmented_neutrophil.jpg'
  },
  {
    id: 'heme-rouleaux',
    title: 'Rouleaux formation',
    caption: 'Rouleaux formation in peripheral blood smear.',
    conceptTags: ['rouleaux', 'multiple myeloma', 'Waldenstrom macroglobulinemia'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Rouleaux_formation.jpg',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    attribution: 'Michail Charakidis, David Joseph Russell',
    filename: 'rouleaux_formation.jpg'
  },
  {
    id: 'heme-reed-sternberg',
    title: 'Reed-Sternberg cell',
    caption: 'Reed-Sternberg cell in Hodgkin lymphoma.',
    conceptTags: ['Reed-Sternberg', 'Hodgkin lymphoma'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Reed-sternberg_cell.jpg',
    license: 'Public domain (US NIH)',
    licenseUrl: 'https://commons.wikimedia.org/wiki/File:Reed-sternberg_cell.jpg',
    attribution: 'National Cancer Institute',
    filename: 'reed_sternberg_cell.jpg'
  },
  {
    id: 'heme-hairy-cell-leukemia',
    title: 'Hairy cell leukemia smear',
    caption: 'Hairy cell leukemia on peripheral blood smear.',
    conceptTags: ['hairy cell leukemia', 'TRAP', 'BRAF V600E'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hairy_cell_leukemia_smear_2009-08-20.JPG',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'Paulo Henrique Orlandi Mourao',
    filename: 'hairy_cell_leukemia_smear.jpg'
  },
  {
    id: 'heme-teardrop-cells',
    title: 'Teardrop cells (dacrocytes)',
    caption: 'Micrograph of a teardrop cell (dacrocyte).',
    conceptTags: ['teardrop cells', 'dacrocytes', 'myelofibrosis'],
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Micrograph_of_a_tear_drop_cell_(dacrocyte).jpg',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Mikael Häggström',
    filename: 'teardrop_cell.jpg'
  }
];

const outDirPulm = path.resolve('public/histology/pulm/curated');
const outDirHeme = path.resolve('public/histology/heme/curated');
fs.mkdirSync(outDirPulm, { recursive: true });
fs.mkdirSync(outDirHeme, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const download = async (url, dest) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(dest, Buffer.from(arrayBuffer));
      return;
    }
    lastError = new Error(`Failed to download ${url}: ${res.status}`);
    if (res.status === 429 && attempt < 5) {
      await sleep(2000 * attempt);
      continue;
    }
    break;
  }
  throw lastError;
};

const buildDownloadUrl = (sourceUrl) => {
  const marker = 'File:';
  const idx = sourceUrl.indexOf(marker);
  if (idx === -1) return sourceUrl;
  const fileName = sourceUrl.slice(idx + marker.length);
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
};

for (const item of curatedPulm) {
  const dest = path.join(outDirPulm, item.filename);
  if (!fs.existsSync(dest)) {
    const downloadUrl = buildDownloadUrl(item.sourceUrl);
    await download(downloadUrl, dest);
    await sleep(1200);
  }
}

for (const item of curatedHeme) {
  const dest = path.join(outDirHeme, item.filename);
  if (!fs.existsSync(dest)) {
    const downloadUrl = buildDownloadUrl(item.sourceUrl);
    await download(downloadUrl, dest);
    await sleep(1200);
  }
}

const curatedPulmEntries = curatedPulm.map((item) => ({
  id: item.id,
  module: 'pulm',
  title: item.title,
  caption: item.caption,
  keywords: Array.from(new Set(item.conceptTags.map((tag) => tag.toLowerCase()).flatMap((tag) => tag.split(/[^a-z0-9]+/g)).filter((t) => t.length >= 3))),
  conceptTags: item.conceptTags,
  imageUrl: `/histology/pulm/curated/${item.filename}`,
  source: 'Wikimedia Commons',
  sourceUrl: item.sourceUrl,
  license: item.license,
  licenseUrl: item.licenseUrl,
  attribution: item.attribution
}));

const curatedHemeEntries = curatedHeme.map((item) => ({
  id: item.id,
  module: 'heme',
  title: item.title,
  caption: item.caption,
  keywords: Array.from(new Set(item.conceptTags.map((tag) => tag.toLowerCase()).flatMap((tag) => tag.split(/[^a-z0-9]+/g)).filter((t) => t.length >= 3))),
  conceptTags: item.conceptTags,
  imageUrl: `/histology/heme/curated/${item.filename}`,
  source: 'Wikimedia Commons',
  sourceUrl: item.sourceUrl,
  license: item.license,
  licenseUrl: item.licenseUrl,
  attribution: item.attribution
}));

const merged = [];
const seen = new Set();
for (const entry of [...curatedHemeEntries, ...curatedPulmEntries]) {
  if (seen.has(entry.id)) continue;
  seen.add(entry.id);
  merged.push(entry);
}

const bankPath = path.resolve('utils/histologyBank.ts');
fs.writeFileSync(
  bankPath,
  `import { HistologyEntry } from '../types';\n\nexport const histologyBank: HistologyEntry[] = ${JSON.stringify(merged, null, 2)};\n`
);

console.log('Downloaded curated pulmonology images:', curatedPulmEntries.length);
console.log('Downloaded curated hematology images:', curatedHemeEntries.length);
console.log('Histology bank size:', merged.length);
