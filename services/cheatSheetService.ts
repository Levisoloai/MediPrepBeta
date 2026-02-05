import { supabase } from './supabaseClient';

export type CheatSheetPrefabRow = {
  module: 'heme' | 'pulm';
  title: string;
  content: string;
  updated_at?: string;
};

export const getCheatSheetPrefabs = async (): Promise<CheatSheetPrefabRow[]> => {
  const { data, error } = await supabase
    .from('cheat_sheet_prefabs')
    .select('module,title,content,updated_at')
    .order('module', { ascending: true });

  if (error || !data) {
    throw error || new Error('Failed to load cheat sheet prefabs.');
  }

  return (data as CheatSheetPrefabRow[]).map((row) => ({
    module: row.module,
    title: row.title,
    content: row.content,
    updated_at: row.updated_at
  }));
};

export const getCheatSheetPrefab = async (module: 'heme' | 'pulm'): Promise<CheatSheetPrefabRow | null> => {
  const { data, error } = await supabase
    .from('cheat_sheet_prefabs')
    .select('module,title,content,updated_at')
    .eq('module', module)
    .maybeSingle();

  if (error || !data) return null;
  return data as CheatSheetPrefabRow;
};

export const upsertCheatSheetPrefab = async (row: CheatSheetPrefabRow) => {
  const payload = {
    module: row.module,
    title: row.title,
    content: row.content,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('cheat_sheet_prefabs')
    .upsert(payload, { onConflict: 'module' });

  if (error) {
    throw error;
  }

  return payload;
};
