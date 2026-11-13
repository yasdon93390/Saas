import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-danger">Erreur 403</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Accès refusé</h1>
      <p className="mt-3 text-sm text-ink-soft">
        Votre rôle dans cette organisation ne permet pas d&apos;ouvrir cette page. Demandez à un
        administrateur de modifier vos droits si nécessaire.
      </p>
      <Link href="/organizations" className={`${buttonClass("secondary")} mt-6`}>
        Mes organisations
      </Link>
    </main>
  );
}
