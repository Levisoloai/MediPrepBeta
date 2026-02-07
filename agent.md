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
### 2026-02-07 (Funnel UX + Schema)
- Funnel: moved the topic-narrowing artifact into the scrollable session area so users can scroll past it; updated styling toward "liquid glass" (translucent + blur).
- Schema: added `public.user_concept_mastery` to `database/schema.sql` with RLS so Funnel cohort stats can query without "schema cache" errors.

### 2026-02-07 (Funnel Follow-Up)
- Confirmed Funnel is now a dedicated top-level tab with its own entry flow + in-session stats (not mixed into Practice).
- Admin visibility: Beta Analytics includes a Funnel Progress panel; cohort aggregation depends on Supabase RLS allowing reads on `user_concept_mastery`.

### 2026-02-07 (Process)
- User requested: update `agent.md` at the end of every assistant response going forward.

### 2026-02-07 (Funnel Tab + Analytics)
- Implemented dedicated Funnel tab/workflow (separate from Practice) with entry screen, narrowing visualization, and in-session stats.
- Added Funnel Progress panel to Beta Analytics, including optional cohort aggregation from `user_concept_mastery` (RLS may block).
- Persisted funnel session separately via `mediprep_funnel_questions`, `mediprep_funnel_states`, and `mediprep_funnel_guide_context`.
- Ran `npm test` + `npm run build`, then committed and pushed to `main` (commit `dcafa20`).

### 2026-02-07
- Started this file. Next: after each task, append 2-5 bullets: what we did, what went well, what to improve.
