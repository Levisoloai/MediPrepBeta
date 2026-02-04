
import { supabase } from './supabaseClient';

export interface AdEvent {
  adId: number;
  company: string;
  type: 'impression' | 'click';
  timestamp: number;
  location: string;
}

// In a real app, these would be logged to Supabase/PostHog/Google Analytics
export const trackAdImpression = async (adId: number, company: string, location: string) => {
  console.log(`[Ad Impression] ${company} (ID: ${adId}) at ${location}`);
  
  // Example of how you would persist this for reporting:
  /*
  await supabase.from('ad_analytics').insert({
    ad_id: adId,
    event_type: 'impression',
    location: location,
    user_id: supabase.auth.getUser().id
  });
  */
};

export const trackAdClick = async (adId: number, company: string, location: string) => {
  console.log(`[Ad Click] ${company} (ID: ${adId}) at ${location} - $$ Potential Revenue`);
  
  // This is the metric sponsors care about most (CTR)
  /*
  await supabase.from('ad_analytics').insert({
    ad_id: adId,
    event_type: 'click',
    location: location
  });
  */
};

export const submitSponsorshipInquiry = async (email: string, company: string, budget: string) => {
  // Mock API call to your sales CRM or email service
  return new Promise((resolve) => setTimeout(resolve, 1000));
};
