import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getShortlistData } from "@/lib/data";
import { ActionForm } from "@/components/client-forms";
import { Avatar, EmptyState } from "@/components/ui";
import { FlashNotice } from "@/components/site-chrome";
import { profileSummary, timeAgo, PageSearchParams, pageParam } from "@/lib/utils";


export const metadata: Metadata = { title: "Shortlist" };

export default async function ShortlistPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const items = await getShortlistData(user.id);

  return (
    <div className="container-p py-10">
      <FlashNotice notice={pageParam(params, "notice")} error={pageParam(params, "error")} />

      <div className="mb-8">
        <span className="eyebrow">Your shortlist</span>
        <h1 className="section-title">Profiles you&apos;ve saved</h1>
        <p className="section-sub mt-2">Keep a private list of profiles you&apos;d like to revisit — only you can see it.</p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="⭐"
          title="Your shortlist is empty"
          sub="When you find a profile you like, tap Shortlist to save it here for later."
          action={
            <Link href="/find-matches" className="btn btn-primary">
              Browse profiles
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ shortlist, profile }) =>
            profile ? (
              <div key={shortlist.id} className="card card-hover flex items-center gap-4 p-5">
                <Avatar name={profile.fullName} src={profile.profilePhotoUrl} size={56} />
                <div className="min-w-0 flex-1">
                  <Link href={`/profile/${profile.userId}`} className="text-sm font-bold text-ink hover:text-brand-700">
                    {profile.fullName} {profile.age ? `• ${profile.age}` : ""}
                  </Link>
                  <p className="truncate text-xs text-[#7c8a81]">{profileSummary(profile)}</p>
                  <p className="text-[11px] font-semibold text-[#9aa89f]">Saved {timeAgo(shortlist.createdAt)}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <ActionForm
                    action="shortlist"
                    payload={{ profileUserId: String(profile.userId) }}
                    submitLabel="Remove"
                    busyLabel="Removing…"
                    submitClassName="btn btn-danger btn-sm"
                    confirmText={`Remove ${profile.fullName} from your shortlist?`}
                    className=""
                  />
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
