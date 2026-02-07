import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('Missing .env.local. Set XAI_API_KEY first.');
  process.exit(1);
}

const envText = fs.readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const idx = line.indexOf('=');
      if (idx === -1) return [line, ''];
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const apiKey = env.XAI_API_KEY || env.VITE_XAI_API_KEY;
const model = env.VITE_XAI_MODEL || 'grok-4-1-fast-reasoning';

if (!apiKey) {
  console.error('XAI_API_KEY missing in .env.local');
  process.exit(1);
}

const callXai = async (messages, temperature = 0.2) => {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature
    })
  });

  const json = await response.json();
  if (!response.ok) {
    console.error('xAI error:', JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
};

const promptStartDeepDive = (topicContext, concept, count) => `
Act as an elite medical professor.
Context: ${topicContext}.
Target Concept: "${concept}".

Task 1: Create a structured lesson using ONLY Markdown. Use tables for comparisons. No HTML.
Task 2: Create a progressive ${count}-question quiz.
- Start with basic recall/concepts.
- Progress to complex clinical vignettes (USMLE Style).

Return ONLY valid JSON with keys: lessonContent (string) and quiz (array).
`;

const promptExtendDeepDive = (topicContext, concept, count) => `
Act as an elite medical professor.
Context: ${topicContext}.
Target Concept: "${concept}".

Task: Generate ${count} NEW practice questions to test this concept further.
- Ensure questions are distinct from standard basic questions.
- Focus on high-yield board vignettes.

Return ONLY valid JSON with a 'quiz' array.
`;

const summarizeUsage = (usage) => {
  if (!usage) return null;
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens
  };
};

const runScenario = async (label, topicContext, concept) => {
  console.log(`\n=== ${label} ===`);
  const startMessages = [
    { role: 'system', content: 'You are a precise medical educator. Output only JSON.' },
    { role: 'user', content: promptStartDeepDive(topicContext, concept, 3) }
  ];
  const startResp = await callXai(startMessages, 0.2);
  console.log('Start Deep Dive usage:', summarizeUsage(startResp.usage) || 'No usage returned');

  const extendMessages = [
    { role: 'system', content: 'You are a precise medical educator. Output only JSON.' },
    { role: 'user', content: promptExtendDeepDive(topicContext, concept, 5) }
  ];
  const extendResp = await callXai(extendMessages, 0.2);
  console.log('Extend Deep Dive usage:', summarizeUsage(extendResp.usage) || 'No usage returned');
};

const main = async () => {
  await runScenario('Hematology', 'Hematology Study Guide', 'Iron deficiency anemia');
  await runScenario('Pulmonology', 'Pulmonology Study Guide', 'COPD exacerbation management');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
