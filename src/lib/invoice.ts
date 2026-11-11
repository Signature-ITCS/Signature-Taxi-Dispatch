/**
 * Corporate account invoices — server only.
 *
 * One invoice per account per calendar month (UK time). It covers the account's
 * COMPLETED journeys whose journey time (pickup time, or booking time for
 * "as soon as possible" rides) falls in that month. Issuing again for the same
 * month keeps the invoice number and refreshes the journeys, unless it has
 * already been marked paid.
 *
 * The PDF is built here with pdf-lib (no browser needed), so the same file is
 * downloaded from the Accounts screen and attached to the email.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { getCompanyBrand, type CompanyBrand } from "./companyBrand";
import { sendEmail, emailEnabled, EMAIL_RE } from "./email";
import { accountInvoiceEmail } from "./emailTemplates";
import type { Account, Invoice } from "./types";

import { accountJourneys, billable, journeyFare, journeyTime, monthRange, previousMonth, type InvoiceJourney } from "./accountJourneys";
export { accountJourneys, billable, isMonth, journeyFare, journeyTime, monthRange, previousMonth, type InvoiceJourney } from "./accountJourneys";

/** Create (or refresh) the invoice for an account and month. Null when there's nothing to bill. */
export async function issueInvoice(db: SupabaseClient, account: Account, month: string): Promise<{ invoice: Invoice; journeys: InvoiceJourney[] } | null> {
  const range = monthRange(month);
  const journeys = billable(await accountJourneys(db, account.id, month));
  if (journeys.length === 0) return null;
  const total = Math.round(journeys.reduce((s, j) => s + journeyFare(j), 0) * 100) / 100;

  const { data: existing } = await db
    .from("invoices")
    .select("*")
    .eq("account_id", account.id)
    .eq("company_id", account.company_id)
    .eq("period_start", range.periodStart)
    .maybeSingle();

  const fields = { journeys: journeys.length, total, booking_ids: journeys.map((j) => j.id) };

  if (existing) {
    const inv = existing as Invoice;
    // A paid invoice is final: re-sending it mustn't quietly change what was paid.
    if (inv.paid_at) {
      const paidIds = new Set(inv.booking_ids);
      return { invoice: inv, journeys: journeys.filter((j) => paidIds.has(j.id)) };
    }
    const { data, error } = await db.from("invoices").update(fields).eq("id", inv.id).eq("company_id", account.company_id).select("*").single();
    if (error) throw new Error(error.message);
    return { invoice: data as Invoice, journeys };
  }

  const { data: num, error: numErr } = await db.rpc("next_invoice_number", { p_company: account.company_id });
  if (numErr || !num) throw new Error(numErr?.message ?? "Could not get an invoice number");
  const { data, error } = await db
    .from("invoices")
    .insert({ company_id: account.company_id, invoice_number: num as string, account_id: account.id, period_start: range.periodStart, period_end: range.periodEnd, ...fields })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { invoice: data as Invoice, journeys };
}

/** The account's invoice addresses (comma/semicolon/space separated). */
export function invoiceRecipients(account: Pick<Account, "email">): string[] {
  return (account.email ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => EMAIL_RE.test(e));
}

/** Email an issued invoice with its PDF; records the outcome on the invoice. */
export async function emailInvoice(
  db: SupabaseClient,
  account: Account,
  invoice: Invoice,
  journeys: InvoiceJourney[],
  origin: string
): Promise<{ ok: boolean; error?: string }> {
  const to = invoiceRecipients(account);
  let error: string | null = null;
  if (!to.length) error = "The account has no invoice email address.";
  else if (!(await emailEnabled(account.company_id))) error = "Email isn't set up for this company (Settings → Email).";

  if (!error) {
    const brand = await getCompanyBrand(account.company_id);
    const pdf = await invoicePdf({ account, invoice, journeys, origin, brand });
    const { subject, html } = accountInvoiceEmail({
      accountName: account.name,
      invoiceNumber: invoice.invoice_number,
      periodLabel: monthRange(invoice.period_start.slice(0, 7)).label,
      journeys: invoice.journeys,
      total: Number(invoice.total),
    }, brand);
    const sent = await sendEmail({
      companyId: account.company_id,
      to,
      subject,
      html,
      attachments: [{ filename: `${invoice.invoice_number}.pdf`, content: Buffer.from(pdf).toString("base64") }],
    });
    if (!sent) error = "The email provider rejected the message.";
  }

  await db
    .from("invoices")
    .update(error ? { email_error: error } : { emailed_at: new Date().toISOString(), emailed_to: to.join(", "), email_error: null })
    .eq("id", invoice.id)
    .eq("company_id", account.company_id);
  return error ? { ok: false, error } : { ok: true };
}

/* ───────────────────────────── PDF ───────────────────────────── */

