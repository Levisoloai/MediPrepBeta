type XaiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// NOTE: Vercel serverless functions may run without bundling in some configs.
// Avoid cross-folder imports and rely on inline public Supabase config as a fallback.
const DEFAULT_SUPABASE_URL = 'https://zdfhzyqewtgfnnyeklsx.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkZmh6eXFld3RnZm5ueWVrbHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MTYyNDAsImV4cCI6MjA4NDQ5MjI0MH0.k_MsWlsLod9wICGWgLGdLVG7GRi5jLlGUoEVKI9ZL7c';

const XAI_BASE_URL = 'https://api.x.ai/v1';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60; // per window, per user (best-effort)
const rateByUser = new Map<string, { windowStartMs: number; count: number }>();

const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 60_000;
const MAX_MESSAGE_CHARS = 8_000;

const sendJson = (res: any, status: number, payload: any) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

const readJsonBody = async (req: any) => {
  const MAX_BODY_BYTES = 200_000;
  return await new Promise<any>((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: any) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error('Request too large.'));
        try { req.destroy(); } catch {}
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
};

const getBearerToken = (req: any) => {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
};

const coerceMessages = (raw: any): XaiMessage[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: XaiMessage[] = [];
  for (const item of raw) {
    const role = item?.role;
    const content = item?.content;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed) continue;
    out.push({ role, content: trimmed.slice(0, MAX_MESSAGE_CHARS) });
    if (out.length >= MAX_MESSAGES) break;
  }
  const total = out.reduce((acc, m) => acc + m.content.length, 0);
  if (total > MAX_TOTAL_CHARS) return null;
  return out.length > 0 ? out : null;
};

const fetchSupabaseUser = async (supabaseUrl: string, supabaseAnonKey: string, accessToken: string) => {
  const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!resp.ok) return null;
  return await resp.json();
};

const checkRateLimit = (userId: string) => {
  const now = Date.now();
  const current = rateByUser.get(userId);
  if (!current || now - current.windowStartMs >= RATE_WINDOW_MS) {
    rateByUser.set(userId, { windowStartMs: now, count: 1 });
    return { ok: true };
  }
  if (current.count >= RATE_MAX) {
    return { ok: false, retryAfterMs: RATE_WINDOW_MS - (now - current.windowStartMs) };
  }
  current.count += 1;
  return { ok: true };
};

const callXai = async (input: {
  messages: XaiMessage[];
  model: string;
  temperature: number;
}) => {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error('XAI_API_KEY is not configured.');

  const controller = new AbortController();
  const timeoutMs = 55_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature,
        messages: input.messages
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`xAI error (${resp.status}): ${text}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') throw new Error('Empty response from xAI.');
    return { content: content as string, usage: data?.usage || null };
  } finally {
    clearTimeout(timeoutId);
  }
};

export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    sendJson(res, 500, { error: 'Server misconfigured (missing Supabase env).' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    sendJson(res, 401, { error: 'Missing Authorization bearer token.' });
    return;
  }

  const user = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, accessToken);
  const userId = user?.id ? String(user.id) : null;
  if (!userId) {
    sendJson(res, 401, { error: 'Invalid session.' });
    return;
  }

  const rate = checkRateLimit(userId);
  if (!rate.ok) {
    res.setHeader('Retry-After', String(Math.ceil((rate.retryAfterMs || 0) / 1000)));
    sendJson(res, 429, { error: 'Rate limit exceeded. Please try again shortly.' });
    return;
  }

  let body: any;
  try {
    body = await readJsonBody(req);
  } catch (err: any) {
    sendJson(res, 400, { error: err?.message || 'Invalid request body.' });
    return;
  }

  const messages = coerceMessages(body?.messages);
  if (!messages) {
    sendJson(res, 400, { error: 'Invalid messages payload.' });
    return;
  }

  const model = typeof body?.model === 'string' && /^[a-zA-Z0-9._:-]{1,80}$/.test(body.model)
    ? body.model
    : 'grok-4-1-fast-reasoning';
  const temperatureRaw = Number(body?.temperature);
  const temperature = Number.isFinite(temperatureRaw) ? Math.max(0, Math.min(1, temperatureRaw)) : 0.2;

  try {
    const { content } = await callXai({ messages, model, temperature });
    sendJson(res, 200, { content });
  } catch (err: any) {
    // Avoid leaking upstream details. Keep errors minimal.
    sendJson(res, 502, { error: 'AI request failed.' });
  }
}
