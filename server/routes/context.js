import { requireUser } from "../auth/supabase.js";
import { SupabaseRest } from "../db/supabaseRest.js";
import { HttpError } from "../http/responses.js";
import { requireActiveEntitlement } from "../saas/entitlements.js";
import { R2Client } from "../storage/r2.js";

export const API_DEPENDENCIES = Symbol("klui.apiDependencies");

export const defaultApiDependencies = Object.freeze({
  createDb: (config) => new SupabaseRest(config),
  createR2: (config) => new R2Client(config),
  verifyUser: (req, config) => requireUser(req, config)
});

export function apiDependencies(config) {
  return config?.[API_DEPENDENCIES] || defaultApiDependencies;
}

export function bearerContext(config) {
  const dependencies = apiDependencies(config);
  return {
    db: dependencies.createDb(config),
    r2: dependencies.createR2(config)
  };
}

export async function authContext(req, config) {
  const services = bearerContext(config);
  const user = await apiDependencies(config).verifyUser(req, config);
  const profile = await services.db.upsertProfile(user, { signal: req.signal });
  return { ...services, user, profile };
}

export async function requireChatContext(req, config) {
  const context = await authContext(req, config);
  const entitlement = await requireActiveEntitlement({
    db: context.db,
    userId: context.user.id,
    plans: config.plans,
    access: config.access,
    signal: req.signal
  });

  return { ...context, ...entitlement };
}

export async function requireAdminContext(req, config) {
  const context = await authContext(req, config);
  if (context.profile?.role !== "admin") throw new HttpError(403, "Admin access is required.");
  return context;
}
