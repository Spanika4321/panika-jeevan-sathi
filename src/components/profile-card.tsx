import Link from "next/link";
import type { ProfileCardData } from "@/lib/data-types";
import { moneyLabel, profileSummary } from "@/lib/utils";
import { Avatar, MatchBadge, VerifiedBadge } from "./ui";

export default function ProfileCard({
  profile,
  matchPercent,
}: {
  profile: ProfileCardData;
  matchPercent?: number;
}) {
  return (
    <Link
      href={`/profile/${profile.userId}`}
      className="card card-hover group block overflow-hidden"
      aria-label={`View profile of ${profile.fullName}`}
    >
      <div className="relative aspect-[4/4.4] overflow-hidden bg-gradient-to-br from-brand-100 to-cream-dark">
        {profile.profilePhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.profilePhotoUrl}
            alt={profile.fullName}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Avatar name={profile.fullName} size={92} className="!text-4xl" />
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {profile.verificationStatus === "verified" && <VerifiedBadge />}
        </div>
        {matchPercent && (
          <div className="absolute right-3 top-3">
            <MatchBadge percent={matchPercent} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-950/70 to-transparent px-4 pb-3 pt-10">
          <p className="font-display text-lg font-semibold text-white drop-shadow">
            {profile.fullName.split(" ")[0]}, {profile.age ?? "—"}
          </p>
          <p className="truncate text-xs font-medium text-white/85">
            {profile.location ?? "Location not shared"}
          </p>
        </div>
      </div>

      <div className="space-y-2.5 px-4 py-4">
        <p className="truncate text-sm font-bold text-ink">{profileSummary(profile)}</p>
        <div className="flex flex-wrap gap-1.5">
          {profile.religion && <span className="chip">{profile.religion}</span>}
          {profile.community && <span className="chip">{profile.community}</span>}
          {profile.maritalStatus && <span className="chip">{profile.maritalStatus}</span>}
          {(profile.income ?? 0) > 0 && <span className="chip chip-gold">{moneyLabel(profile.income)}</span>}
        </div>
        <div className="flex items-center justify-between border-t border-[#f0ece1] pt-2.5">
          <span className="text-xs font-bold uppercase tracking-wide text-brand-600">View Profile</span>
          <span className="text-brand-300 transition group-hover:translate-x-0.5 group-hover:text-gold-500" aria-hidden="true">
            →
          </span>
        </div>
      </div>
    </Link>
  );
}
