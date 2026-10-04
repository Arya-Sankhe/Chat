import { single } from "./helpers.js";

export async function getAffiliateCoupon(client, code, { signal } = {}) {
  return single(await client.request("affiliate_coupons", {
    query: { code: `eq.${code}`, select: "id,code,percent_off,enabled,affiliate_creators!inner(user_id)", limit: 1 }, signal
  }));
}

export async function getAffiliateCreatorByUser(client, userId, { signal } = {}) {
  return single(await client.request("affiliate_creators", {
    query: { user_id: `eq.${userId}`, select: "id", limit: 1 }, signal
  }));
}

export async function createAffiliateCreator(client, row, { signal } = {}) {
  return single(await client.request("affiliate_creators", { method: "POST", body: row, prefer: "return=representation", signal }));
}

export async function createAffiliateCoupon(client, row, { signal } = {}) {
  return single(await client.request("affiliate_coupons", { method: "POST", body: row, prefer: "return=representation", signal }));
}

export async function updateAffiliateCoupon(client, id, patch, { signal } = {}) {
  return single(await client.request("affiliate_coupons", {
    method: "PATCH", query: { id: `eq.${id}` }, body: patch, prefer: "return=representation", signal
  }));
}

export async function affiliateReport(client, { creatorId = null, limit = 100, offset = 0, signal } = {}) {
  return client.rpc("klui_affiliate_report", { p_creator_id: creatorId, p_limit: limit, p_offset: offset }, { signal });
}
