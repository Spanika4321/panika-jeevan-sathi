import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getProfileDetails, getConversationList } from "@/lib/data";
import ProfileActions, { ProfilePhoto } from "@/components/profile-detail";
import { moneyFull, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profileUserId = Number.parseInt(id, 10);
  if (!Number.isFinite(profileUserId)) notFound();

  const viewer = await getCurrentUser();
  const profile = await getProfileDetails(profileUserId, viewer);
  if (!profile) notFound();

  let conversationId: number | undefined;
  if (viewer && profile.accepted) {
    const convos = await getConversationList(viewer.id);
    conversationId = convos.find((c) => c.other?.userId === profile.userId)?.conversation.id;
  }

  const facts: Array<[string, string | null | number]> = [
    ["Age", profile.age ? `${profile.age} yrs` : null],
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
      <nav className="mb-6 text-sm font-semibold text-[#7c8a81]" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-brand-700">Home</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <Link href="/find-matches" className="hover:text-brand-700">Profiles</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-ink">{profile.fullName}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[380px_1fr_340px]">
        {/* Photo column */}
        <div>
          <ProfilePhoto url={profile.profilePhotoUrl} name={profile.fullName} verificationStatus={profile.verificationStatus} />
        </div>

        {/* Details column */}
        <div className="space-y-8">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-semibold text-ink">
                {profile.fullName}
                {profile.age ? `, ${profile.age}` : ""}
              </h1>
              {profile.verificationStatus === "verified" && (
                <span className="chip chip-brand">✔ Verified by our team</span>
              )}
              {profile.location && (
                <span className="chip">📍 {profile.location}</span>
              )}
            </div>
            {profile.headline && <p className="mt-3 text-lg italic text-brand-800">“{profile.headline}”</p>}
          </div>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink">About</h2>
            {profile.about ? (
              <p className="mt-3 whitespace-pre-line leading-relaxed text-[#4c5c53]">{profile.about}</p>
            ) : (
              <p className="mt-3 text-sm text-[#7c8a81]">No details shared yet.</p>
            )}
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink">Basic details</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.filter(([, value]) => value != null && value !== 0).map(([label, value]) => (
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

          {profile.preferences && (
            <section className="rounded-2xl bg-gold-50 p-5">
              <h2 className="font-display text-lg font-semibold text-gold-900">Looking for a partner who is…</h2>
              <p className="mt-2 text-sm leading-relaxed text-gold-900">
                {[
                  profile.preferences.lookingFor ? `${profile.preferences.lookingFor} partner` : null,
                  profile.preferences.ageMin || profile.preferences.ageMax
                    ? `aged ${profile.preferences.ageMin ?? 18}–${profile.preferences.ageMax ?? 45}`
                    : null,
                  profile.preferences.location,
                  profile.preferences.religion,
                  profile.preferences.community,
                  profile.preferences.maritalStatus,
                  profile.preferences.education,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </p>
            </section>
          )}
        </div>

        {/* Actions column */}
        <div className="space-y-4">
          <ProfileActions
            profileUserId={profile.userId}
            profileName={profile.fullName}
            isOwner={profile.isOwner}
            loggedIn={Boolean(viewer)}
            accepted={profile.accepted}
            shortlisted={profile.shortlisted}
            sentInterest={profile.sentInterest}
            receivedInterest={profile.receivedInterest}
            conversationId={conversationId}
          />

          {(profile.canSeePhone || profile.canSeeEmail) && (
            <div className="card space-y-3 p-6">
              <h2 className="font-display text-lg font-semibold text-ink">Contact details</h2>
              <p className="text-xs font-semibold text-[#7c8a81]">Shared because you are matched and contact details are visible.</p>
              {profile.canSeePhone && (
                <p className="text-sm font-bold text-ink">📱 +91 {profile.mobile}</p>
              )}
              {profile.canSeeEmail && (
                <p className="break-all text-sm font-bold text-ink">✉️ {profile.email}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
