
import React, { useState, useEffect, useRef } from 'react';
import { InformationCircleIcon, XMarkIcon, SparklesIcon } from '@heroicons/react/24/solid';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { trackAdImpression, trackAdClick } from '../services/analyticsService';

interface AdUnitProps {
  variant?: 'sidebar' | 'card' | 'banner';
  className?: string;
}

// Mock Ad Inventory - In production, this comes from an API
const AD_INVENTORY = [
  {
    id: 1,
    company: "Figs Scrubs",
    title: "The precision of medicine, the comfort of athletics.",
    cta: "Shop the Collection",
    link: "https://www.wearfigs.com", // In real app, this is an affiliate link
    color: "bg-rose-50",
    textColor: "text-rose-900",
    iconColor: "text-rose-500",
    accentColor: "bg-rose-600"
  },
  {
    id: 2,
    company: "Littmann",
    title: "Hear the difference. Cardiology IV Stethoscopes.",
    cta: "View Deal",
    link: "https://www.littmann.com",
    color: "bg-indigo-50",
    textColor: "text-indigo-900",
    iconColor: "text-indigo-500",
    accentColor: "bg-indigo-600"
  },
  {
    id: 3,
    company: "ResidencyMatch",
    title: "Don't gamble with your future. Expert ERAS editing.",
    cta: "Book Consult",
    link: "#",
    color: "bg-teal-50",
    textColor: "text-teal-900",
    iconColor: "text-teal-500",
    accentColor: "bg-teal-600"
  }
];

const AdUnit: React.FC<AdUnitProps> = ({ variant = 'card', className = '' }) => {
  const [ad, setAd] = useState(AD_INVENTORY[0]);
  const [isVisible, setIsVisible] = useState(true);
  const hasLoggedImpression = useRef(false);

  useEffect(() => {
    // Randomize ad on mount
    const randomAd = AD_INVENTORY[Math.floor(Math.random() * AD_INVENTORY.length)];
    setAd(randomAd);
    hasLoggedImpression.current = false;
  }, []);

  // Track Impression when component mounts/updates
  useEffect(() => {
    if (isVisible && !hasLoggedImpression.current) {
      trackAdImpression(ad.id, ad.company, variant);
      hasLoggedImpression.current = true;
    }
  }, [ad, isVisible, variant]);

  const handleClick = () => {
    trackAdClick(ad.id, ad.company, variant);
    // In a real app, window.open(ad.link, '_blank');
  };

  if (!isVisible) return null;

  if (variant === 'sidebar') {
    return (
      <div className={`mx-4 mb-4 p-4 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group ${ad.color} ${className}`}>
        <div className="flex justify-between items-start mb-2">
          <span className="text-[9px] font-black uppercase tracking-widest opacity-50 flex items-center gap-1">
            Sponsored <InformationCircleIcon className="w-3 h-3" />
          </span>
          <button 
            onClick={(e) => { e.stopPropagation(); setIsVisible(false); }}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <XMarkIcon className="w-3 h-3" />
          </button>
        </div>
        
        <div onClick={handleClick} className="cursor-pointer">
          <h4 className={`text-xs font-black ${ad.textColor} mb-1`}>{ad.company}</h4>
          <p className="text-[10px] font-medium leading-snug opacity-80 mb-3">
            {ad.title}
          </p>
          
          <button className={`w-full py-2 rounded-lg text-[10px] font-bold text-white shadow-sm transition-transform active:scale-95 flex items-center justify-center gap-1 ${ad.accentColor}`}>
            {ad.cta} <ArrowTopRightOnSquareIcon className="w-3 h-3" />
          </button>
        </div>

        <div className="mt-3 text-center">
           <button className="text-[9px] font-bold text-slate-400 hover:text-slate-600 hover:underline">
             Remove Ads
           </button>
        </div>
      </div>
    );
  }

  // Card Variant (for Dashboard/Feed)
  return (
    <div className={`p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all ${className}`}>
      <div className={`absolute top-0 right-0 p-2 ${ad.color} rounded-bl-2xl`}>
         <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Ad</span>
      </div>
      
      <div className="flex items-start gap-4 cursor-pointer" onClick={handleClick}>
        <div className={`p-3 rounded-xl ${ad.color} ${ad.iconColor}`}>
           <SparklesIcon className="w-6 h-6" />
        </div>
        <div className="flex-1">
           <h4 className="text-sm font-black text-slate-800">{ad.company}</h4>
           <p className="text-xs text-slate-500 mt-1 leading-relaxed">{ad.title}</p>
           <div className="mt-3 flex items-center gap-3">
              <button className={`px-4 py-1.5 rounded-lg text-[10px] font-bold text-white shadow-sm transition-opacity hover:opacity-90 ${ad.accentColor}`}>
                {ad.cta}
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); setIsVisible(false); }}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-600"
              >
                Hide
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default AdUnit;
