/**
 * Documentation content (/documentation). Each page has sections with stable
 * ids, so the app's "How to?" links can open the exact part:
 * /documentation/<page>#<section>.
 *
 * Bodies use a small Markdown subset, rendered by components/docs/DocBody:
 * paragraphs, "- " bullets, "1. " steps, "> " notes, "!> " warnings,
 * ``` code blocks, **bold**, `code`, and [links](/path).
 */
export type Audience = "company" | "dispatch" | "driver" | "customer" | "owner";

export interface DocSection {
  id: string;
  title: string;
  body: string;
}

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  audience: Audience;
  sections: DocSection[];
}

export interface DocGroup {
  title: string;
  description: string;
  pages: DocPage[];
}
