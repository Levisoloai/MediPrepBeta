export type CheatSheetPrefab = {
  title: string;
  content: string;
};

export const cheatSheetPrefabs: Record<'heme' | 'pulm', CheatSheetPrefab> = {
  heme: {
    title: 'Hematology Rapid Review',
    content: `# Hematology Rapid Review (Last-Minute)

## Pattern Recognition
- **Microcytic**: iron deficiency (low ferritin, high RDW), thalassemia (normal/high RBC count), sideroblastic (high iron, ringed sideroblasts), lead (basophilic stippling).
- **Macrocytic**: B12/folate deficiency (hypersegmented neutrophils), alcohol, meds. Remember neuro deficits = B12.
- **Hemolysis**: high LDH, low haptoglobin, high indirect bili, retic high.
- **Pancytopenia**: aplastic anemia, marrow infiltration, hypersplenism, drugs.

## Iron Studies (Quick Compare)
| Condition | Ferritin | Iron | TIBC | Notes |
| --- | --- | --- | --- | --- |
| Iron deficiency | Low | Low | High | High RDW |
| Anemia of chronic disease | High/normal | Low | Low/normal | Inflammatory hepcidin |
| Sideroblastic | High | High | Low/normal | Ringed sideroblasts |
| Thalassemia | Normal/high | Normal/high | Normal | Target cells |

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
- **HIT**: platelets drop 5–10 days after heparin → **stop heparin, start non‑heparin anticoagulant**.
- **ITP**: isolated thrombocytopenia, large platelets → steroids/IVIG.

## Hemolysis: Intra vs Extra
- **Intravascular**: hemoglobinuria, low haptoglobin, schistocytes.
- **Extravascular**: spherocytes, splenomegaly, jaundice.

## Transfusion Reactions
| Reaction | Timing | Key clues | Management |
| --- | --- | --- | --- |
| Acute hemolytic | Immediate | Fever, flank pain, hemoglobinuria | Stop transfusion, fluids |
| TRALI | <6 hrs | Non‑cardiogenic pulm edema | Supportive care |
| TACO | <6 hrs | Volume overload | Diuretics |
| Febrile non‑hemolytic | During/after | Fever/chills only | Antipyretics |
| Allergic | During | Urticaria | Antihistamines |

## Malignancy Hallmarks
- **CLL**: smudge cells, painless lymphadenopathy.
- **CML**: low LAP, t(9;22).
- **APL**: t(15;17), Auer rods → **ATRA**.
- **Hodgkin**: Reed‑Sternberg, B symptoms.
- **MM**: rouleaux, lytic lesions, Bence Jones.
`
  },
  pulm: {
    title: 'Pulmonology Rapid Review',
    content: `# Pulmonology Rapid Review (Last-Minute)

## PFT Quick Match
| Pattern | FEV1/FVC | TLC | DLCO | Key examples |
| --- | --- | --- | --- | --- |
| **Obstructive** | Low | High/normal | Low in emphysema | COPD, asthma |
| **Restrictive (parenchymal)** | High/normal | Low | Low | IPF, sarcoid |
| **Restrictive (extrapulmonary)** | High/normal | Low | Normal | Obesity, NM disease |

## Obstructive Essentials
- **Asthma**: reversible obstruction, eosinophils. Step‑up: SABA → ICS → LABA + ICS → add LAMA/biologics.
- **COPD**: chronic bronchitis vs emphysema; treat with smoking cessation, bronchodilators, oxygen if severe.
- **COPD exacerbation**: bronchodilators + steroids, add antibiotics if purulent sputum.

## PE / DVT
- **Wells**: low risk → D‑dimer; high risk → CT angiography.
- **Massive PE**: hypotension → thrombolysis.
- **Submassive**: RV strain → anticoagulate, consider lytics.

## ARDS
- Acute hypoxemia, bilateral infiltrates, non‑cardiogenic edema → **low tidal volume** + PEEP.

## Pneumonia Pointers
- Typical CAP: high fever, lobar consolidation → beta‑lactam + macrolide.
- Atypical CAP: dry cough, diffuse pattern → macrolide or doxy.
- Aspiration: anaerobes → clindamycin or amp‑sulbactam.

## Lung Cancer
- **Small cell**: central, SIADH/ACTH, very aggressive.
- **Squamous**: central, cavitating, PTHrP.
- **Adeno**: peripheral, most common, nonsmokers.

## Pleural Effusions
| Type | Protein | LDH | Example |
| --- | --- | --- | --- |
| **Transudate** | Low | Low | CHF, cirrhosis |
| **Exudate** | High | High | Infection, malignancy |

## Sleep / Vent
- **OSA**: obesity, daytime somnolence → CPAP.
- **Tension PTX**: hypotension + tracheal deviation → needle decompression.

## High‑Yield Vignettes
- **COPD + loud P2 + edema** → cor pulmonale.
- **CXR with bilateral infiltrates + severe hypoxemia** → ARDS.
- **Recurrent hemoptysis + weight loss** → lung cancer workup.
`
  }
};
