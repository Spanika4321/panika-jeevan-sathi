import Link from "next/link";
import type { Metadata } from "next";
import { SectionHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Safety Guidelines" };

const rules = [
  {
    title: "Never send money",
    text: "No legitimate partner will ever ask for money, gifts by courier, loan help or “emergency” funds. If someone does, block and report immediately.",
  },
  {
    title: "Verify before you trust",
    text: "Take video calls early, meet in safe public or family settings, and let your family know who you're meeting and where.",
  },
  {
    title: "Keep personal details private",
    text: "Don't share your home address, documents, bank details or photos you'd regret. This platform never asks for them — anyone who does is fake.",
  },
  {
    title: "Trust your instincts",
    text: "Pressure, rush, secrecy or inconsistent stories are red flags. Pause, step back, and talk to your family or our support team.",
  },
  {
    title: "Report everything",
    text: "Spam, fake profiles, harassment or money requests — use the Report button on any profile. Our team reviews every report.",
  },
  {
    title: "Protect your account",
    text: "Use a strong unique password and never share it. Anyone asking for your OTP or password is not from PANIKA JEEVAN SATHI.",
  },
];

export default function SafetyPage() {
  return (
    <div className="container-p py-14">
      <div className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">Stay safe</span>
        <h1 className="section-title">Safety guidelines</h1>
        <p className="section-sub mt-3 !mx-auto">
          Your safety is our top priority. These six habits keep online matchmaking safe for you and your family.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-2">
        {rules.map((r, i) => (
          <div key={r.title} className="card card-hover p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gold-500 font-display font-bold text-white">
                {i + 1}
              </span>
              <h2 className="font-display text-lg font-semibold text-ink">{r.title}</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#5c6b62]">{r.text}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-12 max-w-2xl rounded-3xl bg-rose-50 p-8 text-center">
        <p className="text-3xl" aria-hidden="true">🚨</p>
        <h2 className="mt-3 font-display text-xl font-semibold text-rose-800">Someone asked you for money?</h2>
        <p className="mt-2 text-sm leading-relaxed text-rose-700">
          This is a scam. Block the user, report the profile, and contact us on WhatsApp right away.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <a href="https://wa.me/918099834725" target="_blank" rel="noopener noreferrer" className="btn btn-danger-solid">
            Report on WhatsApp
          </a>
          <Link href="/find-matches" className="btn btn-outline">
            Continue browsing safely
          </Link>
        </div>
      </div>
    </div>
  );
}
