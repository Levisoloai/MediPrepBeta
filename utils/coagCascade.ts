export type CoagPathway = 'intrinsic' | 'extrinsic' | 'common' | 'regulator';
export type CoagRole = 'enzyme' | 'cofactor' | 'substrate' | 'inhibitor';
export type CoagTest = 'pt' | 'ptt' | 'both' | 'neither';

export type CoagNode = {
  id: string;
  label: string;
  name: string;
  alias?: string;
  pathways: CoagPathway[];
  role: CoagRole;
  vitKDependent?: boolean;
  tests: CoagTest;
  activates?: string[];
  drugTargets?: string[];
  mnemonic?: string;
  clinicalNotes?: string[];
};

export type CoagEdge = {
  from: string;
  to: string;
  label?: string;
};

export type CoagHighlightPresetId =
  | 'pt'
  | 'ptt'
  | 'vitk'
  | 'heparin'
  | 'warfarin'
  | 'doacs'
  | 'none';

export type CoagHighlightPreset = {
  id: CoagHighlightPresetId;
  label: string;
  nodeIds: string[];
};

export type CoagDrillCardType = 'pathway' | 'sequence' | 'lab' | 'drug' | 'vitk' | 'clinical';

export type CoagDrillCard = {
  id: string;
  type: CoagDrillCardType;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  highlights: string[];
  tags: string[];
};

