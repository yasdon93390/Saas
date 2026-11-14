import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PAGE_SIZE, PageHeader, Pagination, pageFromParam, sanitizeSearch, tableClass } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Clients" };

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const context = await requireOrgContext(orgSlug, "data.read");
  const canWrite = can(context.role, "data.write");

  const search = sanitizeSearch(query.q);
  const status = query.status === "archived" ? "archived" : "active";
  const page = pageFromParam(query.page);
  const base = `/o/${orgSlug}/customers`;

  const supabase = await createClient();
  let request = supabase
    .from("customers")
    .select("id, name, billing_email, country, status, reminders_suspended_at", { count: "exact" })
    .eq("organization_id", context.organization.id)
    .eq("status", status)
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (search) request = request.ilike("name", `%${search}%`);
  const { data: customers, count } = await request;

  const href = (target: number) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status === "archived") next.set("status", "archived");
    if (target > 1) next.set("page", String(target));
    const suffix = next.toString();
    return suffix ? `${base}?${suffix}` : base;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Clients"
        actions={
          canWrite ? (
            <Link href={`${base}/new`} className={buttonClass("primary")}>
              Nouveau client
            </Link>
          ) : null
        }
      />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line px-6 py-4">
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">
              Rechercher par raison sociale
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={search}
              className="block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
              Afficher
            </label>
            <select
              id="status"
              name="status"
              defaultValue={status}
              className="block h-10 rounded-lg border border-line bg-surface px-3 text-sm"
            >
              <option value="active">Clients actifs</option>
              <option value="archived">Clients archivés</option>
            </select>
          </div>
          <button type="submit" className={buttonClass("secondary")}>
            Filtrer
          </button>
        </form>

        {customers && customers.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className={tableClass.table}>
                <caption className="sr-only">Liste des clients</caption>
                <thead className={tableClass.head}>
                  <tr>
                    <th scope="col" className={tableClass.th}>Raison sociale</th>
                    <th scope="col" className={tableClass.th}>Email de facturation</th>
                    <th scope="col" className={tableClass.th}>Pays</th>
                    <th scope="col" className={tableClass.th}>Relances</th>
                  </tr>
                </thead>
                <tbody className={tableClass.body}>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td className={tableClass.td}>
                        <Link href={`${base}/${customer.id}`} className="font-medium text-action hover:underline">
                          {customer.name}
                        </Link>
                      </td>
                      <td className={`${tableClass.td} text-ink-soft`}>
                        {customer.billing_email ?? <Badge tone="warning">Email manquant</Badge>}
                      </td>
                      <td className={`${tableClass.td} text-ink-soft`}>{customer.country ?? "—"}</td>
                      <td className={tableClass.td}>
                        {customer.reminders_suspended_at ? (
                          <Badge tone="warning">Suspendues</Badge>
                        ) : (
                          <Badge tone="neutral">Autorisées</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={count ?? 0} href={href} />
          </>
        ) : (
          <EmptyState title={search ? "Aucun client ne correspond à cette recherche." : "Aucun client pour l'instant."}>
            {search
              ? "Vérifiez l'orthographe ou effacez la recherche."
              : "Les clients sont créés automatiquement lors d'un import de factures, ou à la main."}
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
