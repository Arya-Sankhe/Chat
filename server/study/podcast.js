import { HttpError } from "../http/responses.js";
import { resolveProvider } from "../providers.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { deleteReservedUpload, mapStorageRpcError } from "../saas/storageQuota.js";
import { loadGenerationSourceText, sourceFallbackTitle, streamComplete } from "./generate.js";
import { joinMp3, readMp3, silence } from "./mp3.js";

// Kokoro via OpenRouter. ":floor" routes to the cheapest host (DeepInfra, $0.62/M chars vs
// Together at $4/M). OpenRouter's speech endpoint ignores `provider.only` today; we still send
// it so DeepInfra-only routing is enforced as soon as it is honoured.
export const TTS_MODEL = "hexgrad/kokoro-82m:floor";
export const TTS_PROVIDER = { only: ["deepinfra"], allow_fallbacks: false };
export const TTS_CREDITS_PER_CHAR = 0.62 / 1_000_000;
const TTS_CONCURRENCY = 10;
const TTS_TIMEOUT_MS = 60_000;

// The best-rated English Kokoro voices (see hexgrad/Kokoro-82M VOICES.md), each with a fixed host name.
export const PODCAST_VOICES = [
  { id: "af_heart", name: "Maya" },
  { id: "af_bella", name: "Bella" },
  { id: "bf_emma", name: "Emma" },
  { id: "am_michael", name: "Michael" },
  { id: "am_fenrir", name: "Finn" },
  { id: "am_puck", name: "Leo" }
];
export const DEFAULT_PODCAST_VOICES = ["af_heart", "am_michael"];

export const PODCAST_STYLES = {
  casual: {
    roles: ["host", "co-host"],
    guide: "Casual: two friends chatting. Warm and relaxed with real humor: playful analogies, light banter, a callback joke. Every joke must help the idea stick (a funny analogy, a mnemonic, a vivid example) and never replaces content. Aim for one light moment per concept."
  },
  professional: {
    roles: ["lead host", "co-host"],
    guide: "Professional: a polished, well-structured briefing. The lead host signposts clearly (first, the key distinction, the takeaway) and the co-host adds precise follow-up questions and crisp summaries. Confident and efficient. No filler, no jokes."
  },
  tutor: {
    roles: ["teacher", "student"],
    guide: "Teacher and student: the teacher is an expert who explains clearly; the student is bright and preparing for an exam. The student asks the questions a real learner would, tries to explain ideas in their own words, and sometimes offers a plausible misunderstanding that the teacher warmly corrects and explains why. The teacher checks understanding with quick questions. Encouraging throughout."
  },
  recall: {
    roles: ["coach", "learner"],
    guide: "Exam prep: active recall practice. For each concept the coach frames it in a sentence or two, then asks an exam-style question aimed at the listener and tells them to pause and answer in their head. Put a line containing only PAUSE right after each question (it becomes a few seconds of thinking time). Then the learner answers, and the coach confirms the answer with the reasoning and a memory hook. Mix recall, application, and compare-and-contrast questions. Finish with a rapid-fire round of five quick questions, each followed by PAUSE and its answer."
  }
};

// Kokoro speaks about 160 words a minute including the gaps between turns; the script model
// tends to run ~20% long on short episodes, so the quick target sits below 4 x 160.
export const PODCAST_LENGTHS = {
  quick: { minutes: 4, words: 540, concepts: "2 to 3", maxTokens: 3000 },
  standard: { minutes: 9, words: 1450, concepts: "3 to 5", maxTokens: 6000 },
  deep: { minutes: 15, words: 2400, concepts: "5 to 7", maxTokens: 9000 }
};

const PAUSE_SECONDS = 3.5;
const TURN_GAP_SECONDS = 0.15;

export function normalizePodcastOptions(body = {}) {
  const style = Object.hasOwn(PODCAST_STYLES, body.style) ? body.style : "casual";
  const length = Object.hasOwn(PODCAST_LENGTHS, body.length) ? body.length : "standard";
  const known = new Set(PODCAST_VOICES.map((voice) => voice.id));
  const picked = (Array.isArray(body.voices) ? body.voices : [body.voiceA, body.voiceB]).map((id) => String(id || ""));
  let voices = picked.filter((id) => known.has(id)).slice(0, 2);
  if (voices.length !== 2 || voices[0] === voices[1]) {
    voices = [voices[0] || DEFAULT_PODCAST_VOICES[0]];
    voices.push(voices[0] === DEFAULT_PODCAST_VOICES[1] ? DEFAULT_PODCAST_VOICES[0] : DEFAULT_PODCAST_VOICES[1]);
  }
  const focus = typeof body.focus === "string" ? body.focus.trim().slice(0, 1000) : "";
  return { style, length, voices: voices.map((id) => PODCAST_VOICES.find((voice) => voice.id === id)), focus };
}

