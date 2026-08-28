import Link from "next/link";
import { clsx } from "@/lib/utils";

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="20" cy="26" r="13" stroke="#1D5649" strokeWidth="3.4" />
      <circle cx="29" cy="22" r="13" stroke="#F7941D" strokeWidth="3.4" />
      <path d="M24.5 12.5c.9-2.6 3.4-4.4 6.1-4.4-1 2.8 0 5.9 2.4 7.7-3 0-6-1.5-7.6-3.3Z" fill="#F7941D" />
      <path d="M24.5 12.5c-.9-2.6-3.4-4.4-6.1-4.4 1 2.8 0 5.9-2.4 7.7 3 0 6-1.5 7.6-3.3Z" fill="#1D5649" />
    </svg>
  );
}

export default function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={clsx("flex items-center gap-2.5", className)} aria-label="PANIKA JEEVAN SATHI home">
      <LogoMark />
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-semibold tracking-wide text-brand-900">
          PANIKA <span className="text-gold-600">JEEVAN</span> SATHI
        </span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-600">
          Free Matrimony
        </span>
      </span>
    </Link>
  );
}
