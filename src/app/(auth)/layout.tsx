export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-lg font-semibold tracking-tight text-ink">
          CashPilot <span className="text-action">AI</span>
        </p>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
