import HelpLink from "@/components/docs/HelpLink";

export default function PageHeader({
  title,
  subtitle,
  action,
  help,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Documentation page (and section) for the "How to?" link, e.g. "stripe#webhook". */
  help?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5 md:items-center md:gap-4 md:px-8 md:pt-6">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-3 font-display text-xl font-bold text-ink-950 md:text-2xl">
          {title}
          {help && <HelpLink to={help} />}
        </h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-gray-500 md:text-sm">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
