import { IndianRupee, MapPin, ShieldCheck } from "lucide-react";
import SearchBar from "@/components/search/SearchBar";

/**
 * Homepage hero — headline + service/location/PIN search + trust markers.
 */
export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-orange-50/50 to-white">
      {/* decorative shapes */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-200/40 blur-3xl" />
        <div className="absolute -right-24 top-10 h-72 w-72 rounded-full bg-navy-200/30 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-12 text-center sm:px-6 sm:pb-16 sm:pt-16 lg:px-8">
        <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-4 py-1.5 text-xs font-semibold text-brand-700 shadow-sm">
          🇮🇳 India&rsquo;s local services marketplace
        </p>

        <h1 className="mx-auto mt-5 max-w-3xl font-display text-3xl font-bold leading-tight tracking-tight text-navy-900 sm:text-5xl sm:leading-[1.15]">
          Trusted local professionals,{" "}
          <span className="bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">
            aapke aas-paas
          </span>
        </h1>

        <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
          Electrician se lekar home tutor tak — apne shehar, locality ya PIN code par search kijiye,
          compare kijiye aur seedha contact kijiye. Customers ke liye 100% free.
        </p>

        <div className="mx-auto mt-8 max-w-4xl">
          <SearchBar />
        </div>

        {/* trust markers */}
        <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-slate-600">
          <li className="inline-flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden />
            Verified providers
          </li>
          <li className="inline-flex items-center gap-2">
            <MapPin className="h-5 w-5 text-brand-600" aria-hidden />
            Pan-India — 28 states &amp; 8 UTs
          </li>
          <li className="inline-flex items-center gap-2">
            <IndianRupee className="h-5 w-5 text-brand-600" aria-hidden />
            Free for customers
          </li>
        </ul>
      </div>
    </section>
  );
}
