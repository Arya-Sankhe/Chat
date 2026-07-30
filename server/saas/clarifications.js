import { OPENROUTER_LAGUNA_XS } from "../providers.js";

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 4;

export function normalizeClarifications(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    const json = parsed.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return [];
    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed?.questions)) return [];
  return parsed.questions.slice(0, MAX_QUESTIONS).flatMap((entry) => {
    const question = String(entry?.question || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const options = [...new Set((Array.isArray(entry?.options) ? entry.options : [])
      .map((option) => String(option || "").replace(/\s+/g, " ").trim().slice(0, 180))
      .filter(Boolean))]
      .slice(0, MAX_OPTIONS);
    return question && options.length >= 2 ? [{ question, options }] : [];
  });
}

export async function generateClarifications({ query, mode, crofai, config, signal }) {
  const provider = config?.providers?.openrouter;
  if (!provider?.apiKey || !crofai?.chatCompletion) return [];
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  const content = await crofai.chatCompletion({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    providerId: "openrouter",
    signal: callSignal,
    body: {
      model: OPENROUTER_LAGUNA_XS,
      messages: [
        {
          role: "system",
          content: `Decide whether the user's ${mode === "research" ? "Deep Research" : "chat"} request needs clarification before work starts.
Return JSON only: {"questions":[{"question":"...","options":["recommended first","alternative"]}]}.
Ask 1-3 short, decision-changing questions with 2-4 mutually exclusive, concise options each. Put the safest useful default first.
For Deep Research, usually ask about scope, timeframe, geography, audience, or desired comparison—but only where the request leaves it open.
For normal chat, return {"questions":[]} unless the request is too vague to answer usefully without guessing.
Never ask for information already present. Never ask cosmetic preferences the assistant can infer.`
        },
        { role: "user", content: String(query || "").slice(0, 6000) }
      ],
      temperature: 0.1,
      max_tokens: 420
    }
  });
  return normalizeClarifications(content);
}
