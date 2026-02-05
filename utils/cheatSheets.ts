export type CheatSheetPrefab = {
  title: string;
  content: string;
};

export const cheatSheetPrefabs: Record<'heme' | 'pulm', CheatSheetPrefab> = {
  heme: {
    title: 'Hematology Rapid Review',
    content: `# Hematology Rapid Review (Last-Minute)

## High-Yield Patterns
- **Microcytic**: iron deficiency (low ferritin, high RDW), thalassemia (normal/high RBC count), sideroblastic (↑ iron, ringed sideroblasts), lead (basophilic stippling).
- **Macrocytic**: B12/folate deficiency (hypersegmented neutrophils), alcohol, meds.
- **Hemolysis**: ↑ LDH, ↓ haptoglobin, ↑ indirect bilirubin, retic ↑.
- **Pancytopenia**: aplastic anemia, marrow infiltration, hypersplenism.

## Smear Morphologies (Match These)
| Morphology | Classic associations |
| --- | --- |
| **Schistocytes** | MAHA (TTP/HUS/DIC), prosthetic valves |
| **Spherocytes** | Hereditary spherocytosis, warm AIHA |
| **Target cells** | Thalassemia, HbC, liver disease, post‑splenectomy |
| **Burr cells (echinocytes)** | Uremia, pyruvate kinase deficiency, artifact |
| **Spur cells (acanthocytes)** | Severe liver disease, abetalipoproteinemia |
| **Teardrop cells** | Myelofibrosis |
| **Howell‑Jolly bodies** | Asplenia/splenectomy |
| **Basophilic stippling** | Lead, thalassemia, sideroblastic anemia |
| **Hypersegmented neutrophils** | B12/folate deficiency |
| **Smudge cells** | CLL |
| **Auer rods** | AML |
| **Rouleaux** | Multiple myeloma/Waldenström |

## Coag & Platelets
- **PT only**: extrinsic (Factor VII), warfarin, vitamin K deficiency.
- **PT + PTT**: DIC, severe liver disease, heparin overdose.
- **Isolated PTT**: hemophilia, heparin, vWD.
- **TTP**: fever + neuro + renal + MAHA + low platelets → **plasma exchange**.
- **HIT**: ↓ platelets 5–10 days after heparin → **stop heparin, start non‑heparin anticoagulant**.

## Transfusion Reactions
| Reaction | Timing | Key clues | Management |
| --- | --- | --- | --- |
| Acute hemolytic | Immediate | Fever, flank pain, hemoglobinuria | Stop transfusion, fluids |
| TRALI | <6 hrs | Non‑cardiogenic pulm edema | Supportive care |
| TACO | <6 hrs | Volume overload | Diuretics |
| Febrile non‑hemolytic | During/after | Fever/chills only | Antipyretics |

## Malignancy Hallmarks
- **CLL**: smudge cells, painless lymphadenopathy.
- **CML**: low LAP, t(9;22).
- **APL**: t(15;17), Auer rods → **ATRA**.
- **Hodgkin**: Reed‑Sternberg, B symptoms.
`
  },
  pulm: {
    title: 'Pulmonology Rapid Review',
    content: `# Pulmonology Rapid Review (Last-Minute)

## PFT Quick Match
| Pattern | FEV1/FVC | TLC | DLCO | Key examples |
| --- | --- | --- | --- | --- |
| **Obstructive** | ↓ | ↑/N | ↓ in emphysema | COPD, asthma |
| **Restrictive (parenchymal)** | ↑/N | ↓ | ↓ | IPF, sarcoid |
| **Restrictive (extrapulmonary)** | ↑/N | ↓ | N | Obesity, NM disease |

## Obstructive Essentials
- **Asthma**: reversible obstruction, eosinophils, treat with SABA → ICS → LABA + ICS.
- **COPD**: chronic bronchitis (blue bloater) vs emphysema (pink puffer); **smoking cessation + bronchodilators**.

## PE / DVT
- **Wells** → D‑dimer if low risk; **CTA** if high risk.
- **Massive PE**: hypotension → thrombolysis.

## ARDS
- Acute hypoxemia, bilateral infiltrates, **low tidal volume** ventilation.

## Lung Cancer
- **Small cell**: central, SIADH/ACTH, very aggressive.
- **Squamous**: central, cavitating, PTHrP.
- **Adeno**: peripheral, most common, nonsmokers.

## Pleural Effusions
| Type | Protein | LDH | Example |
| --- | --- | --- | --- |
| **Transudate** | Low | Low | CHF, cirrhosis |
| **Exudate** | High | High | Infection, malignancy |

## High‑Yield Vignettes
- **COPD + loud P2 + edema** → cor pulmonale.
- **CXR with bilateral infiltrates + severe hypoxemia** → ARDS.
- **Pneumothorax with hypotension + tracheal deviation** → tension PTX → needle decompression.
`
  }
};