export function podcastSystemPrompt({ style, length, voices, focus }) {
  const plan = PODCAST_LENGTHS[length];
  const { roles, guide } = PODCAST_STYLES[style];
  const [a, b] = voices;
  return `You write the script for a two-person educational audio episode built from a student's study material. It is read aloud by text-to-speech, so write for the ear.

Speakers: A is ${a.name}, the ${roles[0]}. B is ${b.name}, the ${roles[1]}.
Style: ${guide}
Length: about ${plan.words} words of dialogue (roughly ${plan.minutes} minutes). Hit this length.

Make it high-yield. Before writing, pick the ${plan.concepts} most important, most testable ideas in the material and put them in a logical order. For each idea: explain it in plain language, give a concrete example or analogy, say why it matters or how it is usually tested, and where the material supports it, clear up a common confusion or a pair of ideas students mix up. Use and define the material's key terms. If the material is thin, go deeper on fewer ideas rather than padding.
Shape: open with a one-line hook that makes the topic matter and a one-sentence roadmap; work through the ideas; close with a recap of the three to five takeaways the listener should remember and one thing to review next.
${focus ? `The student asked to focus on: ${focus}\nPrioritise this, but keep the explanation complete and accurate.\n` : ""}
Rules for speech:
- Plain spoken sentences only: no markdown, lists, headings, emojis, sound effects, stage directions, or anything in brackets or parentheses.
- Say symbols and abbreviations as words (percent, for example, versus), expand an acronym the first time, and write formulas and units the way a person would say them.
- Every turn is one to four sentences, about 15 to 70 words. Never write a one- or two-word turn; fold reactions such as "Exactly" into the start of a fuller turn.
- Use names now and then, not in every line. Do not mention documents, files, slides, pages, sources, or being an AI.
- Only state facts supported by the material.

Output exactly this format and nothing else:
TITLE: <episode title, at most 8 words>
A: <line>
B: <line>
...`;
}

const WORD_SWAPS = [
  [/\be\.g\.,?/gi, "for example,"],
  [/\bi\.e\.,?/gi, "that is,"],
  [/\betc\./gi, "and so on"],
  [/\bvs\.?(?=\s)/gi, "versus"],
  [/&/g, " and "],
  [/%/g, " percent"],
  [/→|->/g, " leads to "],
  [/\s[–—]\s/g, ", "]
];

// Make a line safe for TTS: no markup, stage directions, emojis, or bare symbols.
export function speakable(text) {
  let out = String(text || "")
    .replace(/\[[^\]]*\]|\([^)]*\b(?:laugh|chuckle|pause|sigh|music|beat)[^)]*\)/gi, " ")
    .replace(/https?:\/\/\S+/g, " ");
  for (const [pattern, replacement] of WORD_SWAPS) out = out.replace(pattern, replacement);
  return out
    .replace(/[*_#`~^|<>{}]/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePodcastScript(text) {
  let title = "";
  const turns = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*>]+\s*/, "").replace(/\*\*/g, "").trim();
    if (!line) continue;
    const heading = line.match(/^title\s*:\s*(.+)$/i);
    if (heading && !turns.length) {
      title = speakable(heading[1]).replace(/^["']|["']$/g, "").slice(0, 120);
      continue;
    }
    if (/^\(?pause\)?\.?$/i.test(line)) {
      if (turns.length && !turns.at(-1).pause) turns.push({ pause: true });
      continue;
    }
    const spoken = line.match(/^(A|B)\s*[:：]\s*(.+)$/i);
    if (!spoken) continue;
    const speaker = spoken[1].toUpperCase() === "A" ? 0 : 1;
    let body = spoken[2];
    if (/^\(?pause\)?\.?$/i.test(body.trim())) {
      if (turns.length && !turns.at(-1).pause) turns.push({ pause: true });
      continue;
    }
    const trailingPause = /\s+PAUSE\.?$/.test(body);
    body = speakable(body.replace(/\s+PAUSE\.?$/, ""));
    if (!body) continue;
    const last = turns.at(-1);
    if (last && !last.pause && last.speaker === speaker) last.text = `${last.text} ${body}`;
    else turns.push({ speaker, text: body });
    if (trailingPause) turns.push({ pause: true });
  }
  while (turns.at(-1)?.pause) turns.pop();
  return { title, turns };
}

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

