import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validation/schemas";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Point d'arrivée des liens envoyés par email (confirmation d'inscription,
 * réinitialisation du mot de passe). Échange le code à usage unique contre
 * une session, puis redirige vers une page INTERNE uniquement.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const site = env().NEXT_PUBLIC_SITE_URL;
  const next = safeRedirectPath(searchParams.get("next"));
  const supabase = await createClient();

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${site}${next}`);
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${site}${next}`);
  }

  return NextResponse.redirect(`${site}/login?error=link`);
}
