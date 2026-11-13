import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/context";
import { isRole, ROLE_LABELS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { acceptInvitation } from "./actions";

export const metadata: Metadata = { title: "Mes organisations" };

type Invitation = { member_id: string; organization_name: string; role: string };

export default async function OrganizationsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: organizations }, { data: invitations }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug").order("name"),
    supabase.rpc("my_pending_invitations"),
  ]);
  const pending = (invitations ?? []) as Invitation[];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Mes organisations</h1>
          <p className="mt-1 text-sm text-ink-soft">Connecté en tant que {user.email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className={buttonClass("ghost", "sm")}>
            Se déconnecter
          </button>
        </form>
      </header>

      {pending.length > 0 ? (
        <Card className="mb-6">
          <CardHeader title="Invitations en attente" />
          <ul className="divide-y divide-line">
            {pending.map((invitation) => (
              <li key={invitation.member_id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div>
                  <p className="font-medium text-ink">{invitation.organization_name}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Rôle proposé :{" "}
                    <Badge tone="info">{isRole(invitation.role) ? ROLE_LABELS[invitation.role] : invitation.role}</Badge>
                  </p>
                </div>
                <ActionForm action={acceptInvitation} className="flex flex-col items-end gap-2">
                  <input type="hidden" name="memberId" value={invitation.member_id} />
                  <SubmitButton size="sm">Rejoindre</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        {organizations && organizations.length > 0 ? (
          <ul className="divide-y divide-line">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  href={`/o/${organization.slug}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-canvas"
                >
                  <span className="font-medium text-ink">{organization.name}</span>
                  <span className="text-sm text-ink-faint">Ouvrir →</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody className="text-center">
            <p className="font-medium text-ink">Vous n&apos;appartenez encore à aucune organisation.</p>
            <p className="mt-2 text-sm text-ink-soft">
              Créez l&apos;espace de votre entreprise, ou demandez à un collègue de vous inviter avec
              l&apos;adresse {user.email}.
            </p>
          </CardBody>
        )}
      </Card>

      <div className="mt-6">
        <Link href="/organizations/new" className={buttonClass("primary")}>
          Créer une organisation
        </Link>
      </div>
    </main>
  );
}
