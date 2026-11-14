import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Badge } from "@/components/ui/badge";
import type { OrgContext } from "@/lib/auth/context";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";

type NavItem = { label: string; path: string; permission: Permission };

const NAV: readonly NavItem[] = [
  { label: "Tableau de bord", path: "", permission: "data.read" },
  { label: "Factures", path: "/invoices", permission: "data.read" },
  { label: "Clients", path: "/customers", permission: "data.read" },
  { label: "Imports", path: "/imports", permission: "data.read" },
  { label: "Membres", path: "/settings/members", permission: "data.read" },
  { label: "Journal d'audit", path: "/settings/audit", permission: "audit.read" },
];

// Affichés pour situer le produit, sans lien tant que la phase n'est pas livrée.
const UPCOMING = ["Relances", "Boîte de réception IA", "Prévisions", "Rapports"];

/**
 * Coquille commune aux écrans d'une organisation. Les liens masqués ici ne
 * sont qu'un confort : chaque page revérifie la permission côté serveur.
 */
export function AppShell({ context, children }: { context: OrgContext; children: ReactNode }) {
  const base = `/o/${context.organization.slug}`;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-nav text-white md:w-60 md:shrink-0">
        <div className="px-5 py-4 md:py-5">
          <p className="text-base font-semibold tracking-tight">
            CashPilot <span className="text-blue-300">AI</span>
          </p>
        </div>
        <nav aria-label="Navigation principale" className="px-3 pb-4">
          <ul className="flex flex-wrap gap-1 md:block md:space-y-1">
            {NAV.filter((item) => can(context.role, item.permission)).map((item) => (
              <li key={item.path}>
                <Link
                  href={`${base}${item.path}`}
                  className="block rounded-lg px-3 py-2 text-sm text-white/90 hover:bg-white/10"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 hidden px-3 text-xs font-semibold uppercase tracking-wider text-nav-soft md:block">
            Bientôt
          </p>
          <ul className="mt-2 hidden space-y-1 md:block">
            {UPCOMING.map((label) => (
              <li key={label} className="px-3 py-1.5 text-sm text-nav-soft">
                {label}
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-ink">{context.organization.name}</span>
            <Badge tone="info">{ROLE_LABELS[context.role]}</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/organizations" className="text-ink-soft hover:underline">
              Changer d&apos;organisation
            </Link>
            <span className="hidden text-ink-faint sm:inline">{context.user.email}</span>
            <form action={signOut}>
              <button type="submit" className="text-ink-soft hover:underline">
                Se déconnecter
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
