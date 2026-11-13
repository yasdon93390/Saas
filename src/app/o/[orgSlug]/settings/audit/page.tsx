import type { Metadata } from "next";
import { Card, CardBody } from "@/components/ui/card";
import { requireOrgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Journal d'audit" };

const PAGE_SIZE = 100;

const ACTION_LABELS: Record<string, string> = {
  "organization.created": "Organisation créée",
  "member.invited": "Membre invité",
  "member.invitation_updated": "Invitation modifiée",
  "member.invitation_accepted": "Invitation acceptée",
  "member.invitation_revoked": "Invitation annulée",
  "member.role_changed": "Rôle modifié",
  "member.disabled": "Accès désactivé",
  "member.reactivated": "Accès réactivé",
};

export default async function AuditPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug, "audit.read");

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("audit_logs")
    .select("id, actor_id, action, metadata, created_at")
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const actorIds = [...new Set((entries ?? []).flatMap((entry) => (entry.actor_id ? [entry.actor_id] : [])))];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, display_name, email").in("id", actorIds)
    : { data: [] };
  const actors = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name || profile.email]));

  const formatDate = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: context.organization.timezone,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Journal d&apos;audit</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Les {PAGE_SIZE} dernières actions sensibles. Ce journal ne peut être ni modifié ni effacé.
        </p>
      </div>
      <Card>
        {entries && entries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Journal d&apos;audit de l&apos;organisation</caption>
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">Date</th>
                  <th scope="col" className="px-6 py-3 font-medium">Action</th>
                  <th scope="col" className="px-6 py-3 font-medium">Auteur</th>
                  <th scope="col" className="px-6 py-3 font-medium">Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-6 py-3 text-ink-soft">
                      {formatDate.format(new Date(entry.created_at))}
                    </td>
                    <td className="px-6 py-3 font-medium text-ink">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td className="px-6 py-3 text-ink-soft">
                      {(entry.actor_id && actors.get(entry.actor_id)) || "Système"}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-ink-faint">
                      {Object.entries((entry.metadata ?? {}) as Record<string, unknown>)
                        .map(([key, value]) => `${key}: ${String(value)}`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <CardBody className="text-center text-sm text-ink-soft">Aucune action enregistrée pour l&apos;instant.</CardBody>
        )}
      </Card>
    </div>
  );
}
