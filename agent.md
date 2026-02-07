# agent.md (Levi x Codex)

## Purpose
Shared, lightweight memory for how we work together on this repo.

Use it to:
- Track what worked and what didn't (process + code decisions).
- Record preferences (tone, level of detail, quality bar).
- Keep a small decision log so we don't re-litigate the same choices.

## How We Update This File
- Add a new entry at the top of `## Journal` (newest first).
- Keep entries short: context, what we tried, result, next change.
- If something becomes a stable preference, promote it into `## Preferences`.

## Preferences (Evolving)
- Communication: default to concise, actionable updates; call out tradeoffs explicitly when they matter.
- Changes: prefer small PR-sized diffs; avoid drive-by refactors unless asked.
- Safety: don't do destructive git actions; don't hide errors; surface uncertainty early.
- Testing: run the fastest meaningful checks (`npm test` if it exists) before calling something "done".

## Project Notes (Quick Reference)
- Stack: Vite + React + TypeScript
- Commands: `npm run dev`, `npm run build`, `npm run preview`, `npm test`
- Key paths: `App.tsx`, `components/`, `services/`, `utils/`, `database/`

## What's Working
- (Add as we go)

## What's Not Working
- (Add as we go)

## Decision Log
- 2026-02-07: Created `agent.md` to track collaboration preferences and outcomes.

## Open Questions
- (Add as we go)

## Journal (Newest First)
### 2026-02-07 (Vercel Config Fix)
- Fixed Vercel config error by replacing legacy `routes` with `rewrites` in `vercel.json` (SPA fallback) while preserving `/api/*`.
- Verified `npm test` + `npm run build`.

### 2026-02-07 (Vercel Auto-Redeploy Safety Net)
- Added a GitHub Action deploy-hook trigger on pushes to `main` (`.github/workflows/vercel-deploy-hook.yml`) so Vercel redeploys even if the Git integration stops firing.
- Requires GitHub repo secret `VERCEL_DEPLOY_HOOK_URL` (Vercel Project -> Settings -> Git -> Deploy Hooks).

### 2026-02-07 (Funnel Live Narrowing)
- Funnel: moved “Jump to current” into the Progress header with higher-contrast styling.
- Funnel: narrowing chips/dots are now driven by live mastery (`funnelState`) via `selectTargets`, so the artifact keeps evolving as users answer/rate without generating new questions.

### 2026-02-07 (Vite Build Chunk Warning)
- Reduced initial bundle weight by lazy-loading large tabs (Deep Dive, Funnel, Cascade, Analytics, Cheat Sheet) via `React.lazy` + `Suspense` in `App.tsx`.
- Raised Vite `build.chunkSizeWarningLimit` to avoid noisy warnings caused by intentionally large worker/assets (pdf.js worker).
- Verified `npm test` + `npm run build`.

### 2026-02-07 (Funnel Jump To Current)
- Funnel: added a “Jump to current” button in the Progress card that scrolls to the last active question (fallback: first unanswered, else last question).

### 2026-02-07 (Funnel UI State Persistence)
- Funnel: persisted per-user/per-guide UI state in `components/FunnelView.tsx` (scrollTop, last active question id, showStats) so returning to the Funnel tab restores the last question in view.
- Restores by `lastQuestionId` (scrollIntoView) with scrollTop fallback; saves scroll in a RAF-throttled handler to avoid spamming localStorage.
- Verified with `npm test` and `npm run build`.

### 2026-02-07 (Funnel Keyboard Shortcuts)
- Added funnel-only keyboard workflow in `components/QuestionCard.tsx` (enabled via `keyboardShortcutsEnabled`):
  - Attempt phase: `1-5` or `A-E` selects option; `Enter` reveals rationale.
  - Undo: `Cmd/Ctrl+Z` hides answer (if revealed) or clears selection.
  - Review phase: `1-4` submits Anki rating from anywhere in the card.
- Funnel: added `onFocusCapture` on each question wrapper to keep `lastQuestionId` synced with focus, and a subtle focus ring so it’s obvious which card will receive shortcuts.
- Verified `npm test` + `npm run build`.

### 2026-02-07 (AI Health Env Fallback)
- Added `services/supabasePublicConfig.ts` to centralize the public Supabase URL + anon key.
- Updated Vercel xAI proxy routes (`api/xai/health.ts`, `api/xai/chat.ts`) to fall back to the public Supabase config when `SUPABASE_URL` / `SUPABASE_ANON_KEY` are not set in Vercel env.
- Net effect: `/api/xai/health` now only fails when `XAI_API_KEY` is missing (and not due to missing Supabase env wiring).

### 2026-02-07 (Fix Vercel FUNCTION_INVOCATION_FAILED on /api/xai/*)
- Removed cross-folder imports from `api/xai/health.ts` and `api/xai/chat.ts` and inlined the public Supabase URL + anon key as a fallback.
- Reason: some Vercel function runtimes/builders can choke on extensionless ESM imports outside the `api/` directory, causing invocation-time crashes.
- Expected behavior after deploy: `/api/xai/health` should return JSON (200 or a JSON 500 describing missing `XAI_API_KEY`), not Vercel's crash page.

### 2026-02-07 (AI Status Endpoint)
- Added `api/xai/status.ts` and switched the client health probe in `App.tsx` to call `/api/xai/status` (instead of `/api/xai/health`).
- Goal: avoid a hard dependency on the crashing `/api/xai/health` route while still gating AI features safely.

