import { getCompanyBySlug, resolveWebsite } from "@/lib/tenant";
import { getCompanyBrand, getPlatformBrand } from "@/lib/companyBrand";

/**
 * Web app manifests — one per company and app, so each company's customers,
 * staff and drivers install an app carrying that company's name:
 *
 *   /api/manifest/customer?c=<booking slug>  → opens its booking page
 *   /api/manifest/staff?c=<company slug>     → opens the staff sign-in
 *   /api/manifest/driver?c=<company slug>    → opens the driver app
 *
 * The `id` includes the company, so two companies' apps on one phone stay apart.
 */
const ICONS = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
  { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

export async function GET(req: Request, ctx: { params: Promise<{ app: string }> }) {
  const { app } = await ctx.params;
  const slug = (new URL(req.url).searchParams.get("c") ?? "").trim().toLowerCase();

  let companyId: string | null = null;
  let bookSlug: string | null = null;
  if (slug && app === "customer") {
    const site = await resolveWebsite(slug);
    companyId = site?.company_id ?? null;
    bookSlug = site?.slug ?? null;
  } else if (slug) {
    companyId = (await getCompanyBySlug(slug))?.id ?? null;
  }
  const brand = companyId ? await getCompanyBrand(companyId) : await getPlatformBrand();
  const short = (s: string) => (s.length > 12 ? s.slice(0, 12).trim() : s);
  const tag = companyId ? `?c=${encodeURIComponent(slug)}` : "";

  const byApp: Record<string, { id: string; name: string; short_name: string; start_url: string; background: string }> = {
    customer: {
      id: `/book/${bookSlug ?? ""}`,
      name: brand.name,
      short_name: short(brand.name),
      start_url: bookSlug ? `/book/${bookSlug}` : "/",
      background: "#ffffff",
    },
    staff: {
      id: `/login${tag}`,
      name: `${brand.name} Dispatch`,
      short_name: short(`${brand.name}`) || "Dispatch",
      start_url: "/login",
      background: brand.dark,
    },
    driver: {
      id: `/driver${tag}`,
      name: `${brand.name} Driver`,
      short_name: "Driver",
      start_url: "/driver",
      background: brand.dark,
    },
  };
  const m = byApp[app];
  if (!m) return new Response("Not found", { status: 404 });

  return Response.json(
    {
      id: m.id,
      name: m.name,
      short_name: m.short_name,
      description: m.name,
      start_url: m.start_url,
      scope: "/",
      display: "standalone",
      background_color: m.background,
      theme_color: brand.dark,
      icons: ICONS,
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" } }
  );
}
