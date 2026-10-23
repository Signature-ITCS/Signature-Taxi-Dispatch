import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

/**
 * Renders the small Markdown subset used in src/content/docs. Builds React
 * elements (never raw HTML), so content can't inject markup.
 */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-ink-950">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-ink-950">{t.slice(1, -1)}</code>);
    else {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      out.push(
        href.startsWith("/") ? (
          <Link key={k} href={href} className="font-medium text-brand-600 underline-offset-2 hover:underline">{label}</Link>
        ) : (
          <a key={k} href={href} target="_blank" rel="noreferrer" className="font-medium text-brand-600 underline-offset-2 hover:underline">{label}</a>
        )
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function DocBody({ body }: { body: string }) {
  const lines = body.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${n++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="overflow-x-auto rounded-xl bg-ink-950 p-4 font-mono text-sm text-white">{code.join("\n")}</pre>);
      continue;
    }
    if (line.startsWith("> ") || line.startsWith("!> ")) {
      const warn = line.startsWith("!> ");
      const text: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i].startsWith("!> "))) text.push(lines[i++].replace(/^!?> /, ""));
      const Icon = warn ? AlertTriangle : Info;
      blocks.push(
        <div key={key} className={`flex gap-2.5 rounded-xl p-3.5 text-sm ${warn ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-ink-900"}`}>
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${warn ? "text-amber-600" : "text-brand-600"}`} />
          <p>{inline(text.join(" "), key)}</p>
        </div>
      );
      continue;
    }
    const bullet = /^- /;
    const numbered = /^\d+\. /;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length && (bullet.test(lines[i]) || numbered.test(lines[i]) || /^ {2,}- /.test(lines[i]))) {
        if (/^ {2,}- /.test(lines[i])) items[items.length - 1]?.sub.push(lines[i].replace(/^ +- /, ""));
        else items.push({ text: lines[i].replace(ordered ? numbered : bullet, ""), sub: [] });
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key} className={`space-y-1.5 pl-5 text-[15px] leading-relaxed text-gray-700 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, j) => (
            <li key={j}>
              {inline(it.text, `${key}-${j}`)}
              {it.sub.length > 0 && (
                <ul className="mt-1 list-[circle] space-y-1 pl-5">
                  {it.sub.map((s, k) => <li key={k}>{inline(s, `${key}-${j}-${k}`)}</li>)}
                </ul>
              )}
            </li>
          ))}
        </List>
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(- |\d+\. |```|> |!> )/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key} className="text-[15px] leading-relaxed text-gray-700">{inline(para.join(" "), key)}</p>);
  }
  return <div className="space-y-3.5">{blocks}</div>;
}
