import type { Metadata } from "next";
import BookPage, { generateMetadata as bookMetadata } from "../book/[slug]/page";

/**
 * A company's own address on the platform: booking.airport-transfer.uk/<company>.
 * It is the company's booking page (same as /book/<company>). The company id in
 * the address is its unique slug, chosen when the company was created.
 */
type Props = { params: Promise<{ company: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company } = await params;
  return bookMetadata({ params: Promise.resolve({ slug: company }) });
}

export default async function CompanyHome({ params }: Props) {
  const { company } = await params;
  return BookPage({ params: Promise.resolve({ slug: company }) });
}
