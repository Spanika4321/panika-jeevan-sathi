"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Grid2x2, Home, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile-only bottom navigation bar (app-like thumb reach).
 * Hidden from md upwards.
 */
const ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/categories", label: "Categories", icon: Grid2x2 },
  { href: "/search", label: "Search", icon: Search },
  { href: "/provider/join", label: "Provider", icon: Briefcase },
] as const;

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Bottom"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-brand-600" : "text-slate-500 hover:text-navy-900"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
