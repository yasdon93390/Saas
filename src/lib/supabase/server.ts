import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Client Supabase pour le code serveur, porteur de la session de l'utilisateur
 * courant. Toutes les requêtes passent donc par la RLS : la base refuse
 * elle-même ce que l'utilisateur n'a pas le droit de voir.
 *
 * Il n'existe volontairement aucun client Supabase côté navigateur.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = env();

  return createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Pendant le rendu d'une page, les cookies sont en lecture seule.
          // Le renouvellement de session est alors assuré par src/proxy.ts.
        }
      },
    },
  });
}
