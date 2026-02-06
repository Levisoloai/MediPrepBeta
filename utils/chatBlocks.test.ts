import { describe, it, expect } from 'vitest';
import { parseChatBlocks } from './chatBlocks';

describe('parseChatBlocks', () => {
  it('splits pipe tables into a table block', () => {
    const text = [
      'Compare table:',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'Mnemonic: test'
    ].join('\n');

    const blocks = parseChatBlocks(text);
    expect(blocks.some((b) => b.type === 'table')).toBe(true);
    const table = blocks.find((b) => b.type === 'table') as any;
    expect(table.header).toEqual(['A', 'B']);
    expect(table.rows[0]).toEqual(['1', '2']);
  });
});

