import type { ReactNode } from "react";

const TONES = {
  error: "border-danger/30 bg-danger-soft text-danger",
  success: "border-success/30 bg-success-soft text-success",
  info: "border-line bg-canvas text-ink-soft",
} as const;

export function Alert({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}
    >
      <span className="font-semibold">
        {tone === "error" ? "Erreur : " : tone === "success" ? "C'est fait : " : ""}
      </span>
      {children}
    </p>
  );
}
