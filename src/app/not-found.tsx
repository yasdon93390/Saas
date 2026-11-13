import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-action">Erreur 404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Page introuvable</h1>
      <p className="mt-3 text-sm text-ink-soft">
        Cette page n&apos;existe pas, ou vous n&apos;y avez pas accès avec ce compte.
      </p>
      <Link href="/organizations" className={`${buttonClass("primary")} mt-6`}>
        Mes organisations
      </Link>
    </main>
  );
}
