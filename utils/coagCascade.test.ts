import { describe, expect, it } from 'vitest';
import { COAG_DRILL_CARDS, COAG_NODES, HIGHLIGHT_PRESETS } from './coagCascade';

describe('coagCascade dataset', () => {
  it('has required core nodes', () => {
    const ids = new Set(COAG_NODES.map((n) => n.id));
    const required = ['TF', 'VII', 'XII', 'XI', 'IX', 'VIII', 'X', 'V', 'II', 'I', 'ProteinC', 'ProteinS', 'ATIII'];
    required.forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it('drill cards have valid correctIndex and highlight ids', () => {
    const ids = new Set(COAG_NODES.map((n) => n.id));
    COAG_DRILL_CARDS.forEach((card) => {
      expect(card.correctIndex).toBeGreaterThanOrEqual(0);
      expect(card.correctIndex).toBeLessThan(card.choices.length);
      card.highlights.forEach((id) => expect(ids.has(id)).toBe(true));
    });
  });

  it('highlight presets only reference valid nodes', () => {
    const ids = new Set(COAG_NODES.map((n) => n.id));
    Object.values(HIGHLIGHT_PRESETS).forEach((preset) => {
      preset.nodeIds.forEach((id) => expect(ids.has(id)).toBe(true));
    });
  });
});

