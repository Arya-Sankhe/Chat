import { chatCompletion } from "../crofai/client.js";
import { HttpError } from "../http/responses.js";
import { contentText, imageCountFromContent, streamProviderAndAccumulate } from "./messages.js";
import { modelSupportsVision, resolveVisionDescribeModel } from "./models.js";

export function messagesHaveImages(messages) {
  return (messages || []).some((message) => message?.role === "user" && imageCountFromContent(message.content) > 0);
}

function imageDescription(part) {
  return String(part?.image_url?.description || part?.image_url?.alt_text || "").trim();
}

export function collectImageAttachmentIds(messages, { missingOnly = false } = {}) {
  const ids = [];
  for (const message of messages || []) {
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const attachmentId = part?.image_url?.attachment_id;
      if (missingOnly && imageDescription(part)) continue;
      if (attachmentId && !ids.includes(attachmentId)) ids.push(attachmentId);
    }
  }
  return ids;
}

export function collectImageDescriptions(messages) {
  const descriptions = {};
  for (const message of messages || []) {
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const attachmentId = part?.image_url?.attachment_id;
      const description = imageDescription(part);
      if (attachmentId && description) descriptions[attachmentId] = description;
    }
  }
  return descriptions;
}

export function collectUndescribedImageAttachmentIds(messages) {
  return collectImageAttachmentIds(messages, { missingOnly: true });
}

export function applyImageDescriptionsToContent(content, descriptions = {}) {
  if (!Array.isArray(content)) return content;

  let changed = false;
  const next = content.map((part) => {
    if (part?.type !== "image_url") return part;

    const attachmentId = part.image_url?.attachment_id;
    const description = attachmentId ? String(descriptions[attachmentId] || "").trim() : "";
    if (!description || imageDescription(part)) return part;

    changed = true;
    return {
      ...part,
      image_url: {
        ...part.image_url,
        description
      }
    };
  });

  return changed ? next : content;
}

export function substituteImagesWithDescriptions(content, descriptions) {
  if (typeof content === "string" || !Array.isArray(content)) return content;

  const parts = [];
  for (const part of content) {
    if (part?.type === "text" && part.text) {
      parts.push({ type: "text", text: part.text });
      continue;
    }

    if (part?.type === "image_url") {
      const attachmentId = part.image_url?.attachment_id;
      const fileName = part.image_url?.file_name || "image";
      const description = imageDescription(part) || (attachmentId ? descriptions[attachmentId] : "");
      parts.push({
        type: "text",
        text: description
          ? `[Image (${fileName}): ${description}]`
          : `[Image (${fileName}): image content omitted for a text-only model]`
      });
    }
  }

  if (!parts.length) return "";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

/**
 * Describes all images in a conversation using a single vision model API call.
 * Returns { descriptions: { [attachmentId]: string }, model: string }.
 */
export async function describeConversationImages({
  messages,
  db,
  userId,
  r2,
  config,
  modelIds = [],
  catalog = [],
  attachmentIds = null,
  describeModel = "",
  provider = null,
  chatCompletionFn = chatCompletion,
  streamChatCompletionFn = null,
  signal
}) {
  const ids = Array.isArray(attachmentIds)
    ? attachmentIds.filter((id, index, list) => id && list.indexOf(id) === index)
    : collectImageAttachmentIds(messages);
  if (!ids.length) return { descriptions: {}, model: null };

  const model = describeModel || resolveVisionDescribeModel(config, modelIds, catalog);
  if (!modelSupportsVision(model)) {
    throw new HttpError(503, "No vision model is configured to describe chat images.");
  }

  const attachments = [];
  for (const attachmentId of ids) {
    const attachment = await db.getAttachment(userId, attachmentId, { signal });
    if (!attachment || attachment.status !== "uploaded") {
      throw new HttpError(400, "One of the chat images is not available anymore.");
    }
    attachments.push({ id: attachmentId, attachment });
  }

  const contextParts = [];
  for (const message of messages || []) {
    if (!message?.role || message.role === "tool") continue;
    const text = typeof message.content === "string" ? message.content : contentText(message.content);
    if (text) contextParts.push(`[${message.role}] ${text}`);
  }
  const conversationContext = contextParts.length
    ? `\n\nConversation history:\n${contextParts.join("\n")}`
    : "";

  const contentPayload = [];
  const imageCount = attachments.length;

  const coreInstructions = "Describe this image in full detail for another AI model that cannot see it. You MUST transcribe ALL visible text exactly as written — every word, number, label, header, option, and value. If there is a table, reproduce it row by row with every cell value. If there is a formula or equation, write it out. Do not summarize or paraphrase — transcribe verbatim. Then briefly describe any diagrams, charts, or visual elements.";

  const systemText = imageCount === 1
    ? `${coreInstructions}${conversationContext}`
    : `You will be shown ${imageCount} images from a conversation. For EACH image: ${coreInstructions}\n\nRespond with exactly ${imageCount} descriptions, one per image, in this format:\n[IMAGE_1]\n<description>\n[IMAGE_2]\n<description>\n...and so on for all ${imageCount} images.${conversationContext}`;

  contentPayload.push({ type: "text", text: systemText });

  for (let i = 0; i < attachments.length; i++) {
    const imageUrl = r2.readUrl(attachments[i].attachment.object_key);
    if (imageCount > 1) {
      contentPayload.push({ type: "text", text: `[IMAGE_${i + 1}]` });
    }
    contentPayload.push({ type: "image_url", image_url: { url: imageUrl } });
  }

  const request = {
    apiKey: provider?.apiKey || config.serverApiKey,
    baseUrl: provider?.baseUrl || config.defaultBaseUrl,
    body: {
      model,
      messages: [{ role: "user", content: contentPayload }],
      max_tokens: imageCount === 1 ? 4000 : Math.min(16000, imageCount * 2500),
      temperature: 0.1
    },
    providerId: provider?.id,
    signal
  };

  let response = "";
  if (streamChatCompletionFn) {
    const upstream = await streamChatCompletionFn(request);
    if (!upstream?.body) throw new HttpError(502, "Vision description model returned an empty response stream.");
    const accumulated = await streamProviderAndAccumulate(upstream, () => {});
    response = accumulated.content || "";
  } else {
    response = await chatCompletionFn(request);
  }

  const raw = String(response || "").trim();
  if (!raw) {
    throw new HttpError(502, "Vision description model returned an empty response.");
  }
  const descriptions = {};

  if (imageCount === 1) {
    descriptions[attachments[0].id] = raw;
  } else {
    const sections = raw.split(/\[IMAGE_(\d+)\]/i).filter(Boolean);
    let currentIndex = null;
    for (const section of sections) {
      const num = parseInt(section, 10);
      if (!isNaN(num) && num >= 1 && num <= imageCount) {
        currentIndex = num - 1;
      } else if (currentIndex !== null && attachments[currentIndex]) {
        const description = section.trim();
        if (description) descriptions[attachments[currentIndex].id] = description;
        currentIndex = null;
      }
    }
    for (const { id } of attachments) {
      if (!descriptions[id]) {
        throw new HttpError(502, "Vision description model did not describe every image.");
      }
    }
  }

  return { descriptions, model };
}
