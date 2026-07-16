// Shared frame for every /auth screen so branding, the demo disclosure,
// and the centered card stay identical across sign-in, recovery, and verification.
export function AuthCard({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:p-8">
      <div className="card w-full max-w-md border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-6 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-field bg-neutral font-black text-neutral-content" aria-hidden>A</span>
            <span>
              <strong className="block text-sm">ANDA Dashboard</strong>
              <span className="text-xs opacity-55">Argentine Neighborhood Development Association</span>
            </span>
          </div>
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm opacity-60">{lede}</p>
          </div>
          {children}
          <p className="border-t border-base-300 pt-3 text-xs opacity-55">
            Interactive demo — nothing is sent anywhere, no real account exists, and these screens do not secure the demo routes.
          </p>
        </div>
      </div>
    </main>
  );
}
