import Link from "next/link";
import Logo from "@/components/layout/Logo";
import { SITE, TOP_CITIES } from "@/lib/constants";
import { buildSearchUrl } from "@/lib/utils";

/**
 * Site footer — brand, customer/provider links, top-city search shortcuts.
 */
export default function Footer() {
  return (
    <footer className="bg-navy-950 text-navy-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        {/* Brand */}
        <div>
          <Logo light />
          <p className="mt-4 text-sm leading-6 text-navy-200">{SITE.description}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-navy-200">
            🇮🇳 Made in India, for India
          </p>
        </div>

        {/* For customers */}
        <nav aria-label="For customers">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white">For Customers</h3>
          <ul className="mt-4 space-y-3 text-sm">
            <li><Link className="hover:text-brand-300" href="/categories">Browse all categories</Link></li>
            <li><Link className="hover:text-brand-300" href="/search">Search providers</Link></li>
            <li><Link className="hover:text-brand-300" href="/#how-it-works">How it works</Link></li>
          </ul>
        </nav>

        {/* For providers */}
        <nav aria-label="For providers">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white">For Providers</h3>
          <ul className="mt-4 space-y-3 text-sm">
            <li><Link className="hover:text-brand-300" href="/provider/join">List your business</Link></li>
            <li><Link className="hover:text-brand-300" href="/provider/join#benefits">Why list with us</Link></li>
            <li><Link className="hover:text-brand-300" href="/provider/join#steps">How listing works</Link></li>
          </ul>
        </nav>

        {/* Top cities */}
        <nav aria-label="Top cities">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Top Cities</h3>
          <ul className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {TOP_CITIES.map((city) => (
              <li key={city}>
                <Link className="hover:text-brand-300" href={buildSearchUrl({ location: city })}>
                  {city}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-navy-300 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</p>
          <p className="flex items-center gap-3">
            <span className="cursor-default" title="Coming soon">Terms of Service</span>
            <span aria-hidden>·</span>
            <span className="cursor-default" title="Coming soon">Privacy Policy</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
