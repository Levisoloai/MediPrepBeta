
import React, { useState } from 'react';
import { CheckIcon, StarIcon, ShieldCheckIcon, CreditCardIcon, TicketIcon } from '@heroicons/react/24/solid';
import { simulateSubscriptionUpgrade } from '../services/storageService';

interface PricingViewProps {
  onSuccess: () => void;
  userEmail?: string;
}

const PricingView: React.FC<PricingViewProps> = ({ onSuccess, userEmail }) => {
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [showCoupon, setShowCoupon] = useState(false);
  const [couponCode, setCouponCode] = useState('');

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      // In a real app, this would redirect to a Stripe Checkout URL
      // For this demo, we simulate a successful callback
      await simulateSubscriptionUpgrade();
      onSuccess();
    } catch (e) {
      alert("Payment failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCouponApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;

    const code = couponCode.toUpperCase().trim();
    const validCodes = ['DEVMODE', 'MEDIPREP2025', 'FREEACCESS'];

    if (validCodes.includes(code)) {
        setLoading(true);
        try {
            // Attempt to update the database for persistence
            await simulateSubscriptionUpgrade();
        } catch (error) {
            console.warn("Dev bypass: Database update failed, unlocking locally.", error);
        } finally {
            setLoading(false);
            // Always unlock if code is valid, regardless of DB connection
            onSuccess();
        }
    } else {
        alert("Invalid coupon code.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-5xl w-full bg-white rounded-[3rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col md:flex-row">
        
        {/* Left: Value Prop (Updated to strictly BLACK TEXT on WHITE background) */}
        <div className="md:w-5/12 bg-white p-12 text-black flex flex-col justify-between relative overflow-hidden border-r border-slate-100">
           {/* Subtle Decor Blobs */}
           <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-slate-100 rounded-full blur-[100px] opacity-50" />
           <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-slate-100 rounded-full blur-[100px] opacity-50" />
           
           <div className="relative z-10">
             <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 border border-slate-200 rounded-full text-[10px] font-bold uppercase tracking-widest mb-6 text-slate-800">
                <StarIcon className="w-3 h-3 text-amber-500" /> Premium Access
             </div>
             <h1 className="text-4xl font-black mb-6 leading-tight text-black">Master Your Medical Boards.</h1>
             <p className="text-slate-800 leading-relaxed mb-8 font-medium text-base">
               Unlock the full power of Gemini 3 Pro AI. Generate unlimited questions, access the virtual ward, and create detailed study plans.
             </p>
             
             <ul className="space-y-4">
                {[
                  "Unlimited AI Exam Predictions",
                  "Virtual Ward & Patient Simulation",
                  "Personalized Study Schedules",
                  "NBME & USMLE Style Logic",
                  "Ad-Free Experience"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="p-1.5 rounded-full bg-slate-900 text-white">
                      <CheckIcon className="w-3 h-3" />
                    </div>
                    <span className="font-bold text-sm text-black">{item}</span>
                  </li>
                ))}
             </ul>
           </div>

           <div className="mt-12 pt-8 border-t border-slate-200 relative z-10">
              <div className="flex items-center gap-3">
                 <div className="h-10 w-10 bg-slate-900 text-white rounded-full flex items-center justify-center font-bold text-xs">
                    {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                 </div>
                 <div className="flex-1">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Logged in as</p>
                    <p className="text-sm font-bold truncate text-black">{userEmail}</p>
                 </div>
              </div>
           </div>
        </div>

        {/* Right: Payment Selection */}
        <div className="md:w-7/12 p-12 bg-white flex flex-col justify-center">
           <div className="text-center mb-10">
              <h2 className="text-2xl font-black text-slate-900 mb-2">Select Your Plan</h2>
              <p className="text-slate-500 text-sm font-medium">Cancel anytime. No hidden fees.</p>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {/* Monthly */}
              <div 
                onClick={() => setSelectedPlan('monthly')}
                className={`p-6 rounded-2xl border-2 cursor-pointer transition-all ${selectedPlan === 'monthly' ? 'border-teal-500 bg-teal-50/30' : 'border-slate-100 hover:border-slate-200'}`}
              >
                 <div className="flex justify-between items-start mb-4">
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Monthly</span>
                    {selectedPlan === 'monthly' && <div className="w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center text-white"><CheckIcon className="w-3 h-3" /></div>}
                 </div>
                 <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-slate-900">$19</span>
                    <span className="text-sm text-slate-500 font-bold">/mo</span>
                 </div>
              </div>

              {/* Yearly */}
              <div 
                onClick={() => setSelectedPlan('yearly')}
                className={`p-6 rounded-2xl border-2 cursor-pointer transition-all relative overflow-hidden ${selectedPlan === 'yearly' ? 'border-indigo-500 bg-indigo-50/30' : 'border-slate-100 hover:border-slate-200'}`}
              >
                 <div className="absolute top-0 right-0 bg-indigo-500 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest">
                    Best Value
                 </div>
                 <div className="flex justify-between items-start mb-4">
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Yearly</span>
                    {selectedPlan === 'yearly' && <div className="w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center text-white"><CheckIcon className="w-3 h-3" /></div>}
                 </div>
                 <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-slate-900">$12</span>
                    <span className="text-sm text-slate-500 font-bold">/mo</span>
                 </div>
                 <div className="mt-2 text-[10px] font-bold text-indigo-700 bg-indigo-100 inline-block px-2 py-0.5 rounded">
                    Billed $144 yearly
                 </div>
              </div>
           </div>

           <button 
             onClick={handleUpgrade}
             disabled={loading}
             className={`w-full py-5 rounded-2xl font-black text-white text-sm uppercase tracking-widest shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${selectedPlan === 'yearly' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-200'}`}
           >
             {loading ? (
                <>Processing...</>
             ) : (
                <>
                   <CreditCardIcon className="w-5 h-5" /> 
                   Upgrade to {selectedPlan === 'yearly' ? 'Pro Yearly' : 'Pro Monthly'}
                </>
             )}
           </button>

           <div className="mt-6 flex flex-col items-center gap-4">
              <div className="flex items-center justify-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                 <ShieldCheckIcon className="w-4 h-4 text-slate-300" />
                 Secure Payment via Stripe
              </div>

              {/* Coupon Section */}
              <div className="w-full max-w-xs mx-auto">
                 {!showCoupon ? (
                    <button 
                       onClick={() => setShowCoupon(true)}
                       className="text-xs text-slate-400 hover:text-indigo-600 underline font-bold w-full text-center"
                    >
                       Have a coupon code?
                    </button>
                 ) : (
                    <form onSubmit={handleCouponApply} className="flex gap-2 animate-in fade-in slide-in-from-bottom-2">
                       <div className="relative flex-1">
                          <TicketIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                          <input 
                             type="text" 
                             value={couponCode}
                             onChange={(e) => setCouponCode(e.target.value)}
                             placeholder="Promo Code"
                             className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none uppercase"
                          />
                       </div>
                       <button 
                          type="submit"
                          disabled={loading || !couponCode}
                          className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-700 disabled:opacity-50"
                       >
                          Apply
                       </button>
                    </form>
                 )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default PricingView;
