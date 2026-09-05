import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, services } from "@/db/schema";
import { FALLBACK_CATEGORIES } from "@/lib/constants";
import CategoryGrid, { type CategoryCardData } from "@/components/home/CategoryGrid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All Categories",
  description:
    "Browse every service category on Seva Market India — electricians, plumbers, carpenters, cleaners, tutors, packers & movers and more.",
};

async function getCategories(): Promise<CategoryCardData[]> {
  try {
    const rows = await db
      .select({
        name: categories.name,
        nameHi: categories.nameHi,
        slug: categories.slug,
        icon: categories.icon,
        serviceCount: sql<number>`count(case when ${services.isActive} = 1 then 1 end)`,
      })
      .from(categories)
      .leftJoin(services, eq(services.categoryId, categories.id))
      .where(eq(categories.isActive, true))
      .groupBy(categories.id)
      .orderBy(asc(categories.sortOrder));

    if (rows.length === 0) {
      return FALLBACK_CATEGORIES.map((c) => ({ ...c, serviceCount: undefined }));
    }
    return rows.map((r) => ({
      name: r.name,
      nameHi: r.nameHi,
      slug: r.slug,
      icon: r.icon,
      serviceCount: Number(r.serviceCount) || undefined,
    }));
  } catch {
    return FALLBACK_CATEGORIES.map((c) => ({ ...c, serviceCount: undefined }));
  }
}

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <>
      <div className="border-b border-slate-100 bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-navy-900">
            All categories
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-600 sm:text-base">
            Har category mein detailed services, guide prices aur verified providers milenge.
          </p>
        </div>
      </div>
      <CategoryGrid categories={categories} showViewAll={false} />
    </>
  );
}
