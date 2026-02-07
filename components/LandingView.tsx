import React from 'react';
import {
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  ArchiveBoxIcon,
  AcademicCapIcon,
  PhotoIcon,
  Squares2X2Icon,
  PencilSquareIcon,
  ClockIcon,
  FunnelIcon
} from '@heroicons/react/24/solid';

type Props = {
  onLogin: () => void;
  onSignup: () => void;
};

const FeatureCard: React.FC<{
  title: string;
  body: string;
  icon: React.ReactNode;
  accent: 'teal' | 'indigo' | 'slate';
}> = ({ title, body, icon, accent }) => {
  const accentCls =
    accent === 'teal'
      ? 'from-teal-500/15 to-teal-300/0 border-teal-200/60'
      : accent === 'indigo'
      ? 'from-indigo-500/15 to-indigo-300/0 border-indigo-200/60'
      : 'from-slate-500/12 to-slate-300/0 border-slate-200/70';

  return (
    <div className={`rounded-3xl border bg-gradient-to-b ${accentCls} p-5 shadow-sm`}>
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 text-slate-700 shadow-sm">
          {icon}
        </div>
        <div className="flex-1">
          <div className="text-sm font-black text-slate-900">{title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-slate-600 font-semibold">{body}</div>
        </div>
      </div>
    </div>
  );
};

const ModeCard: React.FC<{
  title: string;
  subtitle: string;
  bullets: string[];
  icon: React.ReactNode;
  accent: 'teal' | 'indigo' | 'slate';
}> = ({ title, subtitle, bullets, icon, accent }) => {
  const accentCls =
    accent === 'teal'
      ? 'border-teal-200/70 hover:border-teal-300 bg-white/70'
      : accent === 'indigo'
      ? 'border-indigo-200/70 hover:border-indigo-300 bg-white/70'
      : 'border-slate-200/70 hover:border-slate-300 bg-white/70';

  return (
    <div className={`rounded-3xl border ${accentCls} backdrop-blur-xl p-6 shadow-[0_24px_80px_-60px_rgba(15,23,42,0.35)] transition-colors`}>
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-2xl bg-slate-900/90 text-white shadow-sm">
          {icon}
        </div>
        <div className="flex-1">
          <div className="text-lg font-black text-slate-900">{title}</div>
          <div className="mt-1 text-[12px] text-slate-600 font-semibold">{subtitle}</div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {bullets.map((b) => (
          <div key={b} className="text-[12px] text-slate-700 font-semibold flex items-start gap-2">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-900/70 shrink-0" />
            <span>{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const LandingView: React.FC<Props> = ({ onLogin, onSignup }) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-24 w-[520px] h-[520px] rounded-full bg-gradient-to-br from-teal-400/25 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-[560px] h-[560px] rounded-full bg-gradient-to-br from-indigo-400/25 to-transparent blur-3xl" />

      <div className="sticky top-0 z-10 bg-slate-50/70 backdrop-blur-xl border-b border-slate-200/60">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-teal-500/10">
              <SparklesIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">MediPrep AI</div>
              <div className="text-[12px] font-semibold text-slate-700">Pulm + Heme NBME prep (beta)</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onLogin}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white/75 backdrop-blur-md text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-white"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={onSignup}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
            >
              Sign up
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-10 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-xl border border-white/60 shadow-sm text-[10px] font-black uppercase tracking-widest text-slate-700">
              <FunnelIcon className="w-4 h-4 text-slate-700" />
              Adaptive practice + tutor
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl font-black tracking-tight text-slate-900">
              Study like an NBME block.
              <span className="block bg-gradient-to-r from-teal-600 to-indigo-600 bg-clip-text text-transparent">
                Then narrow into your weak spots.
              </span>
            </h1>
            <p className="mt-5 text-sm sm:text-base text-slate-600 font-semibold leading-relaxed max-w-xl">
              MediPrep generates NBME-style Pulm and Heme practice, tracks mastery by concept, and tutors you Socratically.
              In review, it switches to tables, mnemonics, and Anki prompts you can export.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={onSignup}
                className="px-6 py-3 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg shadow-slate-900/10"
              >
                Start (Free Beta)
              </button>
              <button
                type="button"
                onClick={onLogin}
                className="px-6 py-3 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-xl text-[11px] font-black uppercase tracking-widest text-slate-700 hover:bg-white shadow-sm"
              >
                I already have an account
              </button>
            </div>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FeatureCard
                accent="teal"
                title="Socratic Tutor (Attempt)"
                body="Hints and next steps without spoilers."
                icon={<ChatBubbleLeftRightIcon className="w-5 h-5" />}
              />
              <FeatureCard
                accent="indigo"
                title="Study Tools (Review)"
                body="Compare tables, 1 mnemonic, and Anki prompts."
                icon={<ArchiveBoxIcon className="w-5 h-5" />}
              />
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-white/60 bg-white/50 backdrop-blur-2xl shadow-[0_40px_120px_-80px_rgba(15,23,42,0.45)] overflow-hidden">
            <div className="p-6 border-b border-white/60 bg-white/40">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">What you do</div>
              <div className="mt-2 text-lg font-black text-slate-900">3-step loop</div>
              <div className="mt-3 space-y-2 text-[12px] text-slate-700 font-semibold">
                <div className="flex items-start gap-2">
                  <span className="mt-1 w-5 h-5 rounded-lg bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">1</span>
                  Pick Pulm, Heme, or mixed.
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 w-5 h-5 rounded-lg bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">2</span>
                  Answer NBME-style questions (timed or immediate).
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1 w-5 h-5 rounded-lg bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">3</span>
                  Rate difficulty (Again/Hard/Good/Easy) so the next batch narrows.
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Choose a mode</div>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <ModeCard
                  accent="teal"
                  title="Practice (Immediate)"
                  subtitle="Learn fast with instant rationale and tutor."
                  bullets={['Immediate feedback', 'Good for learning + pattern building', 'Use Vault to export Anki prompts']}
                  icon={<PencilSquareIcon className="w-5 h-5" />}
                />
                <ModeCard
                  accent="indigo"
                  title="NBME Block (Timed)"
                  subtitle="No answer reveals until submission."
                  bullets={['90 seconds per question', 'Navigator + marking', 'End-of-block review']}
                  icon={<ClockIcon className="w-5 h-5" />}
                />
                <ModeCard
                  accent="slate"
                  title="Funnel (Adaptive)"
                  subtitle="Starts broad then narrows into weak concepts."
                  bullets={['Bank first, generation only as needed', 'Exploration questions to avoid luck', 'Anki rating drives targeting']}
                  icon={<FunnelIcon className="w-5 h-5" />}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Study tools</div>
          <h2 className="mt-2 text-2xl font-black text-slate-900 tracking-tight">Extra reps where it matters</h2>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard
              accent="teal"
              title="Deep Dive"
              body="Concept primers with export."
              icon={<AcademicCapIcon className="w-5 h-5" />}
            />
            <FeatureCard
              accent="indigo"
              title="Histology Review"
              body="Image-first heme morphology."
              icon={<PhotoIcon className="w-5 h-5" />}
            />
            <FeatureCard
              accent="slate"
              title="Cascade Trainer"
              body="Interactive clotting diagram + drills."
              icon={<Squares2X2Icon className="w-5 h-5" />}
            />
            <FeatureCard
              accent="slate"
              title="Tutor Vault"
              body="Save prompts and export to Anki/PDF/DOCX."
              icon={<ArchiveBoxIcon className="w-5 h-5" />}
            />
          </div>
        </div>

        <div className="mt-14 rounded-3xl border border-slate-200 bg-white/70 backdrop-blur-xl p-6 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Beta notes</div>
          <div className="mt-2 text-[12px] text-slate-700 font-semibold leading-relaxed">
            This beta is tuned for Pulm and Heme exam prep. If you see anything confusing, inaccurate, or missing, use the Report button.
            We ship fixes quickly.
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingView;

