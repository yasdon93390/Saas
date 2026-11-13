import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-sm ${className}`}>{children}</section>
  );
}

export function CardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="border-b border-line px-6 py-4">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
    </header>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}
