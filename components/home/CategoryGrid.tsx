import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCategoryIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

export interface CategoryCardData {
  name: string;
  nameHi?: string | null;
  slug: string;
  icon?: string | null;
  serviceCount?: number;
}

/**
 * Homepage categories grid — presentational, DB-driven via props.
 * 2 cols on mobile → 4 on desktop.
 */
export default function CategoryGrid({
  categories,
  showViewAll = true,
}: {
  categories: CategoryCardData[];
  showViewAll?: boolean;
}) {
  return (
    <section id="categories" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            Popular categories
          </h2>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            Ghar aur business ki har zarurat ke liye ek category
          </p>
        </div>
        {showViewAll && (
          <Link
            href="/categories"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            View all
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {categories.map((cat) => {
          const Icon = getCategoryIcon(cat.icon);
          return (
            <li key={cat.slug}>
              <Link
                href={`/category/${cat.slug}`}
                className="group flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card sm:p-5"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-navy-900 sm:text-[15px]">
                    {cat.name}
                  </span>
                  {cat.nameHi && (
                    <span className="mt-0.5 block text-xs text-slate-500">{cat.nameHi}</span>
                  )}
                </span>
                <span className="mt-auto text-xs font-medium text-slate-400">
                  {typeof cat.serviceCount === "number"
                    ? `${cat.serviceCount} services`
                    : "Explore services"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