export const COAG_NODES: CoagNode[] = [
  {
    id: 'TF',
    label: 'TF',
    name: 'Tissue factor (Factor III)',
    pathways: ['extrinsic'],
    role: 'substrate',
    tests: 'pt',
    activates: ['VII'],
    mnemonic: 'TF starts the PT test (extrinsic).',
    clinicalNotes: ['Released with tissue injury; initiates extrinsic pathway.']
  },
  {
    id: 'VII',
    label: 'VII',
    name: 'Factor VII',
    pathways: ['extrinsic'],
    role: 'enzyme',
    vitKDependent: true,
    tests: 'pt',
    activates: ['X', 'IX'],
    drugTargets: ['Warfarin (via vitamin K)'],
    mnemonic: 'Seven is for the Street (outside the vessel) = extrinsic.',
    clinicalNotes: [
      'Isolated PT elevation suggests Factor VII issue or early warfarin/vitamin K deficiency.'
    ]
  },
  {
    id: 'XII',
    label: 'XII',
    name: 'Factor XII (Hageman factor)',
    pathways: ['intrinsic'],
    role: 'enzyme',
    tests: 'ptt',
    activates: ['XI'],
    mnemonic: 'Twelve is contact activation (intrinsic).',
    clinicalNotes: ['Deficiency can prolong aPTT but typically does not cause bleeding.']
  },
  {
    id: 'XI',
    label: 'XI',
    name: 'Factor XI',
    pathways: ['intrinsic'],
    role: 'enzyme',
    tests: 'ptt',
    activates: ['IX'],
    mnemonic: '11 activates 9 (intrinsic chain).',
    clinicalNotes: ['Deficiency can cause bleeding; aPTT prolonged.']
  },
  {
    id: 'IX',
    label: 'IX',
    name: 'Factor IX (Christmas factor)',
    pathways: ['intrinsic'],
    role: 'enzyme',
    vitKDependent: true,
    tests: 'ptt',
    activates: ['X'],
    drugTargets: ['Warfarin (via vitamin K)'],
    mnemonic: 'Hemophilia B = factor 9.',
    clinicalNotes: ['Hemophilia B: Factor IX deficiency; aPTT prolonged, PT normal.']
  },
  {
    id: 'VIII',
    label: 'VIII',
    name: 'Factor VIII',
    pathways: ['intrinsic'],
    role: 'cofactor',
    tests: 'ptt',
    activates: ['X'],
    mnemonic: 'Hemophilia A = factor 8.',
    clinicalNotes: ['Hemophilia A: Factor VIII deficiency; aPTT prolonged, PT normal.']
  },
  {
    id: 'X',
    label: 'X',
    name: 'Factor X (Stuart-Prower factor)',
    pathways: ['common'],
    role: 'enzyme',
    vitKDependent: true,
    tests: 'both',
    activates: ['II'],
    drugTargets: ['Factor Xa inhibitors (apixaban, rivaroxaban, edoxaban)', 'Heparin (via ATIII)'],
    mnemonic: 'X marks the common path.',
    clinicalNotes: ['Common pathway factor; affects both PT and aPTT.']
  },
  {
    id: 'V',
    label: 'V',
    name: 'Factor V',
    pathways: ['common'],
    role: 'cofactor',
    tests: 'both',
    activates: ['II'],
    mnemonic: 'V helps X make thrombin.',
    clinicalNotes: ['Factor V Leiden is a prothrombotic mutation (APC resistance).']
  },
  {
    id: 'II',
    label: 'II',
    name: 'Factor II (Prothrombin)',
    pathways: ['common'],
    role: 'substrate',
    vitKDependent: true,
    tests: 'both',
    activates: ['I'],
    drugTargets: ['Direct thrombin inhibitor (dabigatran)', 'Heparin (via ATIII)', 'Warfarin (via vitamin K)'],
    mnemonic: 'Prothrombin -> thrombin is the key switch.',
    clinicalNotes: ['Common pathway; affects both PT and aPTT.']
  },
  {
    id: 'I',
    label: 'I',
    name: 'Factor I (Fibrinogen)',
    pathways: ['common'],
    role: 'substrate',
    tests: 'both',
    mnemonic: 'Fibrinogen becomes fibrin (the final mesh).',
    clinicalNotes: ['Low fibrinogen suggests DIC or severe liver disease.']
  },
  {
    id: 'ATIII',
    label: 'ATIII',
    name: 'Antithrombin (ATIII)',
    pathways: ['regulator'],
    role: 'inhibitor',
    tests: 'neither',
    drugTargets: ['Heparin potentiates ATIII'],
    mnemonic: 'Heparin works by boosting ATIII.',
    clinicalNotes: ['Inhibits thrombin (IIa) and factor Xa (and others).']
  },
  {
    id: 'ProteinC',
    label: 'Protein C',
    name: 'Protein C',
    pathways: ['regulator'],
    role: 'inhibitor',
    vitKDependent: true,
    tests: 'neither',
    mnemonic: 'Protein C clips Factors V and VIII (with Protein S).',
    clinicalNotes: ['Warfarin can cause early Protein C drop -> skin necrosis risk.']
  },
  {
    id: 'ProteinS',
    label: 'Protein S',
    name: 'Protein S',
    pathways: ['regulator'],
    role: 'cofactor',
    vitKDependent: true,
    tests: 'neither',
    mnemonic: 'Protein S supports Protein C.',
    clinicalNotes: ['Deficiency increases thrombosis risk.']
  }
];

export const COAG_EDGES: CoagEdge[] = [
  { from: 'TF', to: 'VII', label: 'binds/activates' },
  { from: 'VII', to: 'X', label: 'activates' },
  { from: 'XII', to: 'XI', label: 'activates' },
  { from: 'XI', to: 'IX', label: 'activates' },
  { from: 'IX', to: 'X', label: 'activates (+VIII)' },
  { from: 'X', to: 'II', label: 'activates (+V)' },
  { from: 'II', to: 'I', label: 'cleaves' }
];

export const HIGHLIGHT_PRESETS: Record<CoagHighlightPresetId, CoagHighlightPreset> = {
  none: { id: 'none', label: 'None', nodeIds: [] },
  pt: { id: 'pt', label: 'PT/INR', nodeIds: ['TF', 'VII', 'X', 'V', 'II', 'I'] },
  ptt: { id: 'ptt', label: 'aPTT', nodeIds: ['XII', 'XI', 'IX', 'VIII', 'X', 'V', 'II', 'I'] },
  vitk: { id: 'vitk', label: 'Vitamin K', nodeIds: ['II', 'VII', 'IX', 'X', 'ProteinC', 'ProteinS'] },
  heparin: { id: 'heparin', label: 'Heparin/ATIII', nodeIds: ['ATIII', 'X', 'II'] },
  warfarin: { id: 'warfarin', label: 'Warfarin', nodeIds: ['II', 'VII', 'IX', 'X', 'ProteinC', 'ProteinS'] },
  doacs: { id: 'doacs', label: 'DOACs', nodeIds: ['X', 'II'] }
};

