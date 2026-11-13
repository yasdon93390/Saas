import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CashPilot AI", template: "%s · CashPilot AI" },
  description: "Suivi des factures impayées et relance amiable.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
