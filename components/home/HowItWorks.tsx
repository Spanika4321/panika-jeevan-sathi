import { PhoneCall, Search, Star } from "lucide-react";

const STEPS = [
  {
    icon: Search,
    title: "Search kijiye",
    description:
      "Service, city, locality ya PIN code se certified local professionals dhoondhiye — seconds mein.",
  },
  {
    icon: Star,
    title: "Compare kijiye",
    description:
      "Services, price band, experience aur ratings side-by-side compare karke best provider chuniye.",
  },
  {
    icon: PhoneCall,
    title: "Contact & book",
    description:
      "Provider ko seedha call kijiye ya enquiry bhejiye. Koi middleman nahi, koi hidden charge nahi.",
  },
] as const;

/**
 * "How it works" — 3-step explainer for customers.
 */
export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y border-slate-100 bg-slate-50/70">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            How Seva Market works
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600 sm:text-base">
            Teen aasan steps — search se booking tak
          </p>
        </div>

        <ol className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-3 sm:gap-6">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <span className="absolute -top-3 left-6 inline-flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <step.icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-navy-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
