import BookingWidget from "@/components/booking/BookingWidget";

export const metadata = {
  title: "Book a ride",
};

export default async function EmbedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BookingWidget site={slug} embed />;
}
