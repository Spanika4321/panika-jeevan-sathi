import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ClipboardList, FileCheck2, PhoneCall, TrendingUp } from "lucide-react";

export const metadata: Metadata = {
  title: "Become a Provider",
  description:
    "List your service business on Seva Market India for free and reach customers searching in your city, locality and PIN code.",
};

const BENEFITS = [
  {
    icon: TrendingUp,
    title: "More local customers",
    description:
      "Jab bhi koi customer aapke shehar ya PIN code par service search karega, aapka business top results mein dikhega.",
  },
  {
    icon: BadgeCheck,
    title: "Verified provider badge",
    description:
      "Phone verification ke baad verified badge paiye — customers ki nazar mein trust turant badh jaata hai.",
  },
  {
    icon: ClipboardList,
    title: "Full control on listing",
    description:
      "Apni services, price band, service area aur timings khud manage kijiye — kabhi bhi update kar sakte hain.",
  },
] as const;

const STEPS = [
  { icon: ClipboardList, title: "1 · Submit details", description: "Business name, phone, city aur categories select kijiye." },
  { icon: FileCheck2, title: "2 · Get verified", description: "Hum aapka phone verify karke profile live karenge." },
  { icon: PhoneCall, title: "3 · Start getting calls", description: "Customers seedha aapko call karenge — no middleman." },
] as const;

export default function ProviderJoinPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-navy-950 to-navy-900 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 top-0 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute -right-20 bottom-0 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-14 text-center sm:px-6 sm:py-20 lg:px-8">
          <p className="inline-flex rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-brand-300">
            Provider registration — opening soon
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl font-display text-3xl font-bold leading-tight sm:text-5xl">
            Apne shehar ke har ghar tak apni services pahunchaiye
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-navy-100 sm:text-base">
            Seva Market India par free listing ke saath apne business ka digital presence banaiye.
            Launch phase mein listing 100% free hai — early providers ko priority verification
            milegi.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <span
              aria-disabled
              title="Registration form coming soon — foundation phase"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-white/10 px-6 py-3.5 text-sm font-semibold text-navy-200"
            >
              Registration opens soon
            </span>
            <Link
              href="/categories"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white hover:bg-brand-600"
            >
              Explore categories
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <h2 className="text-center font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
          Why list with Seva Market?
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-6">
          {BENEFITS.map((b) => (
            <li key={b.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <b.icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-navy-900">{b.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{b.description}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Steps */}
      <section id="steps" className="border-y border-slate-100 bg-slate-50/70">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            Listing process — teen steps
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((s) => (
              <li key={s.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <s.icon className="h-8 w-8 text-brand-600" aria-hidden />
                <h3 className="mt-4 font-display text-base font-semibold text-navy-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-600">{s.description}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-center text-xs text-slate-400">
            Note: online payments, paid plans aur lead-management tools roadmap par hain — abhi sirf
            foundation phase live hai.
          </p>
        </div>
      </section>
    </>
  );
}
