import "server-only";

import { forbidden, notFound, redirect } from "next/navigation";
import { cache } from "react";
import { can, isRole, type Permission, type Role } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { slugSchema } from "@/lib/validation/schemas";

export type CurrentUser = { id: string; email: string };

export type OrgContext = {
  user: CurrentUser;
  memberId: string;
  role: Role;
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    defaultCurrency: string;
  };
};

/**
 * Utilisateur connecté, ou null. L'identité est vérifiée auprès du serveur
 * d'authentification à chaque requête : on ne fait jamais confiance au seul
 * contenu du cookie.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Résout l'organisation active à partir de l'URL et vérifie que l'utilisateur
 * en est un membre actif. Renvoie null dans tous les autres cas, sans
 * distinguer « n'existe pas » de « vous n'y avez pas accès ».
 */
export const resolveOrgContext = cache(async (orgSlug: string): Promise<OrgContext | null> => {
  const user = await getCurrentUser();
  if (!user || !slugSchema.safeParse(orgSlug).success) return null;

  const supabase = await createClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, default_currency")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!organization) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("id, role, status")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member || member.status !== "active" || !isRole(member.role)) return null;

  return {
    user,
    memberId: member.id,
    role: member.role,
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      timezone: organization.timezone,
      defaultCurrency: organization.default_currency,
    },
  };
});

/**
 * À appeler au début de chaque PAGE d'une organisation.
 * Non connecté → page de connexion · non membre → 404 · permission manquante → 403.
 */
export async function requireOrgContext(orgSlug: string, permission: Permission): Promise<OrgContext> {
  await requireUser();
  const context = await resolveOrgContext(orgSlug);
  if (!context) notFound();
  if (!can(context.role, permission)) forbidden();
  return context;
}

export type Authorization = { ok: true; context: OrgContext } | { ok: false; error: string };

/**
 * À appeler au début de chaque ACTION serveur d'une organisation.
 * Renvoie un refus explicite au lieu d'interrompre le rendu.
 */
export async function authorizeAction(orgSlug: string, permission: Permission): Promise<Authorization> {
  const context = await resolveOrgContext(orgSlug);
  if (!context) return { ok: false, error: "Organisation introuvable ou session expirée." };
  if (!can(context.role, permission)) {
    return { ok: false, error: "Vous n'avez pas la permission d'effectuer cette action." };
  }
  return { ok: true, context };
}
