import React from 'react';
import { BeakerIcon, PencilSquareIcon, AcademicCapIcon, SparklesIcon, UserCircleIcon, ChartBarIcon } from '@heroicons/react/24/solid';

type ViewMode = 'generate' | 'practice' | 'deepdive' | 'analytics';

interface NavigationProps {
  currentView: ViewMode;
  setView: (view: ViewMode) => void;
  activeQuestionCount: number;
  user?: any;
  showAnalytics?: boolean;
  onLoginClick?: () => void;
  onLogout?: () => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentView, setView, activeQuestionCount, user, showAnalytics, onLoginClick, onLogout }) => {
  const items = [
    { id: 'generate', label: 'Generate', icon: BeakerIcon },
    { id: 'practice', label: 'Practice', icon: PencilSquareIcon, count: activeQuestionCount },
    { id: 'deepdive', label: 'Deep Dive', icon: AcademicCapIcon },
    ...(showAnalytics ? [{ id: 'analytics', label: 'Analytics', icon: ChartBarIcon }] : [])
  ];

  const handleProfileClick = () => {
    if (user && onLogout) {
      if (window.confirm(`Logged in as ${user.email}. Sign out?`)) {
        onLogout();
      }
    } else if (onLoginClick) {
      onLoginClick();
    }
  };

  return (
    <>
      <nav className="hidden md:flex flex-col w-[4.5rem] h-[92vh] fixed left-4 top-[4vh] z-40 bg-white/80 backdrop-blur-xl border border-white/60 shadow-2xl shadow-slate-200/50 rounded-full py-6 items-center justify-between">
        <div className="shrink-0 mb-4">
          <button 
            onClick={() => setView('generate')}
            className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-400 rounded-full flex items-center justify-center text-white shadow-lg shadow-teal-500/30 hover:scale-110 transition-transform duration-300"
          >
            <SparklesIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col gap-4 w-full px-2 justify-center">
          {items.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id as ViewMode)}
                className="group relative flex items-center justify-center w-full"
              >
                <div className={`
                  w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 relative
                  ${isActive ? 'bg-teal-600 text-white shadow-lg shadow-teal-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}
                `}>
                  <item.icon className="w-5 h-5" />
                  {item.count ? (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white rounded-full border-2 border-white bg-rose-500">
                      {item.count}
                    </span>
                  ) : null}
                </div>

                <div className="absolute left-full ml-4 px-3 py-1.5 bg-slate-800 text-white text-xs font-bold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl z-50">
                  {item.label}
                  <div className="absolute top-1/2 -left-1 -mt-1 w-2 h-2 bg-slate-800 rotate-45" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="shrink-0 mt-4 pt-4 border-t border-slate-100 w-full flex flex-col items-center justify-center">
          <button 
            onClick={handleProfileClick}
            className={`w-10 h-10 rounded-full overflow-hidden border transition-colors relative group ${user ? 'border-teal-600' : 'border-slate-200 hover:border-teal-400'}`}
            title={user ? `${user.email} (Click to logout)` : "Login"}
          >
            {user ? (
              <div className="w-full h-full bg-teal-600 text-white flex items-center justify-center text-xs font-bold">
                {user.email?.charAt(0).toUpperCase()}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400">
                <UserCircleIcon className="w-6 h-6" />
              </div>
            )}
            
            <div className="absolute left-full ml-4 px-3 py-1.5 bg-slate-800 text-white text-xs font-bold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl z-50">
              {user ? 'Sign Out' : 'Log In'}
              <div className="absolute top-1/2 -left-1 -mt-1 w-2 h-2 bg-slate-800 rotate-45" />
            </div>
          </button>
        </div>
      </nav>

      <nav className="md:hidden fixed bottom-4 left-4 right-4 bg-white/90 backdrop-blur-2xl border border-white/40 shadow-2xl z-50 rounded-3xl p-1.5 overflow-x-auto no-scrollbar">
        <div className="flex justify-between items-center px-1 gap-1">
          {items.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id as ViewMode)}
                className={`flex flex-col items-center justify-center min-w-[96px] py-2 rounded-2xl transition-all ${
                  isActive ? 'bg-slate-50' : ''
                }`}
              >
                <div className="relative mb-1">
                  <item.icon className={`w-6 h-6 ${isActive ? 'text-teal-600' : 'text-slate-400'}`} />
                  {item.count ? (
                    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 flex items-center justify-center text-[9px] font-bold text-white rounded-full border-2 border-white bg-rose-500">
                      {item.count}
                    </span>
                  ) : null}
                </div>
                <span className={`text-[10px] font-bold ${isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default Navigation;
