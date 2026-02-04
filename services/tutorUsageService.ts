import { supabase } from './supabaseClient';

export type TutorUsageEventType = 'open' | 'message_sent' | 'response_received' | 'error';
export type TutorUsageLocation = 'practice' | 'remediation' | 'deep_dive' | 'other';

export interface TutorUsageEvent {
  userId?: string;
  sessionId?: string | null;
  questionId?: string | null;
  guideHash?: string | null;
  sourceType?: string | null;
  model?: string | null;
  location: TutorUsageLocation;
  eventType: TutorUsageEventType;
}

export interface TutorUsageSummary {
  since: string;
  totalOpens: number;
  totalMessages: number;
  totalResponses: number;
  totalErrors: number;
  uniqueUsers: number;
  byLocation: Record<TutorUsageLocation, number>;
}

export const trackTutorUsage = async (event: TutorUsageEvent) => {
  try {
    const userId = event.userId || (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;
    await supabase.from('tutor_usage_events').insert({
      user_id: userId,
      event_type: event.eventType,
      location: event.location,
      model: event.model || null,
      question_id: event.questionId || null,
      guide_hash: event.guideHash || null,
      source_type: event.sourceType || null,
      session_id: event.sessionId || null
    });
  } catch (err) {
    console.warn('Tutor usage tracking failed', err);
  }
};

export const fetchTutorUsageSummary = async (days?: number): Promise<TutorUsageSummary | null> => {
  const since = typeof days === 'number'
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    : null;
  let query = supabase
    .from('tutor_usage_events')
    .select('user_id,event_type,location,created_at');
  if (since) {
    query = query.gte('created_at', since);
  }
  const { data, error } = await query;

  if (error) throw error;
  const rows = (data || []) as Array<{ user_id: string; event_type: string; location: TutorUsageLocation }>;
  const byLocation: TutorUsageSummary['byLocation'] = {
    practice: 0,
    remediation: 0,
    deep_dive: 0,
    other: 0
  };

  let totalOpens = 0;
  let totalMessages = 0;
  let totalResponses = 0;
  let totalErrors = 0;
  const users = new Set<string>();

  rows.forEach((row) => {
    users.add(row.user_id);
    if (row.event_type === 'open') totalOpens += 1;
    if (row.event_type === 'message_sent') totalMessages += 1;
    if (row.event_type === 'response_received') totalResponses += 1;
    if (row.event_type === 'error') totalErrors += 1;
    const location = row.location || 'other';
    if (location in byLocation) {
      byLocation[location] += 1;
    } else {
      byLocation.other += 1;
    }
  });

  return {
    since: since || 'all',
    totalOpens,
    totalMessages,
    totalResponses,
    totalErrors,
    uniqueUsers: users.size,
    byLocation
  };
};
