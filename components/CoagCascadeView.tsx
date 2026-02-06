import React, { useEffect, useMemo, useState } from 'react';
import {
  COAG_DRILL_CARDS,
  COAG_EDGES,
  COAG_NODES,
  CoagHighlightPresetId,
  CoagNode,
  HIGHLIGHT_PRESETS
} from '../utils/coagCascade';

type DrillMode = 'none' | 'drill' | 'review_missed';

type DrillStats = {
  answered: number;
  correct: number;
  byTag: Record<string, { answered: number; correct: number }>;
};

const HIGHLIGHT_MODE_KEY = 'mediprep_coag_highlight_mode_v1';
const STATS_KEY = 'mediprep_coag_stats_v1';
const MISSED_KEY = 'mediprep_coag_missed_v1';
const DRILL_STATE_KEY = 'mediprep_coag_drill_state_v1';

const safeJsonParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const pickRandom = <T,>(items: T[], count: number) => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
};

const testLabel = (tests: CoagNode['tests']) => {
  if (tests === 'pt') return 'PT/INR';
  if (tests === 'ptt') return 'aPTT';
  if (tests === 'both') return 'PT + aPTT';
  return 'Neither (regulator)';
};

type NodePos = { x: number; y: number; w: number; h: number };

const NODE_POS: Record<string, NodePos> = {
  TF: { x: 80, y: 90, w: 90, h: 44 },
  VII: { x: 190, y: 155, w: 90, h: 44 },

  XII: { x: 690, y: 70, w: 90, h: 44 },
  XI: { x: 690, y: 135, w: 90, h: 44 },
  IX: { x: 620, y: 210, w: 90, h: 44 },
  VIII: { x: 520, y: 210, w: 90, h: 44 },

  X: { x: 395, y: 265, w: 90, h: 44 },
  V: { x: 505, y: 300, w: 90, h: 44 },
  II: { x: 395, y: 345, w: 90, h: 44 },
  I: { x: 395, y: 425, w: 90, h: 44 },

  ATIII: { x: 640, y: 285, w: 110, h: 44 },
  ProteinC: { x: 640, y: 360, w: 110, h: 44 },
  ProteinS: { x: 640, y: 425, w: 110, h: 44 }
};

const getNodeCenter = (id: string) => {
  const pos = NODE_POS[id];
  if (!pos) return { x: 0, y: 0 };
  return { x: pos.x + pos.w / 2, y: pos.y + pos.h / 2 };
};

const defaultStats = (): DrillStats => ({ answered: 0, correct: 0, byTag: {} });

