import type { Metadata } from "next";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms/action-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireOrgContext } from "@/lib/auth/context";
import { assignableRoles, can, canManageMember, isRole, ROLE_LABELS, type Role } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { changeMemberRole, inviteMember, revokeInvitation, setMemberDisabled } from "./actions";

export const metadata: Metadata = { title: "Membres" };

type MemberStatus = "invited" | "active" | "disabled";

const STATUS: Record<MemberStatus, { label: string; tone: BadgeTone }> = {
  invited: { label: "Invitation en attente", tone: "warning" },
  active: { label: "Actif", tone: "success" },
  disabled: { label: "Désactivé", tone: "neutral" },
};

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug, "data.read");
  const canManage = can(context.role, "members.manage");
  const roleOptions = assignableRoles(context.role).map((role) => ({ value: role, label: ROLE_LABELS[role] }));

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("organization_members")
    .select("id, user_id, invited_email, role, status")
    // Filtre explicite en plus de la RLS : deux barrières valent mieux qu'une.
    .eq("organization_id", context.organization.id)
    .order("invited_at");

  const userIds = (members ?? []).flatMap((member) => (member.user_id ? [member.user_id] : []));
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Membres</h1>

      {canManage ? (
        <Card>
          <CardHeader
            title="Inviter un collègue"
            description="La personne rejoint l'organisation en se connectant avec l'adresse indiquée, une fois celle-ci vérifiée."
          />
          <CardBody>
            <ActionForm action={inviteMember.bind(null, orgSlug)}>
              <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
                <Field name="email" label="Adresse email" type="email" autoComplete="off" />
                <SelectField name="role" label="Rôle" options={roleOptions} defaultValue="viewer" />
              </div>
              <SubmitButton>Inviter</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Membres de l&apos;organisation</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-6 py-3 font-medium">Membre</th>
                <th scope="col" className="px-6 py-3 font-medium">Rôle</th>
                <th scope="col" className="px-6 py-3 font-medium">Statut</th>
                {canManage ? <th scope="col" className="px-6 py-3 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(members ?? []).map((member) => {
                const role: Role = isRole(member.role) ? member.role : "viewer";
                const status = STATUS[member.status as MemberStatus] ?? STATUS.disabled;
                const isSelf = member.user_id === context.user.id;
                const manageable = canManageMember(context.role, { role, isSelf });
                const name = member.user_id ? names.get(member.user_id) : null;

                return (
                  <tr key={member.id} className="align-top">
                    <td className="px-6 py-4">
                      <p className="font-medium text-ink">
                        {name || member.invited_email}
                        {isSelf ? <span className="ml-2 text-xs font-normal text-ink-faint">(vous)</span> : null}
                      </p>
                      {name ? <p className="text-ink-soft">{member.invited_email}</p> : null}
                    </td>
                    <td className="px-6 py-4">
                      {manageable ? (
                        <ActionForm action={changeMemberRole.bind(null, orgSlug)} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="memberId" value={member.id} />
                          <label className="sr-only" htmlFor={`role-${member.id}`}>
                            Rôle de {member.invited_email}
                          </label>
                          <select
                            id={`role-${member.id}`}
                            name="role"
                            defaultValue={role}
                            className="h-8 rounded-lg border border-line bg-surface px-2 text-sm"
                          >
                            {roleOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <SubmitButton variant="secondary" size="sm">Modifier</SubmitButton>
                        </ActionForm>
                      ) : (
                        ROLE_LABELS[role]
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    {canManage ? (
                      <td className="px-6 py-4">
                        {!manageable ? (
                          <span className="text-ink-faint">—</span>
                        ) : member.status === "invited" ? (
                          <ActionForm action={revokeInvitation.bind(null, orgSlug)} className="space-y-2">
                            <input type="hidden" name="memberId" value={member.id} />
                            <SubmitButton variant="danger" size="sm">Annuler l&apos;invitation</SubmitButton>
                          </ActionForm>
                        ) : (
                          <ActionForm action={setMemberDisabled.bind(null, orgSlug)} className="space-y-2">
                            <input type="hidden" name="memberId" value={member.id} />
                            <input type="hidden" name="disabled" value={member.status === "active" ? "true" : "false"} />
                            <SubmitButton variant={member.status === "active" ? "danger" : "secondary"} size="sm">
                              {member.status === "active" ? "Désactiver l'accès" : "Réactiver l'accès"}
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
