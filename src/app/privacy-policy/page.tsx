import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPolicyPage() {
  return (
    <div className="container-p max-w-3xl py-14">
      <span className="eyebrow">Legal</span>
      <h1 className="section-title">Privacy Policy</h1>
      <p className="mt-3 text-sm text-[#7c8a81]">Last updated: August 2026</p>

      <div className="prose-sm mt-8 space-y-6 text-sm leading-relaxed text-[#4c5c53]">
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">1. What we collect</h2>
          <p className="mt-2">
            When you create a profile we store: your name, email, mobile number, gender, date of birth, profile details
            you choose to share (location, religion, community, education, profession, photos, about text) and your
            activity (interests, shortlist, messages, notifications).
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">2. How we use it</h2>
          <p className="mt-2">
            Your data is used to run the service: matching and recommendations, interest and messaging, security
            (verification, reports, blocks) and support. We never sell your personal data to anyone.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">3. Who can see your data</h2>
          <p className="mt-2">
            Profile details are visible according to your privacy settings: publicly, to logged-in members only, or to
            matched partners (for contact details). Your email and phone number are hidden by default and only shown to
            matched partners if you enable it in Settings → Privacy.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">4. Cookies & sessions</h2>
          <p className="mt-2">
            We use one secure session cookie to keep you logged in. No third-party advertising trackers are used on
            this site.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">5. Your rights</h2>
          <p className="mt-2">
            You can update your profile anytime, change privacy settings, unblock users, or permanently delete your
            account from Settings → Delete account. Contact us for any privacy request.
          </p>
        </section>
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">6. Contact</h2>
          <p className="mt-2">
            Email: sukulpanika939@gmail.com • WhatsApp: +91 8099834725
          </p>
        </section>
      </div>
    </div>
  );
}
