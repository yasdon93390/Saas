/**
 * Rôles et permissions — source unique côté application.
 *
 * Cette matrice décide de ce que le SERVEUR accepte. Les mêmes règles sont
 * appliquées une seconde fois par la base de données (RLS et fonctions SQL) :
 * une erreur ici ne suffit donc pas à ouvrir un accès.
 */
export const ROLES = ["owner", "admin", "finance", "collaborator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  finance: "Finance",
  collaborator: "Collaborateur",
  viewer: "Lecture seule",
};

const everyone: readonly Role[] = ROLES;
const operators: readonly Role[] = ["owner", "admin", "finance"];
const administrators: readonly Role[] = ["owner", "admin"];
const ownerOnly: readonly Role[] = ["owner"];

export const PERMISSIONS = {
  "data.read": everyone,
  "tasks.handle": ["owner", "admin", "finance", "collaborator"],
  "data.write": operators,
  "payments.write": operators,
  "reminders.send": operators,
  "data.export": operators,
  "automation.manage": administrators,
  "members.manage": administrators,
  "integrations.manage": administrators,
  "audit.read": administrators,
  "billing.manage": ownerOnly,
  "organization.delete": ownerOnly,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/**
 * Rôles qu'un membre peut attribuer à quelqu'un d'autre.
 * Seul un propriétaire peut nommer un autre propriétaire.
 */
export function assignableRoles(actor: Role): readonly Role[] {
  if (actor === "owner") return ROLES;
  if (actor === "admin") return ROLES.filter((role) => role !== "owner");
  return [];
}

/** Un administrateur ne peut pas agir sur un propriétaire ; nul n'agit sur soi-même. */
export function canManageMember(actor: Role, target: { role: Role; isSelf: boolean }): boolean {
  if (target.isSelf || !can(actor, "members.manage")) return false;
  return actor === "owner" || target.role !== "owner";
}
