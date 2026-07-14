import type { ReactNode } from "react";
import { ArrowRight, Boxes, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

type AuthShellVariant = "shop" | "superadmin";

interface AuthShellProps {
  variant: AuthShellVariant;
  title: string;
  subcopy?: string;
  footerActionLabel: string;
  footerActionTo: string;
  footerActionText: string;
  children: ReactNode;
}

const VARIANT_COPY: Record<
  AuthShellVariant,
  {
    brand: string;
    accent: string;
    status: string;
    Icon: typeof Boxes;
  }
> = {
  shop: {
    brand: "Nexio",
    accent: "Hyper",
    status: "Shop operations",
    Icon: Boxes,
  },
  superadmin: {
    brand: "Nexio",
    accent: "Hyper",
    status: "Admin control",
    Icon: ShieldCheck,
  },
};

export function AuthShell({
  variant,
  title,
  subcopy,
  footerActionLabel,
  footerActionTo,
  footerActionText,
  children,
}: AuthShellProps) {
  const copy = VARIANT_COPY[variant];
  const BrandIcon = copy.Icon;

  return (
    <div className="relative min-h-full overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_34%),linear-gradient(180deg,_#181411_0%,_#0f0d0b_45%,_#0a0908_100%)] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(245,158,11,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(245,158,11,0.05)_1px,transparent_1px)] bg-[size:88px_88px] opacity-25" />
      <div className="pointer-events-none absolute left-1/2 top-20 h-[18rem] w-[18rem] -translate-x-1/2 rounded-full bg-amber-300/12 blur-[110px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-xl items-center justify-center py-6">
        <section className="relative w-full overflow-hidden rounded-[2rem] border border-amber-200/10 bg-[#171311]/95 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl sm:p-5">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_18%,transparent_82%,rgba(245,158,11,0.06))]" />
          <div className="relative flex min-h-[540px] flex-col rounded-[1.55rem] border border-white/8 bg-[#211b18] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6">
            <div className="flex items-center justify-between gap-4 rounded-[1.25rem] border border-white/8 bg-white/[0.025] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-300/15 bg-amber-300/10 text-amber-200">
                  <BrandIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-semibold tracking-tight text-white">
                    {copy.brand} <span className="text-amber-300">{copy.accent}</span>
                  </div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-100/55">
                    {copy.status}
                  </div>
                </div>
              </div>
              <div className="hidden h-2 w-20 rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-amber-100/70 sm:block" />
            </div>

            <div className="mt-4 flex-1 rounded-[1.45rem] border border-white/8 bg-[#2a2320] px-5 py-5 sm:px-6 sm:py-6">
              <div className="mb-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-100/55">
                  Secure sign in
                </div>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">{title}</h1>
                {subcopy ? <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">{subcopy}</p> : null}
              </div>
              {children}
            </div>

            <div className="mt-4 border-t border-white/8 pt-4">
              <div className="flex flex-col gap-3 text-xs text-slate-300 sm:flex-row sm:items-center sm:justify-between">
                <div className="leading-5">{footerActionText}</div>
                <Link
                  to={footerActionTo}
                  className="inline-flex h-10 items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.06] px-4 font-semibold text-white transition-colors hover:bg-white/[0.1]"
                >
                  {footerActionLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
