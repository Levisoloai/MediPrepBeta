const DEFAULT_SUPABASE_URL = 'https://zdfhzyqewtgfnnyeklsx.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkZmh6eXFld3RnZm5ueWVrbHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MTYyNDAsImV4cCI6MjA4NDQ5MjI0MH0.k_MsWlsLod9wICGWgLGdLVG7GRi5jLlGUoEVKI9ZL7c';

export default function handler(_req: any, res: any) {
  try {
    const key = process.env.XAI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    if (!key) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: 'XAI_API_KEY is not configured.' }));
      return;
    }
    if (!supabaseUrl || !supabaseAnonKey) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: 'Supabase env is not configured.' }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch {
    // If something unexpected happens (builder/runtime mismatch), avoid crashing the function.
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, error: 'AI status endpoint crashed.' }));
  }
}

