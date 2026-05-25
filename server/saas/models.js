const VISION_HINT = /\bvision\b|\bvisual\b|\bvlm\b|multimodal|omni|\bimage\b|gpt-4o|gpt-4\.1|gpt-5|o3|o4|gemini|gemma-?3|claude-(3|4)|sonnet|opus|haiku|qwen[\w.-]*vl|qwen2-vl|qwen3-vl|llama-?4|llama-3\.2[\w.-]*vision|internvl|molmo|minicpm|llava|pixtral|kimi|moonshot|grok|x-ai|glm-4[\w.-]*v|\bgreg\b/i;

function modalityText(value) {
  if (Array.isArray(value)) return value.join(" ");
  if (value && typeof value === "object") return Object.values(value).map(modalityText).join(" ");
  return String(value || "");
}

export function modelSupportsVision(modelOrId) {
  const id = typeof modelOrId === "string" ? modelOrId : modelOrId?.id || "";
  const name = typeof modelOrId === "string" ? "" : `${modelOrId?.rawName || ""} ${modelOrId?.name || ""}`;
  const modalities = typeof modelOrId === "string"
    ? ""
    : modalityText({
        input_modalities: modelOrId?.input_modalities,
        modalities: modelOrId?.modalities,
        architecture: modelOrId?.architecture,
        raw: modelOrId?.raw?.architecture
      });
  const haystack = `${id} ${name} ${modalities}`.trim().toLowerCase();
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
