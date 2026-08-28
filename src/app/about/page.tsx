import Link from "next/link";
import type { Metadata } from "next";
import { SectionHeader } from "@/components/ui";

export const metadata: Metadata = { title: "About Us" };

export default function AboutPage() {
  return (
    <div className="container-p py-14">
      <div className="mx-auto max-w-3xl text-center">
        <span className="eyebrow">Our story</span>
        <h1 className="section-title">Marriage is the heart of Indian families. We made it honest and free.</h1>
        <p className="section-sub mt-4 !mx-auto">
          PANIKA JEEVAN SATHI was built on a simple belief: finding a life partner should never be locked behind
          subscriptions. Every feature — search, interest, chat, verification — is <strong>100% free, forever</strong>.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-3">
        {[
          ["🤝", "Trust first", "Admin-reviewed profiles, verification badges and a reporting system that keeps the community safe."],
          ["🪷", "Family first", "Detailed family, community and lifestyle sections, because in India, families marry families."],
          ["💯", "Free, always", "No paywalls. No premium tiers. No “unlock to see number”. If it's a matrimonial feature, it's free."],
        ].map(([icon, title, text]) => (
          <div key={title as string} className="card card-hover p-6 text-center">
            <span className="text-3xl" aria-hidden="true">{icon}</span>
            <h2 className="mt-3 font-display text-lg font-semibold text-ink">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5c6b62]">{text}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-14 max-w-3xl">
        <SectionHeader
          eyebrow="India + Global"
          title="Wherever you are, your sathi is here"
          sub="From the tea gardens of Assam to tech hubs in Bangalore, from Guwahati families in the UK to Bengalis in Dubai — our community spans India and the diaspora."
        />
        <div className="card p-6 text-sm leading-relaxed text-[#4c5c53]">
          <p>
            We know how much is at stake when a family searches for a life partner. So we built PANIKA JEEVAN SATHI to
            be the calm, trustworthy middle ground: honest profiles, clear details, private conversations and a team
            that reviews every report.
          </p>
          <p className="mt-3">
            Our goal is simple — more happy marriages, zero hidden costs.
          </p>
        </div>
        <div className="mt-8 text-center">
          <Link href="/register" className="btn btn-gold btn-lg">
            Start your free profile
          </Link>
        </div>
      </div>
    </div>
  );
}
