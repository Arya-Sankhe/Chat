import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { authContext, requireAdminContext } from "./context.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function affiliateBody(req) {
  const body = await parseJsonBody(req, 16 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Request body must be an object.");
  return body;
}

function requireId(value) {
  if (typeof value !== "string" || !uuid.test(value)) throw new HttpError(400, "A valid account or creator ID is required.");
  return value;
}

function couponSettings(body, creating = false) {
  const patch = {};
  if (creating || Object.hasOwn(body, "percentOff")) {
    const percent = body.percentOff ?? null;
    if (percent !== null && (!Number.isInteger(percent) || percent < 1 || percent > 100)) {
      throw new HttpError(400, "Discount must be a whole percentage from 1 to 100, or null until decided.");
    }
    patch.percent_off = percent;
  }
  if (creating || Object.hasOwn(body, "enabled")) {
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new HttpError(400, "Enabled must be a boolean.");
    patch.enabled = body.enabled ?? false;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "Set percentOff or enabled.");
  return patch;
}

export async function handleCreatorAffiliate(req, res, config) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const { db, user } = await authContext(req, config);
  const creator = await db.getAffiliateCreatorByUser(user.id, { signal: req.signal });
  if (!creator) throw new HttpError(403, "Creator access is required.");
  const reports = await db.affiliateReport({ creatorId: creator.id, limit: 1, offset: 0, signal: req.signal });
  sendJson(res, 200, { affiliate: reports[0] });
}

export async function handleAdminAffiliates(req, res, url, config) {
  if (!["GET", "POST"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
  const { db } = await requireAdminContext(req, config);
  if (req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new HttpError(400, "Use limit 1–100 and a nonnegative offset.");
    }
    const affiliates = await db.affiliateReport({ limit, offset, signal: req.signal });
    sendJson(res, 200, { affiliates, limit, offset });
    return;
  }
  const body = await affiliateBody(req);
  const userId = requireId(body.userId);
  const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!name || name.length > 100) throw new HttpError(400, "Creator name must contain 1–100 characters.");
  if (!await db.getProfile(userId, { signal: req.signal })) throw new HttpError(404, "Ask the creator to sign in to Klui first.");
  const creator = await db.createAffiliateCreator({ user_id: userId, display_name: name }, { signal: req.signal });
  sendJson(res, 201, { creator });
}

export async function handleAdminAffiliateCoupon(req, res, config, id, creating) {
  if (req.method !== (creating ? "POST" : "PATCH")) throw new HttpError(405, "Method not allowed.");
  const { db } = await requireAdminContext(req, config);
  requireId(id);
  const body = await affiliateBody(req);
  const patch = couponSettings(body, creating);
  if (creating) {
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new HttpError(400, "Coupon code must contain 3–32 letters, numbers, underscores or hyphens.");
    if (["FIRST50", "FIRSTFREE"].includes(code) || config.mamo?.coupons?.has(code)) {
      throw new HttpError(409, "That code is reserved for a Klui promotion.");
    }
    if (patch.enabled && patch.percent_off === null) throw new HttpError(400, "Choose a discount before enabling the code.");
    const coupon = await db.createAffiliateCoupon({ creator_id: id, code, ...patch }, { signal: req.signal });
    sendJson(res, 201, { coupon });
  } else {
    const coupon = await db.updateAffiliateCoupon(id, patch, { signal: req.signal });
    if (!coupon) throw new HttpError(404, "Coupon was not found.");
    sendJson(res, 200, { coupon });
  }
}
