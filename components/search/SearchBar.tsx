"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Hash, MapPin, Search, SearchIcon } from "lucide-react";
import { POPULAR_SERVICES } from "@/lib/constants";
import { buildSearchUrl } from "@/lib/utils";

interface SearchBarProps {
  initialService?: string;
  initialLocation?: string;
  initialPin?: string;
}

/**
 * The core marketplace search bar — service + city/locality + PIN code.
 * Used on the homepage hero and on the /search results page.
 */
export default function SearchBar({
  initialService = "",
  initialLocation = "",
  initialPin = "",
}: SearchBarProps) {
  const router = useRouter();
  const [service, setService] = useState(initialService);
  const [location, setLocation] = useState(initialLocation);
  const [pin, setPin] = useState(initialPin);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    router.push(buildSearchUrl({ service, location, pin }));
  }

  return (
    <div className="w-full">
      <form
        onSubmit={handleSubmit}
        aria-label="Search service providers"
        className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-card sm:grid-cols-[1.2fr_1.2fr_0.8fr_auto]"
      >
        {/* Service */}
        <label className="group relative flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors focus-within:bg-brand-50/60 hover:bg-slate-50">
          <SearchIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <span className="sr-only">Service</span>
          <input
            type="text"
            name="service"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="What do you need? e.g. Electrician"
            className="w-full bg-transparent text-sm text-navy-900 outline-none placeholder:text-slate-400"
          />
        </label>

        {/* Location */}
        <label className="flex items-center gap-2 rounded-xl border-slate-200 px-3 py-2.5 transition-colors focus-within:bg-brand-50/60 hover:bg-slate-50 sm:border-l">
          <MapPin className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <span className="sr-only">City or locality</span>
          <input
            type="text"
            name="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or locality, e.g. Karol Bagh"
            className="w-full bg-transparent text-sm text-navy-900 outline-none placeholder:text-slate-400"
          />
        </label>

        {/* PIN */}
        <label className="flex items-center gap-2 rounded-xl border-slate-200 px-3 py-2.5 transition-colors focus-within:bg-brand-50/60 hover:bg-slate-50 sm:border-l">
          <Hash className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <span className="sr-only">PIN code</span>
          <input
            type="text"
            name="pin"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="PIN code"
            className="w-full bg-transparent text-sm text-navy-900 outline-none placeholder:text-slate-400"
          />
        </label>

        {/* Submit */}
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search
        </button>
      </form>

      {/* Popular quick searches */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Popular:</span>
        {POPULAR_SERVICES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => router.push(buildSearchUrl({ service: s }))}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
