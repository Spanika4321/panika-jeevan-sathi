import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getMyMatches, getRecommendedMatches } from "@/lib/data";
import ProfileCard from "@/components/profile-card";
import { EmptyState, Avatar } from "@/components/ui";
import { timeAgo, PageSearchParams } from "@/lib/utils";


export const metadata: Metadata = { title: "Recommended Matches" };

export default async function MatchesPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const tab = params.tab === "my" ? "my" : "recommended";

  const recommended = await getRecommendedMatches(user);
  const myMatches = user ? await getMyMatches(user.id) : [];

  return (
    <div className="container-p py-10">
      <div className="mb-8">
        <span className="eyebrow">Smart matching</span>
        <h1 className="section-title">{tab === "my" ? "My matches" : "Recommended for you"}</h1>
        <p className="section-sub mt-2">
          {tab === "my"
            ? "People you and the other side have accepted as a match — your private circle."
            : "Ranked automatically from your profile and partner preferences — age, location, religion, community, education and more."}
        </p>
      </div>

      <div className="tabs mb-8">
        <Link href="/matches" className={`tab ${tab === "recommended" ? "tab-active" : ""}`}>
          ✨ Recommended
        </Link>
        {user && (
          <Link href="/matches?tab=my" className={`tab ${tab === "my" ? "tab-active" : ""}`}>
            💞 My matches {myMatches.length > 0 ? `(${myMatches.length})` : ""}
          </Link>
        )}
      </div>

      {tab === "recommended" ? (
        !user ? (
          <EmptyState
            icon="✨"
            title="Login for personal recommendations"
            sub="We match on age, location, religion, community, education and lifestyle. Login or create a free profile to see yours."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/register" className="btn btn-gold">
                  Create free profile
                </Link>
                <Link href="/login" className="btn btn-outline">
                  Login
                </Link>
              </div>
            }
          />
        ) : recommended.length === 0 ? (
          <EmptyState
            icon=""
            title="No recommendations yet"
            sub="Complete your profile and partner preferences so we can find great matches for you."
            action={
              <Link href="/profile/edit" className="btn btn-primary">
                Complete my profile
              </Link>
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recommended.map((profile) => (
              <ProfileCard key={profile.userId} profile={profile} matchPercent={profile.matchPercent} />
            ))}
          </div>
        )
      ) : myMatches.length === 0 ? (
        <EmptyState
          icon="💞"
          title="No matches yet"
          sub="When both sides accept an interest, you become matches and can start chatting. Your accepted connections will appear here."
          action={
            <Link href="/find-matches" className="btn btn-primary">
              Explore profiles
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {myMatches.map(({ profile, score, createdAt }) =>
            profile ? (
              <Link key={profile.userId} href={`/profile/${profile.userId}`} className="card card-hover flex items-center gap-4 p-5">
                <Avatar name={profile.fullName} src={profile.profilePhotoUrl} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">
                    {profile.fullName} {profile.age ? `• ${profile.age}` : ""}
                  </p>
                  <p className="truncate text-xs text-[#7c8a81]">
                    {[profile.location, profile.profession].filter(Boolean).join(" • ") || "Details soon"}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-[#9aa89f]">Matched {timeAgo(createdAt)}</p>
                </div>
                <span className="rounded-full bg-gold-500 px-2.5 py-1 text-[11px] font-extrabold text-white">
                  {score}%
                </span>
              </Link>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
