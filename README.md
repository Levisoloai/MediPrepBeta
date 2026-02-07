<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/17hrICBiBsBaDNpAODhIApigCJqsNm760

## One‑Click Deploy (Vercel)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Apply Supabase schema updates in `database/schema.sql` (includes `question_feedback` for beta QA)
3. (Optional) Enable analytics view:
   - `VITE_ADMIN_EMAILS` = comma-separated emails
   - or `VITE_ADMIN_DOMAIN` = e.g. `mediprep.ai`
   - or `VITE_ADMIN_MODE=true` for dev-only access
   - Add admin users in Supabase: insert into `admin_users` with the user's UUID
   - Prefab cache table: `study_guide_cache` (admin write, user read)
4. Run the app:
   `npm run dev`

Note: AI features (tutor + generation) are served via a Vercel serverless proxy (`/api/xai/*`) so the xAI key is never shipped to browsers. For local AI usage, run via Vercel (set `XAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`) or use a deployed preview.

## Deploy (Vercel)

This app is a static Vite build, so deployment is straightforward.

1. Push this repo to GitHub (or GitLab).
2. In Vercel, **New Project → Import** the repo.
3. Build settings:
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Set environment variables in Vercel (Project → Settings → Environment Variables):
   - `XAI_API_KEY` (server-side only, do NOT prefix with `VITE_`)
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `VITE_XAI_MODEL` (recommended: `grok-4-1-fast-reasoning`)
   - `VITE_XAI_FAST_MODEL` (recommended: `grok-4-1-fast-non-reasoning`)
   - Optional admin access:
     - `VITE_ADMIN_EMAILS` (comma-separated emails), or
     - `VITE_ADMIN_DOMAIN` (e.g., `mediprep.ai`), or
     - `VITE_ADMIN_MODE=true` (dev-only access)
5. Deploy. Vercel will run the build and serve `dist/`.

Note: SPA routing is already configured via `vercel.json`.
