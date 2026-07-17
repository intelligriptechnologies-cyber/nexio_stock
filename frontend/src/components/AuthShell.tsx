import type { ReactNode } from "react";

type AuthShellVariant = "shop" | "superadmin";

interface AuthShellProps {
  variant: AuthShellVariant;
  badge: string;
  title: string;
  subcopy: string;
  children: ReactNode;
}

const VARIANT_ACCENT: Record<AuthShellVariant, string> = {
  shop: "SHOP OPERATIONS",
  superadmin: "RESTRICTED ACCESS",
};

const noopLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
};

export function AuthShell({ variant, badge, title, subcopy, children }: AuthShellProps) {
  return (
    <div className="min-h-full overflow-hidden bg-[#0b0d10] text-[#f4f7fb]">
      <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(180,232,255,0.42),rgba(255,255,255,0.92)_24%,rgba(222,226,231,0.9)_48%,rgba(87,92,99,0.72)_76%,rgba(16,18,22,0.98)_100%),linear-gradient(180deg,#f4f5f7_0%,#d8dadd_24%,#91959b_58%,#2a2d32_82%,#0b0d10_100%)] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(102,114,126,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(102,114,126,0.08)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[42vh] bg-[radial-gradient(circle_at_50%_0%,rgba(138,230,255,0.18),transparent_62%)]" />
        <div className="pointer-events-none absolute inset-x-[12%] bottom-0 h-[44vh] rounded-t-[48px] bg-[linear-gradient(180deg,rgba(14,16,20,0)_0%,rgba(14,16,20,0.16)_24%,rgba(8,10,13,0.72)_100%)] blur-2xl" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center">
          <section className="auth-terminal-panel relative w-full overflow-hidden p-3 sm:p-4">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_16%,transparent_84%,rgba(143,232,255,0.06))]" />

            <div className="relative flex min-h-[720px] flex-col overflow-hidden rounded-[24px] border border-white/8 bg-[#0a0d11] sm:min-h-[760px]">
              <header className="flex flex-col gap-4 border-b border-white/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.34em] text-[#7f8b99]">System Node</div>
                  <div className="mt-2 text-xl font-semibold tracking-[0.18em] text-white sm:text-2xl">
                    Nexio <span className="text-[#8fe8ff]">Hyper</span>
                  </div>
                </div>
                <a href="#" onClick={noopLink} className="auth-terminal-link self-start uppercase tracking-[0.22em] sm:self-auto">
                  Help
                </a>
              </header>

              <div className="flex flex-1 flex-col justify-center px-4 py-8 sm:px-8 sm:py-12">
                <div className="mx-auto flex w-full max-w-[32rem] flex-col">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <span className="inline-flex rounded-full border border-[#2a3139] bg-[#0b1015] px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[#a7b4c1]">
                      {badge}
                    </span>
                    <span className="hidden text-[0.66rem] font-medium uppercase tracking-[0.3em] text-[#5f6a76] sm:inline">
                      {VARIANT_ACCENT[variant]}
                    </span>
                  </div>

                  <div className="auth-terminal-card p-5 sm:p-7">
                    <div className="mb-6">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-[#8fe8ff]">Terminal Access</div>
                      <h1 className="mt-3 text-[1.9rem] font-semibold tracking-[0.06em] text-white sm:text-[2.2rem]">{title}</h1>
                      <p className="mt-3 max-w-md text-sm leading-6 text-[#90a0af]">{subcopy}</p>
                    </div>
                    {children}
                  </div>
                </div>
              </div>

              <footer className="border-t border-white/8 bg-[#090c10] px-5 py-4 sm:px-8">
                <div className="flex flex-col gap-4 text-[0.72rem] uppercase tracking-[0.16em] text-[#6c7784] sm:flex-row sm:items-center sm:justify-between">
                  <div>Retail command surface for live stock movement.</div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <a href="#" onClick={noopLink} className="auth-terminal-link-muted">
                      Privacy Policy
                    </a>
                    <a href="#" onClick={noopLink} className="auth-terminal-link-muted">
                      Terms of Service
                    </a>
                    <span>Powered by Nexio Hyper</span>
                  </div>
                </div>
              </footer>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
