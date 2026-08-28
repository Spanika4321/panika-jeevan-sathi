import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getOwnProfile, getOwnPreferences, getInterestsData, getShortlistData, getMyMatches } from "@/lib/data";
import { ProfilePhoto } from "@/components/profile-detail";
import { calculateAge, moneyFull, formatDate, profileCompletion } from "@/lib/utils";

export const metadata: Metadata = { title: "My Profile" };

export default async function MyProfilePage() {
  const user = await requireUser();
  const [profile, preferences, interests, shortlist, matches] = await Promise.all([
    getOwnProfile(user.id),
    getOwnPreferences(user.id),
    getInterestsData(user.id),
    getShortlistData(user.id),
    getMyMatches(user.id),
  ]);

  if (!profile) {
    return (
      <div className="container-p py-16">
        <div className="card mx-auto max-w-lg p-8 text-center">
          <p className="text-5xl" aria-hidden="true">👤</p>
          <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Let&apos;s build your profile</h1>
          <p className="mt-2 text-sm text-[#5c6b62]">Your account is ready — add your details to appear in searches.</p>
          <Link href="/profile/edit" className="btn btn-gold mt-6">
            Complete my profile
          </Link>
        </div>
      </div>
    );
  }

  const completion = profileCompletion([
    profile.profilePhotoUrl,
    profile.headline,
    profile.about,
    profile.religion,
    profile.community,
    profile.education,
    profile.profession,
    profile.location,
    profile.heightCm,
    user.dateOfBirth,
  ]);

  const facts: Array<[string, string | null | number]> = [
    ["Age", user.dateOfBirth ? `${calculateAge(user.dateOfBirth) ?? "—"} yrs` : null],
    ["Height", profile.heightCm ? `${profile.heightCm} cm` : null],
    ["Marital status", profile.maritalStatus],
    ["Religion", profile.religion],
    ["Community", profile.community],
    ["Mother tongue", profile.motherTongue],
    ["Education", profile.education],
    ["Profession", profile.profession],
    ["Income", profile.income ? moneyFull(profile.income) : null],
    ["Location", profile.location],
    ["Member since", formatDate(profile.createdAt)],
  ];

  return (
    <div className="container-p py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="eyebrow">Your profile</span>
          <h1 className="section-title">Profile overview</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/preferences" className="btn btn-outline">
            Partner preferences
          </Link>
          <Link href="/profile/edit" className="btn btn-gold">
            Edit profile
          </Link>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        <div>
          <ProfilePhoto url={profile.profilePhotoUrl} name={profile.displayName} verificationStatus={profile.verificationStatus} headline={profile.headline} />
          <div className="card mt-5 p-5">
            <div className="flex items-center justify-between text-sm font-bold text-ink">
              <span>Profile strength</span>
              <span>{completion}%</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-cream-dark">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-gold-500" style={{ width: `${Math.max(6, completion)}%` }} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[#7c8a81]">
              Profiles with a photo and complete details receive far more interests.
              {completion < 100 && " Add a photo and fill the empty sections to stand out."}
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="font-display text-xl font-semibold text-ink">About</h2>
            {profile.about ? (
              <p className="mt-3 whitespace-pre-line leading-relaxed text-[#4c5c53]">{profile.about}</p>
            ) : (
              <p className="mt-3 text-sm text-[#7c8a81]">
                Not added yet.{" "}
                <Link href="/profile/edit" className="font-bold text-brand-700 hover:underline">
                  Write something about yourself →
                </Link>
              </p>
            )}
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink">Basic details</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.filter(([, value]) => value != null).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-[#f0ece1] pb-2">
                  <dt className="text-sm font-semibold text-[#7c8a81]">{label}</dt>
                  <dd className="text-right text-sm font-bold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {profile.familyDetails && (
            <section>
              <h2 className="font-display text-xl font-semibold text-ink">Family details</h2>
              <p className="mt-3 whitespace-pre-line leading-relaxed text-[#4c5c53]">{profile.familyDetails}</p>
            </section>
          )}

          {profile.lifestyle && (
            <section>
              <h2 className="font-display text-xl font-semibold text-ink">Lifestyle</h2>
              <p className="mt-3 whitespace-pre-line leading-relaxed text-[#4c5c53]">{profile.lifestyle}</p>
            </section>
          )}

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-ink">Your activity</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Interests sent", interests.sent.length],
                ["Received", interests.received.length],
                ["Shortlisted", shortlist.length],
                ["Matches", matches.length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl bg-cream px-4 py-3 text-center">
                  <dd className="font-display text-2xl font-semibold text-brand-800">{value}</dd>
                  <dt className="text-xs font-bold uppercase tracking-wide text-[#7c8a81]">{label}</dt>
                </div>
              ))}
            </dl>
          </section>

          {preferences && (preferences.lookingFor || preferences.ageMin || preferences.ageMax || preferences.location || preferences.religion) && (
            <section className="rounded-2xl bg-gold-50 p-5">
              <h2 className="font-display text-lg font-semibold text-gold-900">Your partner preferences</h2>
              <p className="mt-2 text-sm text-gold-900">
                {[
                  preferences.lookingFor,
                  preferences.ageMin || preferences.ageMax ? `${preferences.ageMin ?? 18}–${preferences.ageMax ?? 45} yrs` : null,
                  preferences.location,
                  preferences.religion,
                  preferences.community,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
