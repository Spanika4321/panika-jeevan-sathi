import type { Metadata } from "next";
import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { BadgeCheck, BriefcaseBusiness, MapPin, Phone, Star, Users } from "lucide-react";
import { db } from "@/db";
import { providerProfiles } from "@/db/schema";
import { searchParamsSchema, type SearchParams } from "@/lib/validation";
import { buildProviderWhere } from "@/lib/search";
import SearchBar from "@/components/search/SearchBar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search Providers",
  description: "Search verified local service providers by service, city, locality or PIN code.",
};

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

async function searchProviders(filters: SearchParams) {
  try {
    return await db.query.providerProfiles.findMany({
      where: buildProviderWhere(filters),
      orderBy: [
        desc(providerProfiles.isVerified),
        desc(providerProfiles.ratingAvg),
        asc(providerProfiles.createdAt),
      ],
      limit: 24,
      with: {
        user: { columns: { name: true, phone: true } },
        locality: {
          columns: { name: true, pinCode: true },
          with: { city: { columns: { name: true } } },
        },
        services: {
          columns: {},
          with: { service: { columns: { name: true } } },
        },
      },
    });
  } catch {
    return [];
  }
}

export default async function SearchPage({ searchParams }: PageProps) {
  const parsed = searchParamsSchema.safeParse(searchParams);
  const filters: SearchParams = parsed.success
    ? parsed.data
    : { service: "", location: "", pin: "", category: "" };
  const providers = await searchProviders(filters);

  const activeFilters = [filters.service, filters.location, filters.pin].filter(Boolean);
  const hasQuery = activeFilters.length > 0;

  return (
    <>
      {/* Search header */}
      <div className="border-b border-slate-100 bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <h1 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            {hasQuery ? "Search results" : "Find service providers"}
          </h1>
          {hasQuery && (
            <p className="mt-1.5 text-sm text-slate-600">
              {activeFilters.map((f, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1.5 text-slate-300">|</span>}
                  <span className="font-medium text-navy-900">{f}</span>
                </span>
              ))}
            </p>
          )}
          <div className="mt-5">
            <SearchBar
              initialService={filters.service}
              initialLocation={filters.location}
              initialPin={filters.pin}
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-medium text-slate-500">
          {providers.length} provider{providers.length === 1 ? "" : "s"} found
        </p>

        {providers.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
            <BriefcaseBusiness className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
            <h2 className="mt-4 font-display text-lg font-semibold text-navy-900">
              Is area mein abhi koi provider listed nahi hai
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Try a different service or nearby city — ya phir apna business list karke pehle
              provider baniye.
            </p>
            <Link
              href="/provider/join"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Users className="h-4 w-4" aria-hidden />
              List your business — free
            </Link>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {providers.map((p) => {
              const serviceNames = p.services.map((s) => s.service.name);
              return (
                <li key={p.id}>
                  <article className="flex h-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-card sm:flex-row">
                    {/* Avatar */}
                    <div className="flex sm:flex-col sm:items-center">
                      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy-100 font-display text-base font-bold text-navy-700">
                        {p.businessName.slice(0, 2).toUpperCase()}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-base font-semibold text-navy-900">
                          {p.businessName}
                        </h2>
                        {p.isVerified && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                            Verified
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-slate-600">
                        {p.about ?? "Home & local services professional."}
                      </p>

                      {p.locality && (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                          <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                          {p.locality.name}, {p.locality.city.name} — {p.locality.pinCode}
                        </p>
                      )}

                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {serviceNames.slice(0, 4).map((name) => (
                          <li
                            key={name}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                          >
                            {name}
                          </li>
                        ))}
                        {serviceNames.length > 4 && (
                          <li className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                            +{serviceNames.length - 4} more
                          </li>
                        )}
                      </ul>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-900">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                          {p.ratingAvg.toFixed(1)}
                          <span className="font-normal text-slate-400">({p.ratingCount})</span>
                        </span>
                        <a
                          href={`tel:${p.user.phone}`}
                          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                        >
                          <Phone className="h-4 w-4" aria-hidden />
                          Contact
                        </a>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
