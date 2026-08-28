import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <div className="container-p max-w-3xl py-14">
      <span className="eyebrow">Legal</span>
      <h1 className="section-title">Terms of Service</h1>
      <p className="mt-3 text-sm text-[#7c8a81]">Last updated: August 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-[#4c5c53]">
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">1. About the service</h2>
          <p className="mt-2">
            PANIKA JEEVAN SATHI is a free matrimonial platform that helps adults find marriage partners. By creating an
            account you confirm you are at least 18 years old and that your profile information is truthful.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">2. Free service</h2>
          <p className="mt-2">
            All matrimonial features — registration, search, interest, shortlist, matching and private messaging — are
            100% free. We do not charge fees, run subscriptions or lock features behind payments.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">3. Acceptable use</h2>
          <p className="mt-2">
            You agree not to: post false or misleading information, harass, abuse or threaten other members, post
            offensive or inappropriate content, request money from members, create fake profiles, or use the service for
            any illegal purpose.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">4. Moderation</h2>
          <p className="mt-2">
            Our team reviews reported profiles and may suspend or delete accounts that break these terms or threaten
            the safety of the community. We act on every report.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">5. No guarantee</h2>
          <p className="mt-2">
            We help you find and connect with potential partners; the relationship between members is entirely their
            own. We are not responsible for personal decisions made by members.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">6. Contact</h2>
          <p className="mt-2">
            Questions about these terms? Email sukulpanika939@gmail.com or WhatsApp +91 8099834725.
          </p>
        </section>
      </div>
    </div>
  );
}