const A4 = { w: 595.28, h: 841.89 };
const M = 42; // page margin
const GREY = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.9, 0.91, 0.93);

function hex(h: string) {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// The built-in PDF fonts only cover Windows-1252; swap anything else for a near equivalent.
const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function safe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[→⇒➔]/g, "->")
    .replace(/[\r\n\t]+/g, " ")
    .split("")
    .map((c) => (c.charCodeAt(0) <= 0xff || WIN_EXTRA.includes(c) ? c : "?"))
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      // a single word longer than the column: hard-break it
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const ukDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" });
const ukDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" });
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The company's logo, only from our own storage (never an arbitrary URL — that
 * would let a company make the server fetch anything). PNG or JPEG.
 */
async function loadLogo(doc: PDFDocument, logoUrl: string | null) {
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!logoUrl || !base || !logoUrl.startsWith(`${base.replace(/\/$/, "")}/storage/v1/object/public/`)) return null;
    const res = await fetch(logoUrl, { cache: "force-cache" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 2_000_000) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
    return null;
  } catch {
    return null;
  }
}

/**
 * The invoice as a PDF. `invoice` may be null for a draft (journeys of a month
 * that hasn't been issued yet), which prints "DRAFT" instead of a number.
 */
export async function invoicePdf(opts: {
  account: Account;
  invoice: Pick<Invoice, "invoice_number" | "issued_at" | "period_start" | "paid_at"> | null;
  month?: string;
  journeys: InvoiceJourney[];
  origin: string;
  brand: CompanyBrand;
}): Promise<Uint8Array> {
  const { account, invoice, journeys, brand } = opts;
  const ORANGE = hex(brand.primary);
  const NAVY = hex(brand.dark);
  const month = opts.month ?? invoice!.period_start.slice(0, 7);
  const range = monthRange(month);
  const doc = await PDFDocument.create();
  doc.setTitle(`${invoice ? invoice.invoice_number : "Draft invoice"} — ${account.name} — ${range.label}`);
  doc.setAuthor(brand.legalName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(doc, brand.logoUrl);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const text = (p: PDFPage, s: string, x: number, yy: number, size = 9.5, f: PDFFont = font, color = NAVY) =>
    p.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (p: PDFPage, s: string, xRight: number, yy: number, size = 9.5, f: PDFFont = font, color = NAVY) =>
    text(p, s, xRight - f.widthOfTextAtSize(safe(s), size), yy, size, f, color);

  // ── header ──
  if (logo) {
    const w = 170;
    const h = (logo.height / logo.width) * w;
    page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
  } else {
    text(page, brand.legalName, M, y - 16, 15, bold);
  }
  right(page, invoice ? "INVOICE" : "DRAFT INVOICE", A4.w - M, y - 18, 20, bold, ORANGE);
  right(page, brand.legalName, A4.w - M, y - 36, 9, bold);
  right(page, brand.contact.address, A4.w - M, y - 48, 8.5, font, GREY);
  right(page, [brand.contact.phone, brand.contact.email].filter(Boolean).join(" · "), A4.w - M, y - 60, 8.5, font, GREY);
  right(page, brand.contact.website, A4.w - M, y - 72, 8.5, font, GREY);
  y -= 92;
  page.drawRectangle({ x: M, y, width: A4.w - 2 * M, height: 3, color: ORANGE });
  y -= 26;

  // ── bill to / invoice details ──
  text(page, "BILL TO", M, y, 8, bold, GREY);
  text(page, "INVOICE DETAILS", A4.w / 2 + 20, y, 8, bold, GREY);
  y -= 15;
  const billTo = [account.name, account.contact_name, ...(account.address ?? "").split(/\n|,\s*/), account.email].filter(Boolean) as string[];
  const details: [string, string][] = [
    ["Invoice no.", invoice ? invoice.invoice_number : "Draft — not issued yet"],
    ["Invoice date", ukDate(invoice?.issued_at ?? new Date().toISOString())],
    ["Period", `${ukDate(range.from.toISOString())} – ${ukDate(new Date(range.to.getTime() - 1).toISOString())}`],
    ["Journeys", String(journeys.length)],
  ];
  if (invoice?.paid_at) details.push(["Status", `Paid ${ukDate(invoice.paid_at)}`]);
  const rows = Math.max(billTo.length, details.length);
  for (let i = 0; i < rows; i++) {
    if (billTo[i]) text(page, billTo[i], M, y, i === 0 ? 11 : 9.5, i === 0 ? bold : font);
    if (details[i]) {
      text(page, details[i][0], A4.w / 2 + 20, y, 9.5, font, GREY);
      right(page, details[i][1], A4.w - M, y, 9.5, bold);
    }
    y -= i === 0 ? 15 : 13;
  }
  y -= 14;

  // ── journeys table ──
  const cols = { date: M, ref: M + 70, pax: M + 122, journey: M + 202, fare: A4.w - M };
  const journeyW = cols.fare - 58 - cols.journey;
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: A4.w - 2 * M, height: 20, color: NAVY });
    const w = rgb(1, 1, 1);
    text(page, "Date & time", cols.date + 6, y, 8.5, bold, w);
    text(page, "Ref", cols.ref, y, 8.5, bold, w);
    text(page, "Passenger", cols.pax, y, 8.5, bold, w);
    text(page, "Journey", cols.journey, y, 8.5, bold, w);
    right(page, "Fare", cols.fare - 6, y, 8.5, bold, w);
    y -= 22;
  };
  header();

  for (const j of journeys) {
    const lines = [...wrap(`From: ${j.pickup_address}`, font, 8.5, journeyW), ...wrap(`To: ${j.dropoff_address}`, font, 8.5, journeyW)];
    const paxLines = wrap(j.customer_name, font, 8.5, cols.journey - cols.pax - 8).slice(0, 3);
    const h = Math.max(lines.length, paxLines.length) * 11 + 8;
    if (y - h < M + 70) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - M;
      text(page, `${account.name} — ${range.label} (continued)`, M, y, 9, bold, GREY);
      y -= 24;
      header();
    }
    text(page, ukDateTime(journeyTime(j)), cols.date + 6, y, 8.5);
    text(page, j.booking_number ?? "—", cols.ref, y, 8.5, font, GREY);
    paxLines.forEach((l, i) => text(page, l, cols.pax, y - i * 11, 8.5));
    lines.forEach((l, i) => text(page, l, cols.journey, y - i * 11, 8.5));
    right(page, gbp(journeyFare(j)), cols.fare - 6, y, 9, bold);
    y -= h;
    page.drawLine({ start: { x: M, y: y + 5 }, end: { x: A4.w - M, y: y + 5 }, thickness: 0.6, color: LINE });
    y -= 4;
  }
  if (!journeys.length) {
    text(page, "No completed journeys on this account for the period.", M + 6, y, 9.5, font, GREY);
    y -= 20;
  }

  // ── total ──
  const total = journeys.reduce((s, j) => s + journeyFare(j), 0);
  if (y < M + 90) {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - M - 20;
  }
  y -= 10;
  page.drawRectangle({ x: A4.w / 2 + 20, y: y - 12, width: A4.w / 2 - 20 - M, height: 30, color: rgb(1, 0.95, 0.91) });
  text(page, "Total due", A4.w / 2 + 32, y, 11, bold);
  right(page, gbp(total), A4.w - M - 12, y, 13, bold, ORANGE);
  y -= 44;
  text(page, invoice ? `Please quote ${invoice.invoice_number} with your payment.` : "Draft: totals may change until the month is invoiced.", M, y, 9, font, GREY);
  y -= 13;
  const ask = [brand.contact.phone && `call ${brand.contact.phone}`, brand.contact.email && `email ${brand.contact.email}`].filter(Boolean).join(" or ");
  if (ask) text(page, `Questions about this invoice? Please ${ask}.`, M, y, 9, font, GREY);

  // page numbers
  const pages = doc.getPages();
  pages.forEach((p, i) => right(p, `Page ${i + 1} of ${pages.length}`, A4.w - M, 24, 8, font, GREY));

  return doc.save();
}

