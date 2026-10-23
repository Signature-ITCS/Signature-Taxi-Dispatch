export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5 md:items-center md:gap-4 md:px-8 md:pt-6">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-bold text-ink-950 md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-gray-500 md:text-sm">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
