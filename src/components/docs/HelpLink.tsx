import { CircleHelp } from "lucide-react";

/**
 * A small "How to?" link next to a setting, opening the exact part of the
 * documentation in a new tab: <HelpLink to="stripe#webhook" />.
 */
export default function HelpLink({ to, label = "How to?" }: { to: string; label?: string }) {
  return (
    <a
      href={`/documentation/${to}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
    >
      <CircleHelp className="h-3.5 w-3.5" /> {label}
    </a>
  );
}
