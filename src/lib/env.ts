import { z } from "zod";

/**
 * Configuration lue une seule fois et validée. Si une variable manque,
 * l'application refuse de démarrer avec un message clair plutôt que de
 * tomber plus tard sur une erreur obscure.
 *
 * Ces trois valeurs sont publiques par nature (préfixe NEXT_PUBLIC_).
 * Aucun secret ne doit jamais porter ce préfixe.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().refine((url) => !url.endsWith("/"), "sans barre oblique finale"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuration invalide ou manquante : ${names}. Voir .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
