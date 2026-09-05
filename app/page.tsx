import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, services } from "@/db/schema";
import { FALLBACK_CATEGORIES } from "@/lib/constants";
import Hero from "@/components/home/Hero";
import CategoryGrid, { type CategoryCardData } from "@/components/home/CategoryGrid";
import HowItWorks from "@/components/home/HowItWorks";
import ProviderCta from "@/components/home/ProviderCta";

export const dynamic = "force-dynamic";

/**
 * Homepage category grid (single grouped query with service counts).
 * Falls back to static constants when the DB is unreachable/empty so the
 * landing page degrades gracefully instead of erroring out.
 */
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
      .orderBy(asc(categories.sortOrder))
      .limit(12);

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

export default async function HomePage() {
  const categories = await getCategories();

  return (
    <>
      <Hero />
      <CategoryGrid categories={categories} />
      <HowItWorks />
      <ProviderCta />
    </>
  );
}