/* ───────────────────────────── monthly run ───────────────────────────── */

/**
 * Last month's account invoices, for every open company. Called once a day by
 * the keep-alive cron, but only does anything in the first week of a month
 * (London time) — so a day the run fails is retried the next day.
 *
 * Idempotent: an invoice already emailed is never emailed again, and a paid
 * one is never changed (see issueInvoice).
 */
export async function runMonthlyAccountInvoices(origin: string, now = new Date()) {
  const day = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" }).format(now));
  if (day > 7) return { skipped: "not the first week of the month" };
  const month = previousMonth(now);
  const db = createAdminClient();
  const { data } = await db
    .from("accounts")
    .select("*, companies!inner(status)")
    .eq("is_active", true)
    .in("companies.status", ["trialing", "active", "past_due"]);
  let emailed = 0;
  let failed = 0;
  for (const row of (data ?? []) as (Account & { companies?: unknown })[]) {
    const { companies: _c, ...account } = row;
    void _c;
    try {
      const { data: prior } = await db
        .from("invoices")
        .select("emailed_at")
        .eq("account_id", account.id)
        .eq("company_id", account.company_id)
        .eq("period_start", `${month}-01`)
        .maybeSingle();
      if (prior?.emailed_at) continue;
      const issued = await issueInvoice(db, account, month);
      if (!issued) continue;
      const sent = await emailInvoice(db, account, issued.invoice, issued.journeys, origin);
      if (sent.ok) emailed++;
      else failed++;
    } catch (e) {
      failed++;
      console.error("[invoices] account", account.id, e);
    }
  }
  return { month, emailed, failed };
}
