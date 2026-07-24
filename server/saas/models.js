const VISION_HINT = /\bvision\b|\bvisual\b|\bvlm\b|multimodal|omni|gpt-4o|gpt-4\.1|gpt-5|o3|o4|gemini|gemma|claude-(3|4)|sonnet|opus|haiku|qwen[\w.-]*vl|qwen2-vl|qwen3-vl|llama-?4|llama-3\.2[\w.-]*vision|internvl|molmo|minicpm|llava|pixtral|kimi|moonshot|grok|x-ai|glm-4[\w.-]*v|mimo-v2\.5(?!-pro)|mimo-v2-omni|minimax|\bgreg\b/i;

/* Extract only input-side modality tokens from a model descriptor.
   Reading output modalities (e.g. image-generation models) would
   produce false positives, so we strictly walk known input paths. */
function inputModalityTokens(model) {
  if (!model || typeof model !== "object") return [];
  const sources = [
    model.input_modalities,
    model.modalities,
    model.architecture?.input_modalities,
    model.architecture?.modality,
    model.raw?.architecture?.input_modalities,
    model.raw?.architecture?.modality
  ];
  const tokens = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const item of source) tokens.push(String(item || ""));
    } else if (typeof source === "string") {
      tokens.push(source);
    }
  }
  return tokens.map((token) => token.toLowerCase());
}

function hasImageInputModality(model) {
  if (typeof model === "string") return false;
  return inputModalityTokens(model).some((token) => /image|vision|visual|photo|picture/.test(token));
}

export function modelSupportsVision(modelOrId) {
  if (hasImageInputModality(modelOrId)) return true;
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId?.id || "";
  const name = typeof modelOrId === "string" ? "" : `${modelOrId?.rawName || ""} ${modelOrId?.name || ""}`;
  const haystack = `${id} ${name}`.trim().toLowerCase();
  return VISION_HINT.test(haystack);
}

export function resolveVisionDescribeModel(config, modelIds = [], catalog = []) {
  if (config.visionDescribeModel) return config.visionDescribeModel;

  for (const id of modelIds) {
    if (/kimi|moonshot/i.test(id)) return id;
  }

  for (const model of catalog) {
    if (/kimi|moonshot/i.test(`${model?.id || ""} ${model?.name || ""}`)) return model.id;
  }

  return "kimi-k2.6";
}
