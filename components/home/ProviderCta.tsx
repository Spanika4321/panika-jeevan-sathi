import Link from "next/link";
import { ArrowRight, BadgeCheck, IndianRupee, TrendingUp } from "lucide-react";

const BENEFITS = [
  { icon: IndianRupee, title: "Free listing*", description: "Launch phase mein listing bilkul free — zero setup cost." },
  { icon: TrendingUp, title: "Local leads", description: "Aapke area ke customers jab bhi service search karein, aap dikhai dein." },
  { icon: BadgeCheck, title: "Verified badge", description: "Verification complete karke trust badhaiye aur zyada enquiries paiye." },
] as const;

/**
 * Provider acquisition banner (CTA → /provider/join).
 */
export default function ProviderCta() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-950 to-navy-900 px-6 py-12 text-center sm:px-12">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" />
        </div>

        <div className="relative">
          <h2 className="mx-auto max-w-2xl font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Apna service business online lao —{" "}
            <span className="text-brand-400">free listing ke saath</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-navy-100 sm:text-base">
            Electrician, plumber, tutor, cleaner — jo bhi service aap dete hain, hazaron customers
            tak pahunchiye. Early providers ko priority verification milegi.
          </p>

          <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
            {BENEFITS.map((b) => (
              <li key={b.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <b.icon className="h-5 w-5 text-brand-400" aria-hidden />
                <h3 className="mt-2.5 text-sm font-semibold text-white">{b.title}</h3>
                <p className="mt-1 text-xs leading-5 text-navy-200">{b.description}</p>
              </li>
            ))}
          </ul>

          <Link
            href="/provider/join"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lifted transition-colors hover:bg-brand-600"
          >
            Become a Provider
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <p className="mt-3 text-xs text-navy-300">*Payments &amp; paid plans are on our roadmap — not live yet.</p>
        </div>
      </div>
    </section>
  );
}
