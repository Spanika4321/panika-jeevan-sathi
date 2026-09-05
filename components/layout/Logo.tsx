import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Brand logo — saffron gradient mark + wordmark.
 */
export default function Logo({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <Link href="/" aria-label="Seva Market India — home" className={cn("group inline-flex items-center gap-2.5", className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 font-display text-lg font-extrabold text-white shadow-sm transition-transform group-hover:scale-105">
        S
      </span>
      <span className="flex flex-col leading-none">
        <span className={cn("font-display text-lg font-bold tracking-tight", light ? "text-white" : "text-navy-900")}>
          Seva<span className="text-brand-500">Market</span>
        </span>
        <span className={cn("mt-0.5 text-[9px] font-semibold uppercase tracking-[0.32em]", light ? "text-navy-200" : "text-navy-400")}>
          India
        </span>
      </span>
    </Link>
  );
}
