import Link from "next/link";
import type { Metadata } from "next";
import { getHomeStats, getPublicProfiles, getLatestAnnouncement } from "@/lib/data";
import ProfileCard from "@/components/profile-card";
import { SectionHeader } from "@/components/ui";
import { religionOptions } from "@/lib/constants";

export const metadata: Metadata = {
  title: "100% Free Matrimony — Find Your Jeevan Sathi",
};

const steps = [
  {
    icon: "📝",
    title: "Create your free profile",
    text: "Sign up with your email in under 2 minutes. Add details about yourself, your family and what you're looking for.",
  },
  {
    icon: "🔎",
    title: "Search & discover",
    text: "Filter by age, city, religion, community, education and profession. Our smart matching ranks profiles for you.",
  },
  {
    icon: "💌",
    title: "Show your interest",
    text: "Send interest with a personal message. When both sides accept, you become matched.",
  },
  {
    icon: "💬",
    title: "Connect & meet",
    text: "Chat privately in your inbox, talk with families, and take the next step with full transparency. It's all free.",
  },
];

const features = [
  { icon: "💯", title: "100% Free Forever", text: "Every feature — search, interest, chat, shortlist — is free. No memberships, no paywalls, no hidden charges." },
  { icon: "✅", title: "Genuine Profiles", text: "Profiles are admin-reviewed before going live, and verified members carry a trusted badge." },
  { icon: "🤝", title: "Family-First Approach", text: "Detailed family, community and lifestyle sections help two families understand each other." },
  { icon: "🌍", title: "India + Global", text: "Members from every Indian city and from UK, UAE, Singapore, USA, Australia and beyond." },
  { icon: "🔐", title: "Privacy Controls", text: "Hide your phone and email, control who sees your profile, and block or report anyone." },
  { icon: "📱", title: "Works Everywhere", text: "Fast, touch-friendly screens on Android phones, tablets, laptops and desktops." },
];

const stories = [
  {
    name: "Meera & Rakesh",
    place: "Mumbai • Married 2024",
    quote:
      "We found each other through PANIKA JEEVAN SATHI's recommended matches. Both our families connected within a week, and the rest, as they say, is a story we love telling.",
    initial: "M",
  },
  {
    name: "Ayesha & Daniel",
    place: "London • Married 2025",
    quote:
      "Being NRI made finding someone with the same values so hard. The global profiles and honest details made all the difference for our family.",
    initial: "A",
  },
  {
    name: "Kavya & Sandeep",
    place: "Pune • Married 2023",
    quote:
      "Everything was free — even messaging! We spent months chatting and planning properly. Our wedding happened exactly how we both dreamed it would.",
    initial: "K",
  },
];

