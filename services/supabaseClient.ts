
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zdfhzyqewtgfnnyeklsx.supabase.co';
// Using the provided Anon key directly to ensure the app works immediately
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkZmh6eXFld3RnZm5ueWVrbHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MTYyNDAsImV4cCI6MjA4NDQ5MjI0MH0.k_MsWlsLod9wICGWgLGdLVG7GRi5jLlGUoEVKI9ZL7c';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helper for UI components to check if we can even attempt a login
export const isSupabaseConfigured = !!supabaseKey;
