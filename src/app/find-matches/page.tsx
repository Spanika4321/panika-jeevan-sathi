import Link from "next/link";
import type { Metadata } from "next";
import { PageSearchParams } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { getSearchResults } from "@/lib/data";
import ProfileCard from "@/components/profile-card";
import { EmptyState } from "@/components/ui";
import {
  communityOptions,
  educationOptions,
  locationOptions,
  maritalStatusOptions,
  religionOptions,
} from "@/lib/constants";


export const metadata: Metadata = { title: "Search Profiles" };

export default async function FindMatchesPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") params[k] = v;
  }
  const user = await getCurrentUser();
  const { results, page, hasNext } = await getSearchResults(params as Record<string, string>, user?.id ?? null);

  const hasActiveFilter =
    params.lookingFor || params.ageMin || params.ageMax || params.location || params.religion || params.community ||
    params.motherTongue || params.maritalStatus || params.education || params.profession || params.incomeMin ||
    params.heightMin || params.sort;

  const buildUrl = (over: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params as Record<string, string>)) {
      if (value) qs.set(key, value);
    }
    for (const [key, value] of Object.entries(over)) {
      if (value) qs.set(key, value);
      else qs.delete(key);
    }
    const s = qs.toString();
    return `/find-matches${s ? `?${s}` : ""}`;
  };

  return (
    <div className="container-p py-10">
      <div className="mb-8">
        <span className="eyebrow">Profile search</span>
        <h1 className="section-title">Search genuine profiles</h1>
        <p className="section-sub mt-2">
          {user
            ? "Refine with the filters on the left — every search is 100% free."
            : "Browsing public profiles — login to see all member profiles and unlock search for everyone."}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
        {/* Filters */}
        <aside>
          <form action="/find-matches" method="GET" className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-ink">Filters</h2>
              <Link href="/find-matches" className="text-xs font-bold text-brand-700 hover:underline">
                Clear all
              </Link>
            </div>

            <div>
              <label className="label" htmlFor="f-lookingFor">Looking for</label>
              <select id="f-lookingFor" name="lookingFor" className="select" defaultValue={params.lookingFor ?? ""}>
                <option value="">Anyone</option>
                <option value="Female">Bride (Female)</option>
                <option value="Male">Groom (Male)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="f-ageMin">Age from</label>
                <input id="f-ageMin" name="ageMin" type="number" min={18} max={80} className="input" defaultValue={params.ageMin ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="f-ageMax">Age to</label>
                <input id="f-ageMax" name="ageMax" type="number" min={18} max={80} className="input" defaultValue={params.ageMax ?? ""} />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="f-location">Location</label>
              <input
                id="f-location"
                name="location"
                list="city-list"
                placeholder="Type or pick a city"
                className="input"
                defaultValue={params.location ?? ""}
              />
              <datalist id="city-list">
                {locationOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="label" htmlFor="f-religion">Religion</label>
              <select id="f-religion" name="religion" className="select" defaultValue={params.religion ?? ""}>
                <option value="">Any</option>
                {religionOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-community">Community</label>
              <select id="f-community" name="community" className="select" defaultValue={params.community ?? ""}>
                <option value="">Any</option>
                {communityOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-marital">Marital status</label>
              <select id="f-marital" name="maritalStatus" className="select" defaultValue={params.maritalStatus ?? ""}>
                <option value="">Any</option>
                {maritalStatusOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-education">Education</label>
              <select id="f-education" name="education" className="select" defaultValue={params.education ?? ""}>
                <option value="">Any</option>
                {educationOptions.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="f-profession">Profession (contains)</label>
              <input id="f-profession" name="profession" placeholder="e.g. Doctor" className="input" defaultValue={params.profession ?? ""} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="f-incomeMin">Income ≥ (₹/yr)</label>
                <input id="f-incomeMin" name="incomeMin" type="number" min={0} step={100000} className="input" defaultValue={params.incomeMin ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="f-heightMin">Height ≥ (cm)</label>
                <input id="f-heightMin" name="heightMin" type="number" min={130} max={210} className="input" defaultValue={params.heightMin ?? ""} />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="f-sort">Sort by</label>
              <select id="f-sort" name="sort" className="select" defaultValue={params.sort ?? "recent"}>
                <option value="recent">Newest first</option>
                <option value="relevant">Relevance</option>
                <option value="age">Age (high to low)</option>
                <option value="age_desc">Age (low to high)</option>
                <option value="location">Location (A–Z)</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary w-full">
              Apply filters
            </button>
          </form>
        </aside>

        {/* Results */}
        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-[#5c6b62]">
              {results.length} profile{results.length === 1 ? "" : "s"}
              {hasActiveFilter ? " match your filters" : " available"}
            </p>
            {!user && (
              <Link href="/login" className="btn btn-gold btn-sm">
                Login to see all profiles
              </Link>
            )}
          </div>

          {results.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="No profiles found"
              sub="Try widening your filters — or check back later, new members join every day."
              action={
                <Link href="/find-matches" className="btn btn-primary">
                  Clear filters
                </Link>
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((profile) => (
                <ProfileCard key={profile.userId} profile={profile} />
              ))}
            </div>
          )}

          <div className="mt-8 flex items-center justify-center gap-3">
            {page > 1 && (
              <Link href={buildUrl({ page: String(page - 1) })} className="btn btn-outline btn-sm">
                ← Previous
              </Link>
            )}
            <span className="text-sm font-bold text-[#5c6b62]">Page {page}</span>
            {hasNext && (
              <Link href={buildUrl({ page: String(page + 1) })} className="btn btn-outline btn-sm">
                Next →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
