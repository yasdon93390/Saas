import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "./button";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{children}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export const tableClass = {
  table: "w-full text-left text-sm",
  head: "border-b border-line text-xs uppercase tracking-wide text-ink-faint",
  th: "px-6 py-3 font-medium",
  body: "divide-y divide-line",
  td: "px-6 py-3",
  amount: "whitespace-nowrap px-6 py-3 text-right tabular-nums",
};

export const PAGE_SIZE = 25;

/** Lit ?page= et renvoie un numéro de page sûr, à partir de 1. */
export function pageFromParam(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}

export function Pagination({
  page,
  total,
  href,
}: {
  page: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0) return null;
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 border-t border-line px-6 py-3 text-sm">
      <p className="text-ink-soft">
        {first}–{last} sur {total}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>
            Précédent
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>
            Suivant
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Retire d'une recherche tout caractère ayant un sens particulier pour le filtre. */
export function sanitizeSearch(value: string | undefined): string {
  return (value ?? "").replace(/[^\p{L}\p{N} .@&'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{item.label}</dt>
          <dd className="mt-1 text-sm text-ink">{item.value || <span className="text-ink-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
