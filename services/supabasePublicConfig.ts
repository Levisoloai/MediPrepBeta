// Public Supabase config (anon key is safe to ship to clients).
// Keeping this in a shared module lets both the browser and Vercel API routes
// use the same project without requiring extra server env wiring.

export const SUPABASE_URL = 'https://zdfhzyqewtgfnnyeklsx.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkZmh6eXFld3RnZm5ueWVrbHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MTYyNDAsImV4cCI6MjA4NDQ5MjI0MH0.k_MsWlsLod9wICGWgLGdLVG7GRi5jLlGUoEVKI9ZL7c';

