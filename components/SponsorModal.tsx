
import React, { useState } from 'react';
import { XMarkIcon, MegaphoneIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import { submitSponsorshipInquiry } from '../services/analyticsService';

interface SponsorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SponsorModal: React.FC<SponsorModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [budget, setBudget] = useState('1k-5k');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await submitSponsorshipInquiry(email, company, budget);
      setIsSuccess(true);
    } catch (e) {
      alert("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in">
        <div className="bg-white rounded-3xl w-full max-w-sm p-8 text-center shadow-2xl relative">
           <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><XMarkIcon className="w-6 h-6" /></button>
           <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
             <CheckCircleIcon className="w-10 h-10" />
           </div>
           <h2 className="text-xl font-black text-slate-800 mb-2">Inquiry Received</h2>
           <p className="text-sm text-slate-500 mb-6">Our partnerships team will contact {email} within 24 hours.</p>
           <button onClick={onClose} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-sm">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>

        <div className="p-8 pt-10">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-600">
              <MegaphoneIcon className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black text-slate-800">Partner with MediPrep</h2>
            <p className="text-slate-500 text-sm mt-1">
              Reach thousands of active medical students. High engagement, targeted placement.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase ml-1 block mb-1">Work Email</label>
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-medium text-sm"
                placeholder="name@company.com"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase ml-1 block mb-1">Company Name</label>
              <input 
                type="text" 
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-medium text-sm"
                placeholder="e.g. UWorld, Figs..."
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase ml-1 block mb-1">Est. Monthly Budget</label>
              <select 
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-medium text-sm"
              >
                <option value="<1k">Under $1,000</option>
                <option value="1k-5k">$1,000 - $5,000</option>
                <option value="5k-10k">$5,000 - $10,000</option>
                <option value="10k+">$10,000+</option>
              </select>
            </div>

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 active:scale-95 flex items-center justify-center gap-2 mt-4"
            >
              {isSubmitting ? 'Sending...' : 'Request Media Kit'}
            </button>
          </form>
          
          <p className="text-[10px] text-center text-slate-400 mt-4">
             Average CTR: 4.2% • Audience: US Medical Students (MD/DO)
          </p>
        </div>
      </div>
    </div>
  );
};

export default SponsorModal;
