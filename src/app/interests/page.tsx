import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getInterestsData } from "@/lib/data";
import { ActionForm } from "@/components/client-forms";
import { Avatar, EmptyState } from "@/components/ui";
import { FlashNotice } from "@/components/site-chrome";
import { timeAgo, PageSearchParams, pageParam } from "@/lib/utils";


export const metadata: Metadata = { title: "Interests" };

export default async function InterestsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const tab = pageParam(params, "tab") === "sent" ? "sent" : "received";
  const { sent, received } = await getInterestsData(user.id);

  const list = tab === "sent" ? sent : received;

  return (
    <div className="container-p py-10">
      <FlashNotice notice={pageParam(params, "notice")} error={pageParam(params, "error")} />

      <div className="mb-8">
        <span className="eyebrow">Interests</span>
        <h1 className="section-title">Interests & responses</h1>
        <p className="section-sub mt-2">
          Showing interest is the first step. When both sides accept, you match and can start chatting — free.
        </p>
      </div>

      <div className="tabs mb-8">
        <Link href="/interests" className={`tab ${tab === "received" ? "tab-active" : ""}`}>
          📩 Received {received.length > 0 ? `(${received.length})` : ""}
        </Link>
        <Link href="/interests?tab=sent" className={`tab ${tab === "sent" ? "tab-active" : ""}`}>
          📤 Sent {sent.length > 0 ? `(${sent.length})` : ""}
        </Link>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={tab === "received" ? "📭" : "📤"}
          title={tab === "received" ? "No interests received yet" : "No interests sent yet"}
          sub={
            tab === "received"
              ? "Complete your profile and keep it up to date — members who look great receive interest faster."
              : "Browse profiles and send interest with a personal note. It's completely free."
          }
          action={
            <Link href="/find-matches" className="btn btn-primary">
              Browse profiles
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {list.map(({ interest, profile }) =>
            profile ? (
              <div key={interest.id} className="card flex flex-wrap items-center gap-4 p-5">
                <Avatar name={profile.fullName} src={profile.profilePhotoUrl} size={56} />
                <div className="min-w-[180px] flex-1">
                  <Link href={`/profile/${profile.userId}`} className="text-sm font-bold text-ink hover:text-brand-700">
                    {profile.fullName} {profile.age ? `• ${profile.age}` : ""}
                  </Link>
                  <p className="truncate text-xs text-[#7c8a81]">
                    {[profile.location, profile.profession].filter(Boolean).join(" • ") || "Details soon"}
                  </p>
                  <p className="text-[11px] font-semibold text-[#9aa89f]">
                    {timeAgo(interest.createdAt)}
                    {interest.message ? ` • “${interest.message.slice(0, 90)}${interest.message.length > 90 ? "…" : ""}”` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {interest.status === "pending" &&
                    (tab === "received" ? (
                      <>
                        <ActionForm
                          action="interestStatus"
                          payload={{ interestId: String(interest.id), status: "accept" }}
                          submitLabel="Accept 💞"
                          submitClassName="btn btn-primary btn-sm"
                          className=""
                        />
                        <ActionForm
                          action="interestStatus"
                          payload={{ interestId: String(interest.id), status: "reject" }}
                          submitLabel="Reject"
                          submitClassName="btn btn-danger btn-sm"
                          className=""
                        />
                      </>
                    ) : (
                      <ActionForm
                        action="cancelInterest"
                        payload={{ interestId: String(interest.id) }}
                        submitLabel="Cancel"
                        submitClassName="btn btn-danger btn-sm"
                        confirmText="Cancel this interest?"
                        className=""
                      />
                    ))}
                  {interest.status === "accepted" && (
                    <span className="chip chip-gold">💞 Matched</span>
                  )}
                  {interest.status === "rejected" && <span className="chip">Declined</span>}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
