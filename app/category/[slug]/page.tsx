import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { db } from "@/db";
import { categories, services } from "@/db/schema";
import { getCategoryIcon } from "@/lib/icons";
import { buildSearchUrl, formatPriceBand } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

async function getCategory(slug: string) {
  try {
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    if (!category) return null;

    const categoryServices = await db
      .select()
      .from(services)
      .where(eq(services.categoryId, category.id))
      .orderBy(asc(services.name));

    return {
      ...category,
      services: categoryServices.filter((s) => s.isActive),
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const category = await getCategory(params.slug);
  if (!category) return { title: "Category not found" };
  return {
    title: `${category.name} Services`,
    description: `Find trusted ${category.name.toLowerCase()} service providers near you. Compare prices and contact directly on Seva Market India.`,
  };
}

export default async function CategoryDetailPage({ params }: PageProps) {
  const category = await getCategory(params.slug);
  if (!category) notFound();

  const Icon = getCategoryIcon(category.icon);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-500">
        <Link href="/" className="hover:text-brand-700">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href="/categories" className="hover:text-brand-700">Categories</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium text-navy-900">{category.name}</span>
      </nav>

      {/* Header */}
      <header className="mt-6 flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Icon className="h-7 w-7" aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            {category.name}
            {category.nameHi ? <span className="ml-2 text-lg font-medium text-slate-400">{category.nameHi}</span> : null}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {category.services.length} services · guide prices included
          </p>
        </div>
      </header>

      {/* Services */}
      {category.services.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Services for this category are being added soon.
        </p>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {category.services.map((service) => (
            <li key={service.id}>
              <Link
                href={buildSearchUrl({ service: service.name, category: category.slug })}
                className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card"
              >
                <h2 className="text-[15px] font-semibold text-navy-900">{service.name}</h2>
                {service.description && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">{service.description}</p>
                )}
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-brand-700">
                    {formatPriceBand(service.priceMin, service.priceMax)}
                    {service.unit && (
                      <span className="ml-1 text-xs font-normal text-slate-400">/ {service.unit}</span>
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 transition-colors group-hover:text-brand-700">
                    <Search className="h-3.5 w-3.5" aria-hidden />
                    Find pros
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* CTA */}
      <div className="mt-10 rounded-2xl bg-navy-950 p-6 text-center sm:p-8">
        <h2 className="font-display text-lg font-bold text-white sm:text-xl">
          {category.name} ka provider hain?
        </h2>
        <p className="mt-1.5 text-sm text-navy-200">
          Apni services free list kijiye aur aapke area ke customers se judiye.
        </p>
        <Link
          href="/provider/join"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Become a Provider
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
