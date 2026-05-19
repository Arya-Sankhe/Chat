const VISION_HINT = /\bvision\b|multimodal|gpt-4o|gpt-4\.1|gemini|claude-3|qwen-vl|qwen2-vl|qwen3-vl|llava|pixtral|kimi|moonshot/i;

export function modelSupportsVision(modelOrId) {
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
