import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type AuthShellVariant = "shop" | "superadmin";

interface AuthShellProps {
  variant: AuthShellVariant;
  badge: string;
  title: string;
  subcopy: string;
  children: ReactNode;
  contentWidthClassName?: string;
  shellWidthClassName?: string;
  headerLink?: {
    label: string;
    to: string;
  };
  headerLinks?: Array<{
    label: string;
    to: string;
  }>;
  footerLink?: {
    label: string;
    to: string;
  };
}

const VARIANT_ACCENT: Record<AuthShellVariant, string> = {
  shop: "SHOP OPERATIONS",
  superadmin: "RESTRICTED ACCESS",
};

export function AuthShell({
  variant,
  badge,
  title,
  subcopy,
  children,
  contentWidthClassName = "max-w-[26rem]",
  shellWidthClassName = "max-w-[48rem]",
  headerLink,
  headerLinks,
  footerLink,
}: AuthShellProps) {
  const resolvedHeaderLinks = headerLinks ?? (headerLink ? [headerLink] : []);

  return (
    <div className="min-h-full overflow-x-hidden bg-[#0b0d10] text-[#f4f7fb]">
      <div className="relative min-h-screen overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(180,232,255,0.42),rgba(255,255,255,0.92)_24%,rgba(222,226,231,0.9)_48%,rgba(87,92,99,0.72)_76%,rgba(16,18,22,0.98)_100%),linear-gradient(180deg,#f4f5f7_0%,#d8dadd_24%,#91959b_58%,#2a2d32_82%,#0b0d10_100%)] px-3 py-3 sm:px-4 sm:py-4 lg:px-6 [@media(max-height:840px)]:px-2 [@media(max-height:840px)]:py-2">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(102,114,126,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(102,114,126,0.08)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[42vh] bg-[radial-gradient(circle_at_50%_0%,rgba(138,230,255,0.18),transparent_62%)]" />
        <div className="pointer-events-none absolute inset-x-[12%] bottom-0 h-[44vh] rounded-t-[48px] bg-[linear-gradient(180deg,rgba(14,16,20,0)_0%,rgba(14,16,20,0.16)_24%,rgba(8,10,13,0.72)_100%)] blur-2xl" />
        <div className={`relative mx-auto flex min-h-[calc(100vh-1.5rem)] w-full ${shellWidthClassName} items-center justify-center sm:min-h-[calc(100vh-2rem)] [@media(max-height:840px)]:min-h-[calc(100vh-1rem)]`}>
          <section className={`auth-terminal-panel relative my-auto w-full ${shellWidthClassName} overflow-hidden p-2 sm:p-2.5 [@media(max-height:840px)]:p-1.5`}>
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_16%,transparent_84%,rgba(143,232,255,0.06))]" />

            <div className="relative flex flex-col overflow-hidden rounded-[24px] border border-white/8 bg-[#0a0d11]">
              <header className="flex flex-col gap-2 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3.5 [@media(max-height:840px)]:gap-1.5 [@media(max-height:840px)]:px-4 [@media(max-height:840px)]:py-2.5">
                <div className="text-center sm:text-left">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.34em] text-[#7f8b99]">System Node</div>
                  <div className="mt-1.5 text-xl font-semibold tracking-[0.18em] text-white sm:text-[1.85rem] [@media(max-height:840px)]:mt-1 [@media(max-height:840px)]:text-[1.3rem]">
                    Nexio <span className="text-[#8fe8ff]">Hyper</span>
                  </div>
                  <div className="mt-1 text-center text-[0.62rem] font-medium uppercase tracking-[0.26em] text-[#6f7b87] sm:text-center">
                    Powered by Nexio Hyper
                  </div>
                </div>
                {resolvedHeaderLinks.length > 0 ? (
                  <div className="flex flex-col items-start gap-1 self-start sm:items-end sm:self-auto">
                    {resolvedHeaderLinks.map((link) => (
                      <Link
                        key={`${link.label}-${link.to}`}
                        to={link.to}
                        className="auth-terminal-link text-[0.72rem] font-normal uppercase tracking-[0.16em] text-[#7fd8ec] hover:text-[#bceffa]"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </header>

              <div className="flex flex-1 flex-col justify-center px-4 py-4 sm:px-6 sm:py-5 [@media(max-height:840px)]:px-4 [@media(max-height:840px)]:py-3">
                <div className={`mx-auto flex w-full ${contentWidthClassName} flex-col`}>
                  <div className="mb-2.5 flex items-center justify-between gap-4 [@media(max-height:840px)]:mb-2">
                    <span className="inline-flex rounded-full border border-[#2a3139] bg-[#0b1015] px-4 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.3em] text-[#a7b4c1] [@media(max-height:840px)]:px-3.5 [@media(max-height:840px)]:py-1.5">
                      {badge}
                    </span>
                    <span className="hidden text-[0.66rem] font-medium uppercase tracking-[0.3em] text-[#5f6a76] sm:inline [@media(max-height:840px)]:hidden">
                      {VARIANT_ACCENT[variant]}
                    </span>
                  </div>

                  <div className="auth-terminal-card p-4 sm:p-5 [@media(max-height:840px)]:p-3.5">
                    <div className="mb-4 [@media(max-height:840px)]:mb-3">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-[#8fe8ff]">Terminal Access</div>
                      <h1 className="mt-2 text-[1.55rem] font-semibold tracking-[0.05em] text-white sm:text-[1.9rem] [@media(max-height:840px)]:mt-1.5 [@media(max-height:840px)]:text-[1.38rem]">
                        {title}
                      </h1>
                      <p className="mt-2 max-w-md text-[0.92rem] leading-5 text-[#90a0af] [@media(max-height:840px)]:mt-1.5 [@media(max-height:840px)]:text-[0.82rem] [@media(max-height:840px)]:leading-5">
                        {subcopy}
                      </p>
                    </div>
                    {children}
                  </div>
                </div>
              </div>

              <footer className="border-t border-white/8 bg-[#090c10] px-4 py-2.5 sm:px-6 sm:py-3 [@media(max-height:840px)]:px-4 [@media(max-height:840px)]:py-2">
                <div className="flex flex-col gap-2 text-[0.68rem] uppercase tracking-[0.14em] text-[#6c7784] sm:flex-row sm:items-center sm:justify-between">
                  <div>Retail command surface for live stock movement.</div>
                  {footerLink ? (
                    <Link to={footerLink.to} className="auth-terminal-link text-[0.68rem] uppercase tracking-[0.16em]">
                      {footerLink.label}
                    </Link>
                  ) : null}
                </div>
              </footer>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
