
export interface UsageStats {
  totalInput: number;
  totalOutput: number;
  totalRequests: number;
  estimatedCost: number;
}

// Estimated pricing per 1M tokens
// Based on User Provided Data for Gemini 3 Series
const PRICING = {
  flash: { 
    input: 0.50, 
    output: 3.00 
  },
  pro: { 
    // <= 200k context
    inputStandard: 2.00, 
    outputStandard: 12.00,
    // > 200k context
    inputHigh: 4.00,
    outputHigh: 18.00
  }
};

const STORAGE_KEY = 'mediprep_dev_usage_stats';

export const getUsageStats = (): UsageStats => {
  if (typeof window === 'undefined') return { totalInput: 0, totalOutput: 0, totalRequests: 0, estimatedCost: 0 };
  
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored 
    ? JSON.parse(stored) 
    : { totalInput: 0, totalOutput: 0, totalRequests: 0, estimatedCost: 0 };
};

export const trackUsage = (model: string, inputTokens: number, outputTokens: number) => {
  const current = getUsageStats();
  
  // Determine tier based on model name
  const isPro = model.includes('pro');
  
  let cost = 0;

  if (isPro) {
    // Pro pricing depends on context size of the request
    const isHighContext = inputTokens > 200000;
    const inputRate = isHighContext ? PRICING.pro.inputHigh : PRICING.pro.inputStandard;
    const outputRate = isHighContext ? PRICING.pro.outputHigh : PRICING.pro.outputStandard;
    
    cost = (inputTokens / 1_000_000 * inputRate) + (outputTokens / 1_000_000 * outputRate);
  } else {
    // Flash pricing (Assuming standard text/image/video rate)
    cost = (inputTokens / 1_000_000 * PRICING.flash.input) + (outputTokens / 1_000_000 * PRICING.flash.output);
  }

  const updated: UsageStats = {
    totalInput: current.totalInput + inputTokens,
    totalOutput: current.totalOutput + outputTokens,
    totalRequests: current.totalRequests + 1,
    estimatedCost: current.estimatedCost + cost
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  
  // Dispatch event so UI updates immediately
  window.dispatchEvent(new Event('usage_updated'));
};

export const resetUsageStats = () => {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('usage_updated'));
};