const CoagCascadeView: React.FC<{ user?: any }> = () => {
  const nodeMap = useMemo(() => {
    const map: Record<string, CoagNode> = {};
    COAG_NODES.forEach((n) => {
      map[n.id] = n;
    });
    return map;
  }, []);

  const cardMap = useMemo(() => {
    const map: Record<string, (typeof COAG_DRILL_CARDS)[number]> = {};
    COAG_DRILL_CARDS.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, []);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('X');
  const [highlightMode, setHighlightMode] = useState<CoagHighlightPresetId>(() => {
    const saved = localStorage.getItem(HIGHLIGHT_MODE_KEY);
    return (saved as CoagHighlightPresetId) in HIGHLIGHT_PRESETS ? (saved as CoagHighlightPresetId) : 'none';
  });
  const [showRoleColors, setShowRoleColors] = useState(false);

  const [drillMode, setDrillMode] = useState<DrillMode>(() => {
    const saved = safeJsonParse<{ mode?: DrillMode }>(localStorage.getItem(DRILL_STATE_KEY), {});
    return saved.mode === 'review_missed' || saved.mode === 'drill' ? saved.mode : 'none';
  });
  const [deckIds, setDeckIds] = useState<string[]>(() => {
    const saved = safeJsonParse<{ deckIds?: string[] }>(localStorage.getItem(DRILL_STATE_KEY), {});
    return Array.isArray(saved.deckIds) ? saved.deckIds.map(String) : [];
  });
  const [currentIdx, setCurrentIdx] = useState<number>(() => {
    const saved = safeJsonParse<{ currentIdx?: number }>(localStorage.getItem(DRILL_STATE_KEY), {});
    return Number.isFinite(saved.currentIdx) ? clamp(Number(saved.currentIdx), 0, 9999) : 0;
  });
  const [answersById, setAnswersById] = useState<Record<string, number>>(() => {
    const saved = safeJsonParse<{ answersById?: Record<string, number> }>(localStorage.getItem(DRILL_STATE_KEY), {});
    if (!saved.answersById || typeof saved.answersById !== 'object') return {};
    const out: Record<string, number> = {};
    Object.entries(saved.answersById).forEach(([k, v]) => {
      const idx = Number(v);
      if (Number.isFinite(idx)) out[String(k)] = idx;
    });
    return out;
  });

  const [missedIds, setMissedIds] = useState<string[]>(() => {
    const saved = safeJsonParse<string[]>(localStorage.getItem(MISSED_KEY), []);
    return Array.isArray(saved) ? saved.map(String) : [];
  });
  const [stats, setStats] = useState<DrillStats>(() => {
    const saved = safeJsonParse<DrillStats>(localStorage.getItem(STATS_KEY), defaultStats());
    if (!saved || typeof saved !== 'object') return defaultStats();
    return {
      answered: Number(saved.answered) || 0,
      correct: Number(saved.correct) || 0,
      byTag: saved.byTag && typeof saved.byTag === 'object' ? saved.byTag : {}
    };
  });

  useEffect(() => {
    localStorage.setItem(HIGHLIGHT_MODE_KEY, highlightMode);
  }, [highlightMode]);

  useEffect(() => {
    localStorage.setItem(MISSED_KEY, JSON.stringify(missedIds));
  }, [missedIds]);

  useEffect(() => {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    localStorage.setItem(
      DRILL_STATE_KEY,
      JSON.stringify({
        mode: drillMode,
        deckIds,
        currentIdx,
        answersById
      })
    );
  }, [drillMode, deckIds, currentIdx, answersById]);

  useEffect(() => {
    if (deckIds.length === 0) return;
    if (currentIdx >= deckIds.length) setCurrentIdx(deckIds.length - 1);
  }, [deckIds, currentIdx]);

  const activeCardId = deckIds[currentIdx] ?? null;
  const activeCard = activeCardId ? cardMap[activeCardId] : null;
  const answeredIndex = activeCardId != null ? answersById[activeCardId] : undefined;
  const hasAnsweredActive = typeof answeredIndex === 'number' && Number.isFinite(answeredIndex);
  const activeCorrect = activeCard ? answeredIndex === activeCard.correctIndex : false;

  const baseHighlightIds = highlightMode === 'none' ? [] : HIGHLIGHT_PRESETS[highlightMode].nodeIds;
  const drillHighlightIds = activeCard && hasAnsweredActive ? activeCard.highlights : [];
  const selectedHighlightIds = selectedNodeId ? [selectedNodeId] : [];

  const highlightSet = useMemo(() => {
    const set = new Set<string>();
    [...baseHighlightIds, ...drillHighlightIds, ...selectedHighlightIds].forEach((id) => set.add(id));
    return set;
  }, [baseHighlightIds, drillHighlightIds, selectedHighlightIds]);

  const shouldDim = highlightMode !== 'none' || drillHighlightIds.length > 0;

  const startDeck = (mode: DrillMode) => {
    if (mode === 'review_missed') {
      const pool = missedIds.filter((id) => Boolean(cardMap[id]));
      if (pool.length === 0) {
        setDrillMode('none');
        setDeckIds([]);
        setCurrentIdx(0);
        return;
      }
      setDrillMode('review_missed');
      setDeckIds(pool);
      setCurrentIdx(0);
      setAnswersById({});
      return;
    }

    const allIds = COAG_DRILL_CARDS.map((c) => c.id);
    const picked = pickRandom(allIds, Math.min(10, allIds.length));
    setDrillMode('drill');
    setDeckIds(picked);
    setCurrentIdx(0);
    setAnswersById({});
  };

  const exitDeck = () => {
    setDrillMode('none');
    setDeckIds([]);
    setCurrentIdx(0);
    setAnswersById({});
  };

  const submitAnswer = (choiceIdx: number) => {
    if (!activeCardId || !activeCard) return;
    if (typeof answersById[activeCardId] === 'number') return;

    setAnswersById((prev) => ({ ...prev, [activeCardId]: choiceIdx }));

    const isCorrect = choiceIdx === activeCard.correctIndex;
    setStats((prev) => {
      const next: DrillStats = {
        answered: prev.answered + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
        byTag: { ...prev.byTag }
      };

      activeCard.tags.forEach((tag) => {
        const existing = next.byTag[tag] || { answered: 0, correct: 0 };
        next.byTag[tag] = {
          answered: existing.answered + 1,
          correct: existing.correct + (isCorrect ? 1 : 0)
        };
      });

      return next;
    });

    setMissedIds((prev) => {
      const set = new Set(prev);
      if (isCorrect) set.delete(activeCardId);
      else set.add(activeCardId);
      return Array.from(set);
    });
  };

  const goNext = () => setCurrentIdx((idx) => clamp(idx + 1, 0, Math.max(0, deckIds.length - 1)));
  const goPrev = () => setCurrentIdx((idx) => clamp(idx - 1, 0, Math.max(0, deckIds.length - 1)));

  const selectedNode = selectedNodeId ? nodeMap[selectedNodeId] : null;

  return (
    <div className="h-full flex flex-col transition-all duration-300 ease-out p-6 md:p-10">
      <div className="mb-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="flex-1">
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Clotting Cascade</h2>
          <p className="text-slate-500 text-sm font-medium">
            Click factors, highlight PT vs aPTT, then drill rapid recall (no AI credits).
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowRoleColors((v) => !v)}
            className={`px-4 py-2 rounded-full border text-[11px] font-black uppercase tracking-widest transition-colors ${
              showRoleColors ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Cofactors Color
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['pt', 'ptt', 'vitk', 'heparin', 'warfarin', 'doacs', 'none'] as CoagHighlightPresetId[]).map((id) => {
          const preset = HIGHLIGHT_PRESETS[id];
          const active = highlightMode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setHighlightMode(id)}
              className={`px-4 py-2 rounded-full border text-[11px] font-black uppercase tracking-widest transition-colors ${
                active
                  ? 'bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden">
        <div className="bg-white/90 border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Interactive Diagram</div>
            {drillHighlightIds.length > 0 && (
              <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Drill Highlight</div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4">
            <div className="w-full max-w-[900px] mx-auto">
              <svg viewBox="0 0 840 520" className="w-full h-auto select-none">
                <defs>
                  <marker
                    id="arrow"
                    markerWidth="10"
                    markerHeight="10"
                    refX="8"
                    refY="3"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path d="M0,0 L9,3 L0,6 z" fill="#94a3b8" />
                  </marker>
                </defs>

                <text x="80" y="55" fontSize="12" fontWeight="800" fill="#64748b">
                  EXTRINSIC (PT)
                </text>
                <text x="650" y="55" fontSize="12" fontWeight="800" fill="#64748b">
                  INTRINSIC (aPTT)
                </text>
                <text x="355" y="245" fontSize="12" fontWeight="800" fill="#64748b">
                  COMMON (BOTH)
                </text>
                <text x="640" y="270" fontSize="12" fontWeight="800" fill="#64748b">
                  REGULATORS
                </text>

                {COAG_EDGES.map((edge) => {
                  const a = getNodeCenter(edge.from);
                  const b = getNodeCenter(edge.to);
                  const midX = (a.x + b.x) / 2;
                  const midY = (a.y + b.y) / 2;
                  return (
                    <g key={`${edge.from}-${edge.to}`}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#94a3b8"
                        strokeWidth={2}
                        markerEnd="url(#arrow)"
                        opacity={shouldDim ? 0.55 : 1}
                      />
                      {edge.label ? (
                        <text x={midX + 6} y={midY - 6} fontSize="10" fontWeight="700" fill="#64748b">
                          {edge.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}

                {COAG_NODES.map((node) => {
                  const pos = NODE_POS[node.id];
                  if (!pos) return null;

                  const isSelected = selectedNodeId === node.id;
                  const isHighlighted = highlightSet.has(node.id);
                  const dimmed = shouldDim && !isHighlighted;

                  const isCofactor = node.role === 'cofactor';
                  const fill = showRoleColors
                    ? isCofactor
                      ? '#fff7ed'
                      : node.pathways.includes('regulator')
                      ? '#f1f5f9'
                      : '#ffffff'
                    : '#ffffff';
                  const stroke = isSelected ? '#0f766e' : isHighlighted ? '#2563eb' : '#cbd5e1';

                  const label = node.label;

                  return (
                    <g
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      style={{ cursor: 'pointer' }}
                      opacity={dimmed ? 0.25 : 1}
                    >
                      <rect
                        x={pos.x}
                        y={pos.y}
                        rx={14}
                        ry={14}
                        width={pos.w}
                        height={pos.h}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? 3 : 2}
                      />
                      <text
                        x={pos.x + pos.w / 2}
                        y={pos.y + pos.h / 2 + 5}
                        textAnchor="middle"
                        fontSize="14"
                        fontWeight="900"
                        fill="#0f172a"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 overflow-hidden">
          <div className="bg-white/90 border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Factor Details</div>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {selectedNode ? (
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xl font-black text-slate-900">{selectedNode.name}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        Pathway:{' '}
                        <span className="text-slate-800">
                          {selectedNode.pathways.map((p) => p.toUpperCase()).join(', ')}
                        </span>
                      </div>
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
                      {testLabel(selectedNode.tests)}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-2xl border border-slate-200 bg-white">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Role</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">
                        {selectedNode.role.toUpperCase()}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl border border-slate-200 bg-white">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vitamin K</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">
                        {selectedNode.vitKDependent ? 'Dependent' : 'No'}
                      </div>
                    </div>
                  </div>

                  {selectedNode.activates && selectedNode.activates.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Activates</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {selectedNode.activates.map((id) => (
                          <span
                            key={id}
                            className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-700"
                          >
                            {nodeMap[id]?.label ?? id}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedNode.drugTargets && selectedNode.drugTargets.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Drug Targets</div>
                      <div className="mt-1 space-y-1 text-sm text-slate-700 font-semibold">
                        {selectedNode.drugTargets.map((t) => (
                          <div key={t}>- {t}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedNode.clinicalNotes && selectedNode.clinicalNotes.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">High Yield</div>
                      <div className="mt-1 space-y-1 text-sm text-slate-700 font-semibold">
                        {selectedNode.clinicalNotes.map((t) => (
                          <div key={t}>- {t}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedNode.mnemonic && (
                    <div className="mt-4 p-4 rounded-2xl border border-indigo-200 bg-indigo-50">
                      <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Mnemonic</div>
                      <div className="mt-1 text-sm font-bold text-indigo-900">{selectedNode.mnemonic}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-slate-500 font-semibold">Click a factor in the diagram to see details.</div>
              )}
            </div>
          </div>

          <div className="bg-white/90 border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Drill Mode</div>
                <div className="text-xs text-slate-500 font-semibold">
                  Answered <span className="text-slate-900 font-black">{stats.answered}</span> | Correct{' '}
                  <span className="text-slate-900 font-black">{stats.correct}</span>
                </div>
              </div>

              {drillMode === 'none' ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startDeck('drill')}
                    className="px-4 py-2 rounded-full bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700"
                  >
                    Start Drill (10)
                  </button>
                  <button
                    type="button"
                    onClick={() => startDeck('review_missed')}
                    className="px-4 py-2 rounded-full border border-slate-200 bg-white text-[11px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50"
                  >
                    Review Missed ({missedIds.length})
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={exitDeck}
                  className="px-4 py-2 rounded-full border border-slate-200 bg-white text-[11px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50"
                >
                  Exit
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto p-5">
              {drillMode !== 'none' && activeCard ? (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Card {currentIdx + 1}/{deckIds.length} ({activeCard.type})
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={goPrev}
                        disabled={currentIdx === 0}
                        className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={goNext}
                        disabled={currentIdx >= deckIds.length - 1}
                        className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>

                  <div className="text-sm font-black text-slate-900">{activeCard.prompt}</div>

                  <div className="mt-4 grid grid-cols-1 gap-2">
                    {activeCard.choices.map((choice, idx) => {
                      const answered = hasAnsweredActive;
                      const chosen = answeredIndex === idx;
                      const correct = activeCard.correctIndex === idx;

                      let className =
                        'px-4 py-3 rounded-2xl border text-left font-semibold transition-colors';

                      if (!answered) {
                        className += ' bg-white border-slate-200 hover:bg-slate-50';
                      } else if (correct) {
                        className += ' bg-emerald-50 border-emerald-200 text-emerald-900';
                      } else if (chosen) {
                        className += ' bg-rose-50 border-rose-200 text-rose-900';
                      } else {
                        className += ' bg-white border-slate-200 text-slate-700 opacity-70';
                      }

                      return (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => submitAnswer(idx)}
                          disabled={answered}
                          className={className}
                        >
                          <span className="text-sm">{choice}</span>
                        </button>
                      );
                    })}
                  </div>

                  {hasAnsweredActive && (
                    <div className="mt-4">
                      <div
                        className={`p-4 rounded-2xl border ${
                          activeCorrect
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="text-[10px] font-black uppercase tracking-widest">
                          {activeCorrect ? 'Correct' : 'Incorrect'}
                        </div>
                        <div className="mt-1 text-sm font-bold">{activeCard.explanation}</div>
                      </div>

                      {drillMode === 'review_missed' && currentIdx === deckIds.length - 1 && missedIds.length > 0 && (
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="text-xs text-slate-500 font-semibold">
                            Still missed: <span className="font-black text-slate-900">{missedIds.length}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => startDeck('review_missed')}
                            className="px-4 py-2 rounded-full bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700"
                          >
                            Run Missed Again
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : drillMode === 'review_missed' && missedIds.length === 0 ? (
                <div className="text-sm text-slate-500 font-semibold">No missed cards right now.</div>
              ) : drillMode !== 'none' && !activeCard ? (
                <div className="text-sm text-slate-500 font-semibold">Deck is empty.</div>
              ) : (
                <div className="text-sm text-slate-500 font-semibold">
                  Start a 10-card drill or review only the ones you missed.
                </div>
              )}

              {Object.keys(stats.byTag).length > 0 && (
                <div className="mt-5 pt-4 border-t border-slate-100">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">By Tag</div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(stats.byTag)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .slice(0, 8)
                      .map(([tag, v]) => (
                        <div key={tag} className="p-3 rounded-2xl border border-slate-200 bg-white">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {tag}
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-700">
                            {v.correct}/{v.answered} correct
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoagCascadeView;