export default async function HomePage() {
  const [stats, featured, announcement] = await Promise.all([
    getHomeStats(),
    getPublicProfiles(8),
    getLatestAnnouncement(),
  ]);

  return (
    <>
      {/* ================= HERO ================= */}
      <section className="pattern-hero overflow-hidden">
        <div className="container-p grid items-center gap-12 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-gold-300 bg-gold-50 px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-gold-700">
              🪷 India&apos;s 100% free matrimony
            </span>
            <h1 className="mt-5 font-display text-[2.6rem] font-semibold leading-[1.08] tracking-tight text-ink sm:text-6xl">
              Find your <span className="text-brand-700">jeevan sathi</span>, the honest way.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#4c5c53]">
              Genuine profiles, family-first details and smart matching — for members in India and across the world.
              <span className="font-bold text-brand-800"> Every feature is free, forever.</span>
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn btn-gold btn-lg">
                Create Free Profile
              </Link>
              <Link href="/find-matches" className="btn btn-outline btn-lg">
                Browse Profiles
              </Link>
            </div>

            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4">
              {[
                [stats.totalMembers, "Members"],
                [stats.verifiedProfiles, "Verified profiles"],
                [stats.successfulMatches, "Successful matches"],
              ].map(([value, label]) => (
                <div key={String(label)}>
                  <dt className="sr-only">{label}</dt>
                  <dd className="font-display text-3xl font-semibold text-brand-800">{value}</dd>
                  <dd className="text-xs font-bold uppercase tracking-wide text-[#7c8a81]">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Quick search card */}
          <div className="card p-6 sm:p-7">
            <h2 className="font-display text-xl font-semibold text-ink">Quick search</h2>
            <p className="mt-1 text-sm text-[#5c6b62]">Tell us who you&apos;re looking for — it&apos;s free.</p>
            <form
              action="/find-matches"
              method="GET"
              className="mt-5 space-y-4"
            >
              <div>
                <label className="label" htmlFor="q-lookingFor">I am looking for</label>
                <select id="q-lookingFor" name="lookingFor" className="select">
                  <option value="">Anyone</option>
                  <option value="Female">Bride (Female)</option>
                  <option value="Male">Groom (Male)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="q-ageMin">Age from</label>
                  <input id="q-ageMin" name="ageMin" type="number" min={18} max={80} placeholder="e.g. 24" className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="q-ageMax">Age to</label>
                  <input id="q-ageMax" name="ageMax" type="number" min={18} max={80} placeholder="e.g. 32" className="input" />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="q-location">Location</label>
                <input id="q-location" name="location" placeholder="City or state" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="q-religion">Religion</label>
                <select id="q-religion" name="religion" className="select">
                  <option value="">Any religion</option>
                  {religionOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary btn-lg w-full">
                Search Free
              </button>
            </form>
            <p className="mt-4 text-center text-xs font-semibold text-[#7c8a81]">
              No sign-up needed to browse public profiles
            </p>
          </div>
        </div>
      </section>

      {/* Announcement */}
      {announcement && (
        <div className="border-y border-gold-200 bg-gold-50">
          <div className="container-p flex items-center gap-3 py-3 text-sm font-semibold text-gold-900">
            <span aria-hidden="true">📣</span>
            <span>
              <strong>{announcement.title}.</strong> {announcement.body}
            </span>
          </div>
        </div>
      )}

      {/* Featured profiles */}
      <section className="container-p py-16 lg:py-20">
        <SectionHeader
          eyebrow="New this week"
          title="Profiles in the spotlight"
          sub="A hand-picked look at recent members. Create your free profile and be seen."
          action={
            <Link href="/find-matches" className="btn btn-outline">
              View all profiles
            </Link>
          }
        />
        {featured.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((profile) => (
              <ProfileCard key={profile.userId} profile={profile} />
            ))}
          </div>
        ) : (
          <div className="card px-6 py-12 text-center text-[#5c6b62]">
            Profiles are on the way — check back soon, or be the first by <Link href="/register" className="font-bold text-brand-700 underline">creating your free profile</Link>.
          </div>
        )}
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-white py-16 lg:py-20">
        <div className="container-p">
          <SectionHeader center eyebrow="Simple by design" title="How it works" sub="Four easy steps — and every single one of them is free." />
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="card card-hover relative p-6">
                <span className="absolute right-5 top-5 font-display text-4xl font-semibold text-brand-100" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-2xl" aria-hidden="true">
                  {step.icon}
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5c6b62]">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Why us */}
      <section className="container-p py-16 lg:py-20">
        <SectionHeader
          eyebrow="Why families trust us"
          title="Matrimony the way it should be"
          sub="Built around trust, transparency and real human connection — with zero price tags."
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card card-hover p-6">
              <span className="text-3xl" aria-hidden="true">{f.icon}</span>
              <h3 className="mt-3 font-display text-lg font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5c6b62]">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* India + Global */}
      <section className="bg-brand-950 py-16 text-white lg:py-20">
        <div className="container-p grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="eyebrow !text-gold-400">India + Global matchmaking</span>
            <h2 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">
              Roots in India. <span className="text-gold-400">Wings all over the world.</span>
            </h2>
            <p className="mt-4 max-w-lg leading-relaxed text-brand-200">
              From Silchar to Singapore, Mumbai to Manchester — our members live and work across the globe. Search by
              city, or open your search to the world and find a partner who carries your values anywhere.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {["Delhi NCR", "Mumbai", "Bengaluru", "Hyderabad", "Kolkata", "Chennai", "London", "Dubai", "Singapore", "New York", "Sydney"].map((city) => (
                <span key={city} className="rounded-full border border-brand-800 bg-brand-900/60 px-3.5 py-1.5 text-xs font-bold text-brand-100">
                  {city}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              ["🇮🇳", "25+ states & UTs", "Members from every corner of India"],
              ["🌍", "10+ countries", "NRIs actively looking in the diaspora"],
              ["🕉️", "All communities", "Hindu, Muslim, Christian, Sikh, Jain, Parsi & more"],
              ["💼", "Every profession", "Doctors, engineers, teachers, business owners & more"],
            ].map(([icon, title, sub]) => (
              <div key={title} className="rounded-2xl border border-brand-800 bg-brand-900/50 p-5">
                <span className="text-3xl" aria-hidden="true">{icon}</span>
                <p className="mt-3 font-display text-lg font-semibold text-gold-300">{title}</p>
                <p className="mt-1 text-sm text-brand-200">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Success stories */}
      <section className="container-p py-16 lg:py-20">
        <SectionHeader center eyebrow="Real couples, real weddings" title="Success stories" />
        <div className="grid gap-5 md:grid-cols-3">
          {stories.map((s) => (
            <figure key={s.name} className="card card-hover flex flex-col p-6">
              <div className="flex items-center gap-3">
                <span className="avatar h-12 w-12 text-base" aria-hidden="true">{s.initial}</span>
                <div>
                  <figcaption className="font-display font-semibold text-ink">{s.name}</figcaption>
                  <p className="text-xs font-semibold text-[#7c8a81]">{s.place}</p>
                </div>
              </div>
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-[#4c5c53]">“{s.quote}”</blockquote>
              <div className="mt-4 text-gold-500" aria-label="5 out of 5 stars">★★★★★</div>
            </figure>
          ))}
        </div>
      </section>

      {/* Free CTA */}
      <section className="container-p pb-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 to-brand-950 px-6 py-14 text-center text-white sm:px-12">
          <div
            aria-hidden="true"
            className="absolute -left-16 -top-16 h-56 w-56 rounded-full border-[24px] border-gold-500/20"
          />
          <div aria-hidden="true" className="absolute -bottom-20 -right-10 h-64 w-64 rounded-full border-[28px] border-brand-400/20" />
          <h2 className="relative font-display text-3xl font-semibold sm:text-4xl">
            Your story starts with a free profile.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-brand-100">
            Join thousands of members and families. No fees. No subscriptions. No locked features. Just genuine
            matchmaking.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="btn btn-gold btn-lg">
              Join free today
            </Link>
            <Link href="/login" className="btn btn-lg !border-brand-400/40 !text-white hover:!bg-white/10">
              I already have a profile
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
