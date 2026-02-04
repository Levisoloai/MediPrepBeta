export type BetaGuide = {
  id: 'heme' | 'pulm';
  title: string;
  description: string;
  pdfUrl: string;
};

export const betaGuides: BetaGuide[] = [
  {
    id: 'heme',
    title: 'Hematology',
    description: 'High-yield heme concepts for NBME-style practice.',
    pdfUrl: '/beta-guides/heme.pdf'
  },
  {
    id: 'pulm',
    title: 'Pulmonology',
    description: 'Core pulm topics with NBME-style vignettes.',
    pdfUrl: '/beta-guides/pulm.pdf'
  }
];
