import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PAGE_SIZE, PageHeader, Pagination, pageFromParam, sanitizeSearch, tableClass } from "@/components/ui/page";
import { requireOrgContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/import/dates";
import { INVOICE_STATUSES, isInvoiceStatus, STATUS_LABELS } from "@/lib/invoices/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Factures" };

export default async function InvoicesPage({
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
  const status = isInvoiceStatus(query.status) ? query.status : null;
  const page = pageFromParam(query.page);
  const base = `/o/${orgSlug}/invoices`;

  const supabase = await createClient();
  let request = supabase
    .from("invoice_overview")
    .select("id, number, customer_id, customer_name, due_date, total_minor, remaining_minor, currency, status, is_overdue", {
      count: "exact",
    })
    .eq("organization_id", context.organization.id)
    .order("due_date", { ascending: true })
    .order("number", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) request = request.eq("status", status);
  // `search` ne contient plus aucun caractère ayant un sens pour le filtre (voir sanitizeSearch).
  if (search) request = request.or(`number.ilike.%${search}%,customer_name.ilike.%${search}%`);
  const { data: invoices, count } = await request;

  const href = (target: number) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status) next.set("status", status);
    if (target > 1) next.set("page", String(target));
    const suffix = next.toString();
    return suffix ? `${base}?${suffix}` : base;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Factures"
        description="Triées par échéance. Les statuts sont calculés automatiquement."
        actions={
          canWrite ? (
            <>
              <Link href={`/o/${orgSlug}/imports/new`} className={buttonClass("secondary")}>
                Importer un CSV
              </Link>
              <Link href={`${base}/new`} className={buttonClass("primary")}>
                Nouvelle facture
              </Link>
            </>
          ) : null
        }
      />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line px-6 py-4">
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">
              Rechercher un numéro ou un client
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
              Statut
            </label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ""}
              className="block h-10 rounded-lg border border-line bg-surface px-3 text-sm"
            >
              <option value="">Tous les statuts</option>
              {INVOICE_STATUSES.filter((value) => value !== "disputed").map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value].label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass("secondary")}>
            Filtrer
          </button>
        </form>

        {invoices && invoices.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className={tableClass.table}>
                <caption className="sr-only">Liste des factures</caption>
                <thead className={tableClass.head}>
                  <tr>
                    <th scope="col" className={tableClass.th}>Numéro</th>
                    <th scope="col" className={tableClass.th}>Client</th>
                    <th scope="col" className={tableClass.th}>Échéance</th>
                    <th scope="col" className={`${tableClass.th} text-right`}>Total</th>
                    <th scope="col" className={`${tableClass.th} text-right`}>Reste dû</th>
                    <th scope="col" className={tableClass.th}>Statut</th>
                  </tr>
                </thead>
                <tbody className={tableClass.body}>
                  {invoices.map((invoice) => {
                    const label = isInvoiceStatus(invoice.status) ? STATUS_LABELS[invoice.status] : null;
                    return (
                      <tr key={invoice.id}>
                        <td className={tableClass.td}>
                          <Link href={`${base}/${invoice.id}`} className="font-medium text-action hover:underline">
                            {invoice.number}
                          </Link>
                        </td>
                        <td className={tableClass.td}>
                          <Link href={`/o/${orgSlug}/customers/${invoice.customer_id}`} className="text-ink hover:underline">
                            {invoice.customer_name}
                          </Link>
                        </td>
                        <td className={`${tableClass.td} whitespace-nowrap text-ink-soft`}>{formatDate(invoice.due_date)}</td>
                        <td className={tableClass.amount}>{formatMoney(invoice.total_minor, invoice.currency)}</td>
                        <td className={`${tableClass.amount} font-medium`}>
                          {invoice.status === "cancelled" ? "—" : formatMoney(invoice.remaining_minor, invoice.currency)}
                        </td>
                        <td className={tableClass.td}>
                          <span className="flex flex-wrap gap-1">
                            {label ? <Badge tone={label.tone}>{label.label}</Badge> : null}
                            {invoice.is_overdue && invoice.status !== "overdue" ? <Badge tone="danger">En retard</Badge> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={count ?? 0} href={href} />
          </>
        ) : (
          <EmptyState
            title={search || status ? "Aucune facture ne correspond à ces critères." : "Aucune facture pour l'instant."}
            action={
              canWrite && !search && !status ? (
                <Link href={`/o/${orgSlug}/imports/new`} className={buttonClass("primary")}>
                  Importer un fichier CSV
                </Link>
              ) : null
            }
          >
            {search || status
              ? "Modifiez la recherche ou le filtre de statut."
              : "Importez vos factures depuis un fichier CSV, ou créez-en une à la main."}
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