// Kokoro sounds best at roughly 100-200 tokens (about 18-40 words): it stumbles on very short
// inputs and rushes long ones. Group whole sentences into chunks in that range.
export function chunkForSpeech(text, { max = 40, min = 8 } = {}) {
  const sentences = String(text).match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) || [];
  const pieces = sentences.flatMap((sentence) => {
    if (wordCount(sentence) <= max) return [sentence];
    // Very long sentence: break at clause punctuation.
    const parts = [];
    let current = "";
    for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
      if (current && wordCount(`${current} ${clause}`) > max) {
        parts.push(current);
        current = clause;
      } else current = current ? `${current} ${clause}` : clause;
    }
    if (current) parts.push(current);
    return parts;
  });
  const chunks = [];
  for (const piece of pieces) {
    const last = chunks.at(-1);
    const merged = last ? wordCount(`${last} ${piece}`) : Infinity;
    if (last && (merged <= max || (wordCount(last) < min && merged <= max * 1.5))) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  const tail = chunks.length > 1 ? `${chunks.at(-2)} ${chunks.at(-1)}` : "";
  if (tail && wordCount(chunks.at(-1)) < min && wordCount(tail) <= max * 1.5) chunks.splice(-2, 2, tail);
  return chunks;
}

const DEEPINFRA_TTS_URL = "https://api.deepinfra.com/v1/openai/audio/speech";
const DEEPINFRA_TTS_MODEL = "hexgrad/Kokoro-82M";

// DeepInfra directly when configured (OpenRouter's speech route adds seconds of latency);
// otherwise OpenRouter's ":floor" route, which also lands on DeepInfra.
function speechRoute(config) {
  const direct = config?.providers?.deepinfra?.apiKey;
  if (direct) return { url: DEEPINFRA_TTS_URL, apiKey: direct, model: DEEPINFRA_TTS_MODEL, extra: {} };
  const provider = resolveProvider("openrouter", config);
  return { url: `${provider.baseUrl}/audio/speech`, apiKey: provider.apiKey, model: TTS_MODEL, extra: { provider: TTS_PROVIDER } };
}

