
import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { XMarkIcon, EnvelopeIcon, LockClosedIcon, CloudIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isSupabaseConfigured) {
      setError("Supabase API Key (Anon Key) is missing from the environment. Please check your .env settings.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setSignupNotice(null);
      } else {
        const { error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: { full_name: email.split('@')[0] } 
          }
        });
        if (error) throw error;
        setSignupNotice("Check your email to confirm authorization. Click “confirm your email.” It’s okay if the page says it couldn’t connect to the server — the confirmation still works.");
        setIsLogin(true);
        setError(null);
        return;
      }
      onLoginSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-900 transition-colors"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>

        <div className="p-8 pt-10">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-teal-600">
              <CloudIcon className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black text-black">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
            <p className="text-slate-600 text-sm mt-1 font-medium">
              {isLogin ? 'Log in to sync your progress across devices.' : 'Join MediPrep AI to save your study history.'}
            </p>
          </div>

          {!isSupabaseConfigured && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
               <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
               <div className="text-xs text-amber-800 leading-relaxed">
                 <p className="font-bold mb-1">Missing API Key</p>
                 The Supabase <strong>Anon Key</strong> is not set. You must provide the key starting with <code>ey...</code> in your environment variables.
               </div>
            </div>
          )}

          {signupNotice && (
            <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3">
              <CloudIcon className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-800 leading-relaxed">
                <p className="font-bold mb-1">Confirm your email</p>
                {signupNotice}
              </div>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email Address</label>
              <div className="relative">
                <EnvelopeIcon className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-black focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all font-bold placeholder:text-slate-300"
                  placeholder="doctor@medschool.edu"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Password</label>
              <div className="relative">
                <LockClosedIcon className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-black focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all font-bold placeholder:text-slate-300"
                  placeholder="••••••••"
                  minLength={6}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-xs font-bold rounded-lg border border-red-100">
                {error}
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                isLogin ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              onClick={() => { setIsLogin(!isLogin); setError(null); setSignupNotice(null); }}
              className="text-slate-500 text-xs font-bold hover:text-teal-600 transition-colors"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Log in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
