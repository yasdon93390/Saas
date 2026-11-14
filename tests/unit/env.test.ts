import { describe, expect, it } from "vitest";
import { envSchema } from "@/lib/env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://exemple.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
  NEXT_PUBLIC_SITE_URL: "https://app.exemple.test",
};

describe("configuration", () => {
  it.each(["\n", " ", "/", "/\n", "//  "])("nettoie une adresse collée avec %j en trop", (suffix) => {
    const parsed = envSchema.parse({
      ...valid,
      NEXT_PUBLIC_SITE_URL: valid.NEXT_PUBLIC_SITE_URL + suffix,
      NEXT_PUBLIC_SUPABASE_URL: ` ${valid.NEXT_PUBLIC_SUPABASE_URL}${suffix}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `${valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}\n`,
    });
    expect(parsed).toEqual(valid);
  });

  it("refuse toujours une valeur absente ou qui n'est pas une adresse", () => {
    expect(envSchema.safeParse({ ...valid, NEXT_PUBLIC_SITE_URL: undefined }).success).toBe(false);
    expect(envSchema.safeParse({ ...valid, NEXT_PUBLIC_SITE_URL: "cashpilot" }).success).toBe(false);
    expect(envSchema.safeParse({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "trop-court" }).success).toBe(false);
  });
});
