import { NextResponse } from "next/server";
import { getOfficeContext } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCompanyBrand } from "@/lib/companyBrand";
import { accountJourneys, billable, emailInvoice, invoicePdf, isMonth, issueInvoice, monthRange } from "@/lib/invoice";
import type { Account, Invoice } from "@/lib/types";

/**
 * Staff-only account invoices, always for the signed-in staff member's own company.
 *
 *   GET  ?account=<id>&month=YYYY-MM   → the invoice PDF (a DRAFT if that month hasn't been issued yet)
 *   POST { account, month, send? }     → issue (or refresh) the month's invoice; with send=true also email it
 */
const originOf = (req: Request) => (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, "");

/** The account, only if it belongs to this company. */
async function loadAccount(companyId: string, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createAdminClient().from("accounts").select("*").eq("id", id).eq("company_id", companyId).maybeSingle();
  return (data as Account) ?? null;
}

export async function GET(req: Request) {
  const office = await getOfficeContext();
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const account = await loadAccount(office.company.id, url.searchParams.get("account"));
  if (!account || !isMonth(month)) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const db = createAdminClient();
  const { data: inv } = await db
    .from("invoices")
    .select("*")
    .eq("account_id", account.id)
    .eq("company_id", account.company_id)
    .eq("period_start", monthRange(month).periodStart)
    .maybeSingle();
  const invoice = (inv as Invoice) ?? null;
  let journeys = billable(await accountJourneys(db, account.id, month));
  // A paid invoice shows exactly what was paid.
  if (invoice?.paid_at) journeys = journeys.filter((j) => invoice.booking_ids.includes(j.id));

  const brand = await getCompanyBrand(account.company_id);
  const pdf = await invoicePdf({ account, invoice, month, journeys, origin: originOf(req), brand });
  const name = `${invoice ? invoice.invoice_number : "DRAFT"}-${account.name.replace(/[^a-z0-9]+/gi, "-")}-${month}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("inline") ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const office = await getOfficeContext();
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const account = await loadAccount(office.company.id, b.account);
  if (!account || !isMonth(b.month)) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const db = createAdminClient();
  try {
    const issued = await issueInvoice(db, account, b.month);
    if (!issued) return NextResponse.json({ ok: false, error: "no_journeys" });
    if (!b.send) return NextResponse.json({ ok: true, invoice: issued.invoice });
    const sent = await emailInvoice(db, account, issued.invoice, issued.journeys, originOf(req));
    return NextResponse.json({ ok: sent.ok, error: sent.error, invoice: issued.invoice });
  } catch (e) {
    console.error("[invoice] issue failed", e);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
