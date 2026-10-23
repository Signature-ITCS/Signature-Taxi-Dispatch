import { STATUS_META } from "@/lib/constants";
import type { BookingStatus } from "@/lib/types";
import { cn } from "@/lib/format";

export default function StatusBadge({
  status,
  size = "sm",
}: {
  status: BookingStatus;
  size?: "sm" | "xs";
}) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        m.bg,
        m.color,
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}