export const COAG_DRILL_CARDS: CoagDrillCard[] = [
  {
    id: 'lab-pt-factor7',
    type: 'lab',
    prompt: 'Isolated PT elevation (normal aPTT) most strongly points to a problem with which factor?',
    choices: ['Factor VII', 'Factor VIII', 'Factor IX', 'Factor XII'],
    correctIndex: 0,
    explanation: 'Factor VII is the key extrinsic pathway factor measured by PT/INR.',
    highlights: ['VII', 'TF'],
    tags: ['lab', 'pt']
  },
  {
    id: 'lab-ptt-intrinsic',
    type: 'lab',
    prompt: 'Which factor is in the intrinsic pathway and classically prolongs aPTT when deficient?',
    choices: ['Factor VII', 'Factor VIII', 'Tissue factor', 'Protein S'],
    correctIndex: 1,
    explanation: 'Factor VIII is an intrinsic pathway cofactor; deficiency (Hemophilia A) prolongs aPTT.',
    highlights: ['VIII', 'IX', 'XI', 'XII'],
    tags: ['lab', 'ptt']
  },
  {
    id: 'clinical-hemoa',
    type: 'clinical',
    prompt: 'Hemophilia A is due to deficiency of:',
    choices: ['Factor VIII', 'Factor IX', 'Factor VII', 'Factor V'],
    correctIndex: 0,
    explanation: 'Hemophilia A is Factor VIII deficiency (intrinsic) leading to prolonged aPTT.',
    highlights: ['VIII'],
    tags: ['clinical', 'hemophilia']
  },
  {
    id: 'clinical-hemob',
    type: 'clinical',
    prompt: 'Hemophilia B is due to deficiency of:',
    choices: ['Factor VIII', 'Factor IX', 'Factor XI', 'Factor X'],
    correctIndex: 1,
    explanation: 'Hemophilia B is Factor IX deficiency (intrinsic) leading to prolonged aPTT.',
    highlights: ['IX'],
    tags: ['clinical', 'hemophilia']
  },
  {
    id: 'drug-heparin',
    type: 'drug',
    prompt: 'Heparin anticoagulation works primarily by potentiating:',
    choices: ['Protein C', 'Antithrombin (ATIII)', 'Vitamin K epoxide reductase', 'Tissue factor'],
    correctIndex: 1,
    explanation: 'Heparin increases ATIII activity which inhibits thrombin (IIa) and factor Xa.',
    highlights: ['ATIII', 'X', 'II'],
    tags: ['drug']
  },
  {
    id: 'drug-warfarin',
    type: 'drug',
    prompt: 'Warfarin decreases activation of which group of proteins?',
    choices: ['II, VII, IX, X and Protein C/S', 'VIII and vWF', 'XII and XI', 'I and V'],
    correctIndex: 0,
    explanation: 'Warfarin inhibits vitamin K recycling, reducing gamma-carboxylation of II, VII, IX, X and Protein C/S.',
    highlights: ['II', 'VII', 'IX', 'X', 'ProteinC', 'ProteinS'],
    tags: ['drug', 'vitk']
  },
  {
    id: 'drug-doac-xa',
    type: 'drug',
    prompt: 'Which target is most directly inhibited by apixaban/rivaroxaban?',
    choices: ['Factor Xa', 'Factor IIa (thrombin)', 'Factor VIIa', 'Protein S'],
    correctIndex: 0,
    explanation: 'Apixaban and rivaroxaban are direct factor Xa inhibitors.',
    highlights: ['X'],
    tags: ['drug']
  },
  {
    id: 'drug-doac-iia',
    type: 'drug',
    prompt: 'Dabigatran most directly inhibits:',
    choices: ['Factor Xa', 'Factor IIa (thrombin)', 'Factor IXa', 'Factor XIIa'],
    correctIndex: 1,
    explanation: 'Dabigatran is a direct thrombin (IIa) inhibitor.',
    highlights: ['II'],
    tags: ['drug']
  },
  {
    id: 'vitk-factors',
    type: 'vitk',
    prompt: 'Which set lists only vitamin K dependent proteins?',
    choices: [
      'II, VII, IX, X, Protein C, Protein S',
      'I, V, VIII',
      'XII, XI, IX',
      'TF, VII, VIII'
    ],
    correctIndex: 0,
    explanation: 'Vitamin K dependent: II, VII, IX, X, Protein C, Protein S.',
    highlights: ['II', 'VII', 'IX', 'X', 'ProteinC', 'ProteinS'],
    tags: ['vitk']
  },
  {
    id: 'sequence-intrinsic',
    type: 'sequence',
    prompt: 'Intrinsic pathway order (simplified) is: XII -> XI -> __ -> X',
    choices: ['VII', 'IX', 'V', 'II'],
    correctIndex: 1,
    explanation: 'Intrinsic: XII -> XI -> IX (+VIII) -> X.',
    highlights: ['XII', 'XI', 'IX', 'VIII', 'X'],
    tags: ['sequence', 'intrinsic']
  },
  {
    id: 'sequence-extrinsic',
    type: 'sequence',
    prompt: 'Extrinsic pathway order (simplified) is: TF -> __ -> X',
    choices: ['VII', 'XII', 'IX', 'II'],
    correctIndex: 0,
    explanation: 'Extrinsic: Tissue factor (TF) binds factor VII to activate X.',
    highlights: ['TF', 'VII', 'X'],
    tags: ['sequence', 'extrinsic']
  },
  {
    id: 'pathway-common',
    type: 'pathway',
    prompt: 'Which factor is part of the common pathway?',
    choices: ['Factor XII', 'Factor VII', 'Factor X', 'Factor IX'],
    correctIndex: 2,
    explanation: 'Factor X is the entry point to the common pathway.',
    highlights: ['X', 'V', 'II', 'I'],
    tags: ['pathway', 'common']
  },
  {
    id: 'lab-both-common',
    type: 'lab',
    prompt: 'Both PT and aPTT are prolonged. A defect in which factor could explain this?',
    choices: ['Factor X', 'Factor VII', 'Factor XII', 'Protein S'],
    correctIndex: 0,
    explanation: 'Common pathway factors (X, V, II, I) affect both PT and aPTT.',
    highlights: ['X', 'V', 'II', 'I'],
    tags: ['lab', 'both']
  },
  {
    id: 'clinical-f12-no-bleed',
    type: 'clinical',
    prompt: 'Which deficiency can prolong aPTT yet typically does NOT cause bleeding?',
    choices: ['Factor XII', 'Factor VIII', 'Factor IX', 'Factor II'],
    correctIndex: 0,
    explanation: 'Factor XII deficiency prolongs aPTT in vitro but is not associated with bleeding.',
    highlights: ['XII'],
    tags: ['clinical']
  },
  {
    id: 'clinical-vwd',
    type: 'clinical',
    prompt: 'von Willebrand disease most often causes which lab pattern?',
    choices: ['Prolonged aPTT (sometimes) with platelet-type bleeding', 'Isolated prolonged PT', 'Normal bleeding time with severe PT prolongation', 'Isolated low fibrinogen'],
    correctIndex: 0,
    explanation: 'vWD affects platelet adhesion and stabilizes factor VIII; aPTT may be prolonged and mucocutaneous bleeding is common.',
    highlights: ['VIII'],
    tags: ['clinical', 'lab']
  }
];

