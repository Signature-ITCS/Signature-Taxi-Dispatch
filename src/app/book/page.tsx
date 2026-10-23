import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCompanyByDomain, companyWebsite } from "@/lib/tenant";

/**
 * /book on a company's own domain opens that company's booking page. On the
 * platform's address there is no single company, so it goes to the home page.
 */
export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const host = (await headers()).get("host") ?? "";
  const company = await getCompanyByDomain(host);
  const site = company ? await companyWebsite(company.id) : null;
  if (!site) redirect("/");
  const resume = (await searchParams).resume;
  redirect(`/${encodeURIComponent(site.slug)}${resume ? `?resume=${encodeURIComponent(resume)}` : ""}`);
}
