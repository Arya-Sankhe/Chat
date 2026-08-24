import { single } from "./helpers.js";

const PAGE = 1000;
// ponytail: 20k rows per table. Async zip+email if an account actually hits this.
const MAX = 20000;

async function pages(client, table, query, signal) {
  const rows = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const batch = await client.request(table, {
      query: { ...query, limit: String(PAGE), offset: String(offset) },
      signal
    });
    const list = Array.isArray(batch) ? batch : [];
    rows.push(...list);
    if (list.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export async function exportAccountData(client, userId, { signal } = {}) {
  const scoped = { user_id: `eq.${userId}` };
  const [
    conversations,
    messages,
    files,
    memoryRows,
    subscriptions,
    payments,
    usage,
    projects
  ] = await Promise.all([
    pages(client, "conversations", {
      ...scoped,
      select: "id,title,project_id,model,created_at,updated_at,deleted_at",
      order: "created_at.asc"
    }, signal),
    pages(client, "messages", {
      ...scoped,
      select: "id,conversation_id,role,content,model,reasoning,tool_calls,finish_reason,error,created_at",
      order: "created_at.asc"
    }, signal),
    pages(client, "attachments", {
      ...scoped,
      select: "id,file_name,content_type,category,status,size_bytes,created_at,conversation_id,project_id",
      order: "created_at.asc"
    }, signal),
    client.request("user_memory_profiles", {
      query: { ...scoped, select: "enabled,content,updated_at", limit: "1" },
      signal
    }),
    pages(client, "subscriptions", {
      ...scoped,
      select: "id,plan_id,status,provider,provider_customer_id,provider_subscription_id,current_period_end,cancel_at_period_end,created_at,updated_at",
      order: "created_at.asc"
    }, signal),
    pages(client, "payment_requests", {
      ...scoped,
      select: "id,plan_id,amount_aed,currency,provider,status,reference_code,created_at",
      order: "created_at.asc"
    }, signal),
    pages(client, "usage_api_weekly", {
      ...scoped,
      select: "plan_id,period_start,period_end,week_index,week_start,week_end,api_credit_used,api_credit_reserved,api_credit_limit",
      order: "period_start.asc,week_index.asc"
    }, signal),
    pages(client, "projects", {
      ...scoped,
      select: "id,name,kind,instructions,created_at,updated_at",
      order: "created_at.asc"
    }, signal)
  ]);

  return {
    truncated: Boolean(
      conversations.truncated
      || messages.truncated
      || files.truncated
      || subscriptions.truncated
      || payments.truncated
      || usage.truncated
      || projects.truncated
    ),
    conversations: conversations.rows,
    messages: messages.rows,
    files: files.rows,
    memory: single(memoryRows),
    subscriptions: subscriptions.rows,
    payments: payments.rows,
    usage: usage.rows,
    projects: projects.rows
  };
}
