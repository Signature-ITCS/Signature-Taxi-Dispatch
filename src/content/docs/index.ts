import type { DocGroup, DocPage } from "./types";
import { companyPages } from "./company";
import { operationsPages } from "./operations";
import { dispatchPages, driverPages, customerPages } from "./people";
import { developerPages } from "./developer";

export type { DocGroup, DocPage, DocSection, Audience } from "./types";

const page = (list: DocPage[], ...slugs: string[]) => slugs.map((s) => list.find((p) => p.slug === s)!).filter(Boolean);

/** The table of contents, in reading order. */
export const DOC_GROUPS: DocGroup[] = [
  { title: "Getting started", description: "Your first sign-in and setup checklist.", pages: page(companyPages, "getting-started") },
  {
    title: "Company settings",
    description: "Admin → Settings, card by card.",
    pages: page(companyPages, "company-details", "branding", "email", "sms", "stripe", "alert-emails", "booking-widget"),
  },
  { title: "Pricing", description: "Fares, extra charges and fixed prices.", pages: page(operationsPages, "pricing", "fixed-prices") },
  { title: "Your team", description: "Office users and drivers.", pages: page(operationsPages, "dispatchers", "drivers") },
  { title: "Plan and backups", description: "Billing, backups and paid help.", pages: page(operationsPages, "plan-billing", "backups", "setup-help") },
  { title: "Dispatch guide", description: "For office staff, day to day.", pages: dispatchPages },
  { title: "Driver guide", description: "For your drivers.", pages: driverPages },
  { title: "Customer booking", description: "What your customers see.", pages: customerPages },
  { title: "Developer / platform owner", description: "Set-up, security and the master dashboard. Platform owner only.", pages: developerPages },
];

export const ALL_DOCS: DocPage[] = DOC_GROUPS.flatMap((g) => g.pages);

export function findDoc(slug: string): DocPage | undefined {
  return ALL_DOCS.find((p) => p.slug === slug);
}
