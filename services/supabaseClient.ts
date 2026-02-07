
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabasePublicConfig';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper for UI components to check if we can even attempt a login
export const isSupabaseConfigured = !!SUPABASE_ANON_KEY;
