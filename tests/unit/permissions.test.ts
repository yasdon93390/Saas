import { describe, expect, it } from "vitest";
import { assignableRoles, can, canManageMember, PERMISSIONS, ROLES, type Permission, type Role } from "@/lib/permissions";

/** Matrice attendue, recopiée du document de cadrage (§4.4). Toute divergence fait échouer le test. */
const EXPECTED: Record<Permission, Role[]> = {
  "data.read": ["owner", "admin", "finance", "collaborator", "viewer"],
  "tasks.handle": ["owner", "admin", "finance", "collaborator"],
  "data.write": ["owner", "admin", "finance"],
  "payments.write": ["owner", "admin", "finance"],
  "reminders.send": ["owner", "admin", "finance"],
  "data.export": ["owner", "admin", "finance"],
  "automation.manage": ["owner", "admin"],
  "members.manage": ["owner", "admin"],
  "integrations.manage": ["owner", "admin"],
  "audit.read": ["owner", "admin"],
  "billing.manage": ["owner"],
  "organization.delete": ["owner"],
};

describe("matrice des permissions", () => {
  it("couvre exactement les permissions attendues", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const permission of Object.keys(EXPECTED) as Permission[]) {
    for (const role of ROLES) {
      const allowed = EXPECTED[permission].includes(role);
      it(`${role} ${allowed ? "peut" : "ne peut pas"} ${permission}`, () => {
        expect(can(role, permission)).toBe(allowed);
      });
    }
  }

  it("la lecture seule ne permet aucune écriture", () => {
    const granted = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can("viewer", p));
    expect(granted).toEqual(["data.read"]);
  });
});

describe("gestion des membres", () => {
  it("seul un propriétaire peut attribuer le rôle de propriétaire", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    for (const role of ["finance", "collaborator", "viewer"] as const) {
      expect(assignableRoles(role)).toEqual([]);
    }
  });

  it("un administrateur ne peut pas agir sur un propriétaire", () => {
    expect(canManageMember("admin", { role: "owner", isSelf: false })).toBe(false);
    expect(canManageMember("admin", { role: "finance", isSelf: false })).toBe(true);
    expect(canManageMember("owner", { role: "owner", isSelf: false })).toBe(true);
  });

  it("nul n'agit sur lui-même", () => {
    for (const role of ROLES) {
      expect(canManageMember(role, { role, isSelf: true })).toBe(false);
    }
  });
});