export async function synthesizeSpeech({ config, text, voice, speed = 1, signal, fetchImpl = fetch }) {
  const route = speechRoute(config);
  const pace = Number(speed) || 1;
  const body = JSON.stringify({ model: route.model, input: text, voice, response_format: "mp3", ...(pace !== 1 ? { speed: pace } : {}), ...route.extra });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timeout = AbortSignal.timeout(TTS_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(route.url, {
        method: "POST",
        headers: { authorization: `Bearer ${route.apiKey}`, "content-type": "application/json" },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === 2) throw new HttpError(502, "Could not record the podcast audio. Try again.");
      continue;
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    await response.body?.cancel().catch(() => {});
    if ((response.status !== 429 && response.status < 500) || attempt === 2) {
      throw new HttpError(502, "Could not record the podcast audio. Try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw new HttpError(502, "Could not record the podcast audio. Try again.");
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

// Records every chunk, then stitches the episode together and times each transcript line.
export async function recordPodcast({ config, turns, voices, signal, onProgress, tts = synthesizeSpeech, onFirstAudio }) {
  const jobs = [];
  turns.forEach((turn, index) => {
    if (turn.pause) return;
    for (const text of chunkForSpeech(turn.text)) jobs.push({ index, text, voice: voices[turn.speaker].id });
  });
  if (!jobs.length) throw new HttpError(502, "The podcast script came back empty. Try again.");
  let done = 0;
  let first = true;
  const clips = await mapPool(jobs, TTS_CONCURRENCY, async (job) => {
    const audio = await tts({ config, text: job.text, voice: job.voice, signal });
    if (first) {
      first = false;
      await onFirstAudio?.();
    }
    done += 1;
    onProgress?.(done / jobs.length);
    try {
      return readMp3(audio);
    } catch {
      throw new HttpError(502, "Could not record the podcast audio. Try again.");
    }
  });
  const parts = [];
  const transcript = [];
  let clock = 0;
  let previous = null;
  let cursor = 0;
  turns.forEach((turn, index) => {
    const sample = clips[Math.min(cursor, clips.length - 1)];
    if (turn.pause) {
      const gap = silence(sample, PAUSE_SECONDS);
      parts.push(gap);
      transcript.push({ pause: true, start: round(clock), end: round(clock + gap.seconds) });
      clock += gap.seconds;
      previous = null;
      return;
    }
    if (previous !== null && previous !== turn.speaker) {
      const gap = silence(sample, TURN_GAP_SECONDS);
      parts.push(gap);
      clock += gap.seconds;
    }
    const start = clock;
    while (cursor < jobs.length && jobs[cursor].index === index) {
      parts.push(clips[cursor]);
      clock += clips[cursor].seconds;
      cursor += 1;
    }
    transcript.push({ speaker: turn.speaker, text: turn.text, start: round(start), end: round(clock) });
    previous = turn.speaker;
  });
  return {
    audio: joinMp3(parts),
    transcript,
    seconds: round(clock),
    characters: jobs.reduce((sum, job) => sum + job.text.length, 0)
  };
}

function round(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

function audioFileName(title) {
  const base = String(title || "Podcast").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Podcast";
  return `${base}.mp3`;
}

async function storePodcastAudio({ context, course, audio, title, signal }) {
  const fileName = audioFileName(title);
  let attachment = null;
  try {
    attachment = await context.db.reserveAttachment({
      userId: context.user.id,
      maxBytes: context.plan.maxStorageBytes,
      category: "document",
      objectKey: context.r2.objectKey({ userId: context.user.id, fileName }),
      fileName,
      contentType: "audio/mpeg",
      sizeBytes: audio.length,
      projectId: course.id
    }, { signal });
    const uploaded = await context.r2.putObject(attachment.object_key, audio, { contentType: "audio/mpeg", signal });
    await context.db.completeReservedAttachment({
      userId: context.user.id,
      attachmentId: attachment.id,
      sizeBytes: audio.length,
      etag: uploaded?.etag || null,
      maxBytes: context.plan.maxStorageBytes
    }, { signal });
    return attachment;
  } catch (error) {
    // Clean up even when the request was cancelled mid-upload.
    if (attachment) await deleteReservedUpload(context, attachment).catch(() => {});
    mapStorageRpcError(error);
  }
}

export async function generatePodcast({
  context,
  config,
  course,
  source,
  options = {},
  signal,
  onWarning,
  onStage,
  complete = streamComplete,
  tts = synthesizeSpeech
}) {
  const settings = normalizePodcastOptions(options);
  onStage?.("preparing");
  const text = await loadGenerationSourceText({ context, config, source, signal, onWarning, onStage });
  onStage?.("writing script");
  const streamed = await complete({
    context,
    config,
    signal,
    maxTokens: PODCAST_LENGTHS[settings.length].maxTokens,
    temperature: 0.7,
    system: podcastSystemPrompt(settings),
    user: text,
    expect: "markdown"
  });
  const script = parsePodcastScript(streamed.content);
  if (script.turns.filter((turn) => !turn.pause).length < 4) throw new HttpError(502, "The podcast script came back too short. Try again.");
  const title = script.title || sourceFallbackTitle(source) || "Podcast";

  onStage?.("recording 0%");
  const provider = resolveProvider("openrouter", config);
  const meter = createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: 0.05
  });
  let shown = 0;
  const recorded = await meter.runReserved({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    providerId: "openrouter",
    body: { model: TTS_MODEL },
    signal
  }, async ({ markSubmitted }) => {
    const result = await recordPodcast({
      config,
      turns: script.turns,
      voices: settings.voices,
      signal,
      tts,
      onFirstAudio: () => markSubmitted(),
      onProgress: (share) => {
        const step = Math.floor(share * 10) * 10;
        if (step > shown) {
          shown = step;
          onStage?.(`recording ${step}%`);
        }
      }
    });
    return { result, usage: { cost: result.characters * TTS_CREDITS_PER_CHAR, characters: result.characters } };
  });

  onStage?.("saving");
  const attachment = await storePodcastAudio({ context, course, audio: recorded.audio, title, signal });
  try {
    const podcast = await context.db.createStudyPodcast(context.user.id, {
      project_id: course.id,
      attachment_id: attachment.id,
      title,
      style: settings.style,
      length: settings.length,
      voices: settings.voices,
      transcript: recorded.transcript,
      duration_seconds: recorded.seconds
    }, { signal });
    return { podcast, partial: Boolean(streamed.partial) };
  } catch (error) {
    await deleteReservedUpload(context, attachment).catch(() => {});
    throw error;
  }
}
