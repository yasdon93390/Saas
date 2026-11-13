import { AppShell } from "@/components/layout/app-shell";
import { requireOrgContext } from "@/lib/auth/context";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug, "data.read");
  return <AppShell context={context}>{children}</AppShell>;
}
