// Run with a PRIVATE env file, never a command-line key. Test resources only.
import fs from "node:fs/promises";
import { loadConfig } from "../server/config.js";
import { stripeClient, stripeCharges } from "../server/saas/stripe.js";
const config = loadConfig();
const stripe = stripeClient(config);
const output = [];
for (const plan of config.plans.filter(
  (p) => p.active !== false && p.amountAed > 0,
)) {
  const productId = `klui_${plan.id}_sandbox_v1`;
  let product;
  try {
    product = await stripe.products.retrieve(productId);
  } catch (error) {
    if (error.code !== "resource_missing") throw error;
  }
  if (!product)
    product = await stripe.products.create({
      id: productId,
      name: `Klui ${plan.name}`,
      description: plan.description,
      ...(config.stripe.taxCode ? { tax_code: config.stripe.taxCode } : {}),
    });
  const amount = Math.round(
    stripeCharges(plan, null, config).renewalAmount * 100,
  );
  const lookup = `klui_${plan.id}_aed_month_${amount}_v1`;
  let price = (await stripe.prices.list({ lookup_keys: [lookup], limit: 1 }))
    .data[0];
  if (!price)
    price = await stripe.prices.create({
      product: product.id,
      lookup_key: lookup,
      unit_amount: amount,
      currency: "aed",
      recurring: { interval: "month" },
      tax_behavior: "exclusive",
    });
  output.push(
    `STRIPE_${plan.id === "lite" ? "PLUS" : "PRO"}_PRICE_ID=${price.id}`,
  );
}
let portal = (
  await stripe.billingPortal.configurations.list({ limit: 100 })
).data.find((c) => c.metadata?.integration === "klui-sandbox");
if (!portal)
  portal = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Manage your Klui subscription" },
    metadata: { integration: "klui-sandbox" },
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: false },
    },
  });
output.push(`STRIPE_PORTAL_CONFIGURATION_ID=${portal.id}`);
if (process.env.STRIPE_SETUP_OUTPUT)
  await fs.writeFile(
    process.env.STRIPE_SETUP_OUTPUT,
    output.join("\n") + "\n",
    { mode: 0o600 },
  );
else console.log(output.join("\n"));
console.log(
  "Created/reused test prices and a cancellation/payment-method portal. No live resources changed.",
);
