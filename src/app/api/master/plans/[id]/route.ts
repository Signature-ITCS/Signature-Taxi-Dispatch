import { NextResponse } from "next/server";
import { getPlatformAdmin, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStripe, toMinor } from "@/lib/stripe";
import { planFields } from "../fields";

/**
 * Change a plan, or { sync: true } to create/update it in the platform's
 * Stripe (product + monthly price). A new price is made when the amount
 * changes (Stripe prices can't be edited); existing subscribers keep theirs
 * until moved in Stripe.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (b.sync === true) {
    const stripe = await getPlatformStripe();
    if (!stripe) return NextResponse.json({ ok: false, error: "stripe_not_configured" });
    const { data: plan } = await admin.from("plans").select("*").eq("id", id).maybeSingle();
    if (!plan) return NextResponse.json({ ok: false, error: "not_found" });
    try {
      let productId = plan.stripe_product_id as string | null;
      if (productId) {
        await stripe.products.update(productId, { name: plan.name as string, active: true });
      } else {
        productId = (await stripe.products.create({ name: plan.name as string, metadata: { plan_id: id } })).id;
      }
      let priceId = plan.stripe_price_id as string | null;
      const amount = toMinor(Number(plan.price_monthly));
      const current = priceId ? await stripe.prices.retrieve(priceId).catch(() => null) : null;
      if (!current || current.unit_amount !== amount || current.product !== productId || !current.active) {
        priceId = (
          await stripe.prices.create({
            product: productId,
            currency: "gbp",
            unit_amount: amount,
            recurring: { interval: "month" },
            metadata: { plan_id: id },
          })
        ).id;
        if (current?.active) await stripe.prices.update(current.id, { active: false }).catch(() => null);
      }
      await admin.from("plans").update({ stripe_product_id: productId, stripe_price_id: priceId, updated_at: new Date().toISOString() }).eq("id", id);
      await audit("plan_synced", { actorId: owner.userId, actorEmail: owner.email, detail: { plan: id, price: priceId } });
      return NextResponse.json({ ok: true, stripe_price_id: priceId });
    } catch (err) {
      console.error("[plans] stripe sync failed", err);
      return NextResponse.json({ ok: false, error: "stripe_error" });
    }
  }

  const f = planFields(b, false);
  if ("error" in f) return NextResponse.json({ ok: false, error: f.error });
  if (!Object.keys(f.values).length) return NextResponse.json({ ok: true });
  const { error } = await admin.from("plans").update({ ...f.values, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.code === "23505" ? "code_in_use" : "save_failed" });
  await audit("plan_updated", { actorId: owner.userId, actorEmail: owner.email, detail: { plan: id, ...f.values } });
  return NextResponse.json({ ok: true });
}