### 2026-02-07 (Vercel Deploy Debug)
- Production `GET /api/xai/health` is returning `500 FUNCTION_INVOCATION_FAILED` (Vercel crash page), meaning the function is failing before sending a response.
- Verified `POST /api/xai/chat` returns JSON 401 (function is alive), but newly-added endpoints like `/api/ping` and `/api/xai/status` were serving `index.html`, suggesting the production deployment is not picking up the latest commits (or a failed deploy is leaving the site on an older build).
- Next action is in Vercel dashboard: confirm latest deployment commit SHA matches `main`, and inspect deployment logs for the failing `/api/xai/health` function.

### 2026-02-07 (Security Tightening Sprint)
- Moved all xAI traffic server-side via Vercel functions: `api/xai/chat.ts` (Supabase-session gated + rate limited) and `api/xai/health.ts`.
- Removed client-side secret usage: deleted all `VITE_XAI_API_KEY` references in app code and updated UI messaging to "AI unavailable" vs env instructions.
- Removed runtime CDNs (Tailwind CDN, importmap, Google Fonts, KaTeX CDN) and added a real Tailwind build pipeline (`tailwind.config.cjs`, `postcss.config.cjs`, `index.css`).
- Upgraded `katex` + `jspdf` to clear `npm audit --omit=dev`, and added DOMPurify-based sanitization + KaTeX hardening (`trust:false`, `maxExpand:1000`) anywhere we render KaTeX HTML.
- Added security headers + CSP in `vercel.json` and switched SPA routing to `routes` with `handle: filesystem` so `/api/*` functions work.
- Remaining manual action: rotate the xAI key, remove any `VITE_XAI_API_KEY` from Vercel, and set `XAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` in Vercel env.

### 2026-02-07 (Funnel UX + Schema)
- Funnel: moved the topic-narrowing artifact into the scrollable session area so users can scroll past it; updated styling toward "liquid glass" (translucent + blur).
- Schema: added `public.user_concept_mastery` to `database/schema.sql` with RLS so Funnel cohort stats can query without "schema cache" errors.

### 2026-02-07 (Funnel Follow-Up)
- Confirmed Funnel is now a dedicated top-level tab with its own entry flow + in-session stats (not mixed into Practice).
- Admin visibility: Beta Analytics includes a Funnel Progress panel; cohort aggregation depends on Supabase RLS allowing reads on `user_concept_mastery`.

### 2026-02-07 (Process)
- User requested: update `agent.md` at the end of every assistant response going forward.

### 2026-02-07 (Funnel Jump Fix + Focus View)
- Funnel: fixed `Jump to current` targeting so it no longer prioritizes stale `lastQuestionId` over unanswered work; now prefers last-active *unanswered* question, else first unanswered, else last active.
- Funnel: replaced `scrollIntoView` with a deterministic centered `scrollTop` calculation (prevents “jump to end” behavior).
- Funnel: added an Anki-like `Focus view` (single-question) alongside `List view`, persisting per-user/per-guide and auto-advancing to the next unanswered after Anki rating.
- Verified with `npm test` and `npm run build`.

### 2026-02-07 (Funnel Keyboard + Batch Gating + Variety)
- Funnel: added a global keydown proxy so `1-5`, `A-E`, `Enter`, and `Cmd/Ctrl+Z` work without clicking inside the card first (fixes “have to click the rating box” slowdown and makes undo reliable).
- Funnel: gated `Continue Funnel` behind “batch rated” completion and added a next-batch size selector (5/10/15/20); removed the redundant bottom Continue block.
- Funnel selection: added a stem-only signature dedupe + light gold/prefab mixing when scores are similar to reduce “same kind of question” repetition.
- Verified with `npm test` and `npm run build`.

### 2026-02-07 (Funnel Tab + Analytics)
- Implemented dedicated Funnel tab/workflow (separate from Practice) with entry screen, narrowing visualization, and in-session stats.
- Added Funnel Progress panel to Beta Analytics, including optional cohort aggregation from `user_concept_mastery` (RLS may block).
- Persisted funnel session separately via `mediprep_funnel_questions`, `mediprep_funnel_states`, and `mediprep_funnel_guide_context`.
- Ran `npm test` + `npm run build`, then committed and pushed to `main` (commit `dcafa20`).

### 2026-02-07 (Tutor Vault)
- Added `Tutor Vault` as a top-level navigation tab for saving tutor outputs and exporting study artifacts.
- Added save controls in the tutor sidebar: `Save session`, `Save Anki`, `Save table`, `Save mnemonic`, plus `Open Vault`.
- Implemented local-only persistence keyed by user (`mediprep_tutor_exports_v1_${userId||anon}`) and added export formats:
  - Anki CSV (Basic + Cloze)
  - PDF / DOCX for tables, mnemonics, and full sessions
- Added parsing helpers in `utils/tutorExportParsing.ts` to extract compare tables, mnemonics, and Anki prompts from tutor responses.

### 2026-02-07 (Tutor Vault Table Rendering)
- Vault: renders pipe `|` compare tables as a real HTML table (header row, zebra rows, wrapped cells) with horizontal scroll fallback.
- Keeps raw-text fallback when parsing fails (so odd tutor output still displays).

### 2026-02-07
- Started this file. Next: after each task, append 2-5 bullets: what we did, what went well, what to improve.
