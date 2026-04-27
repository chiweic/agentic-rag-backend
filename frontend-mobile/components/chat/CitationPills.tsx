import { ExternalLink } from "lucide-react";
import type { Citation } from "@/lib/api";
import { toPills } from "@/lib/citations";

export function CitationPills({ citations }: { citations: Citation[] }) {
  const pills = toPills(citations);
  if (pills.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {pills.map((p) => (
        <a
          key={p.id}
          href={p.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-300"
          title={p.domain ? `${p.label} — ${p.domain}` : p.label}
        >
          <span className="truncate">{p.label}</span>
          <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
        </a>
      ))}
    </div>
  );
}
