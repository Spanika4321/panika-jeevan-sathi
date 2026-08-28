import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import {
  getConversationList,
  getHomeStats,
  getInterestsData,
  getNotifications,
  getOwnProfile,
  getShortlistData,
  getMyMatches,
  getUnreadNotificationCount,
} from "@/lib/data";
import { Avatar, SectionHeader, Stat, EmptyState } from "@/components/ui";
import { FlashNotice } from "@/components/site-chrome";

import { profileCompletion, timeAgo, PageSearchParams, pageParam } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;

  const [profile, interests, shortlist, matches, conversations, notifications, unread, siteStats] = await Promise.all([
    getOwnProfile(user.id),
    getInterestsData(user.id),
    getShortlistData(user.id),
    getMyMatches(user.id),
    getConversationList(user.id),
    getNotifications(user.id),
    getUnreadNotificationCount(user.id),
    getHomeStats(),
  ]);

  const pendingReceived = interests.received.filter((i) => i.interest.status === "pending").length;
  const pendingSent = interests.sent.filter((i) => i.interest.status === "pending").length;
  const acceptedSent = interests.sent.filter((i) => i.interest.status === "accepted").length;

  const completion = profile
    ? profileCompletion([
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
      ])
    : 0;

  const totalConversations = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <div className="container-p py-10">
      <FlashNotice notice={pageParam(params, "notice")} error={pageParam(params, "error")} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={user.fullName} src={profile?.profilePhotoUrl} size={64} />
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">Namaste, {user.fullName.split(" ")[0]} 🙏</h1>
            <p className="text-sm text-[#5c6b62]">
              {completion === 100 ? "Your profile is complete — great job!" : `Your profile is ${completion}% complete.`}
              {completion < 100 && (
                <Link href="/profile/edit" className="ml-1 font-bold text-brand-700 hover:underline">
                  Add a few more details →
                </Link>
              )}
            </p>
          </div>
        </div>
        <Link href="/find-matches" className="btn btn-gold">
          Browse new profiles
        </Link>
      </div>

      {/* Action needed */}
      {pendingReceived > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-300 bg-gold-50 px-5 py-4">
          <p className="text-sm font-bold text-gold-900">
            💌 You have {pendingReceived} new interest{pendingReceived > 1 ? "s" : ""} waiting for your response.
          </p>
          <Link href="/interests" className="btn btn-primary btn-sm">
            Review now
          </Link>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href="/interests" className="card card-hover block">
          <Stat icon="📩" label="Interests received" value={pendingReceived} />
        </Link>
        <Link href="/interests" className="card card-hover block">
          <Stat icon="📤" label="Sent (pending)" value={pendingSent} />
        </Link>
        <Link href="/matches" className="card card-hover block">
          <Stat icon="💞" label="Matches" value={matches.length} />
        </Link>
        <Link href="/messages" className="card card-hover block">
          <Stat icon="💬" label="Unread messages" value={totalConversations} />
        </Link>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          <section>
            <SectionHeader
              title="Recent conversations"
              action={
                <Link href="/messages" className="text-sm font-bold text-brand-700 hover:underline">
                  View all →
                </Link>
              }
            />
            {conversations.length === 0 ? (
              <EmptyState
                icon="💬"
                title="No conversations yet"
                sub="When an interest is accepted on both sides, a private conversation opens here automatically."
                action={
                  <Link href="/find-matches" className="btn btn-primary">
                    Find someone to connect with
                  </Link>
                }
              />
            ) : (
              <div className="card divide-y divide-[#f0ece1]">
                {conversations.slice(0, 4).map(({ conversation, other, lastMessage, unreadCount }) =>
                  other ? (
                    <Link
                      key={conversation.id}
                      href={`/messages/${conversation.id}`}
                      className="flex items-center gap-3.5 px-5 py-4 transition hover:bg-cream"
                    >
                      <Avatar name={other.fullName} src={other.profilePhotoUrl} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-ink">{other.fullName}</p>
                        <p className="truncate text-xs text-[#7c8a81]">
                          {lastMessage ? lastMessage.content : "Say hello 👋"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[11px] font-semibold text-[#9aa89f]">{timeAgo(conversation.updatedAt)}</span>
                        {unreadCount > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                    </Link>
                  ) : null,
                )}
              </div>
            )}
          </section>

          <section>
            <SectionHeader
              title="Recent notifications"
              action={
                <Link href="/notifications" className="text-sm font-bold text-brand-700 hover:underline">
                  View all →
                </Link>
              }
            />
            {notifications.length === 0 ? (
              <EmptyState icon="🔔" title="No notifications yet" sub="Interests, matches and messages will show up here." />
            ) : (
              <div className="card divide-y divide-[#f0ece1]">
                {notifications.slice(0, 4).map((n) => (
                  <Link
                    key={n.id}
                    href={n.linkUrl ?? "/notifications"}
                    className="flex items-start gap-3 px-5 py-4 transition hover:bg-cream"
                  >
                    <span
                      className={
                        n.readAt
                          ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#d8d2c2]"
                          : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold-500"
                      }
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink">{n.title}</p>
                      {n.body && <p className="truncate text-xs text-[#7c8a81]">{n.body}</p>}
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold text-[#9aa89f]">{timeAgo(n.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-ink">Complete your profile</h2>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-cream-dark">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-gold-500 transition-all"
                style={{ width: `${Math.max(6, completion)}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#7c8a81]">{completion}% complete</p>
            <div className="mt-4 grid gap-2">
              <Link href="/profile/edit" className="btn btn-primary btn-sm w-full">
                Edit profile & photo
              </Link>
              <Link href="/preferences" className="btn btn-outline btn-sm w-full">
                Set partner preferences
              </Link>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-ink">Your numbers</h2>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ["Interests sent (accepted)", acceptedSent],
                ["Shortlisted profiles", shortlist.length],
                ["Active matches", matches.length],
                ["Unread notifications", unread],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between border-b border-[#f0ece1] pb-2 last:border-0">
                  <dt className="text-[#5c6b62]">{label}</dt>
                  <dd className="font-extrabold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card bg-gradient-to-br from-brand-800 to-brand-950 p-6 text-white">
            <h2 className="font-display text-lg font-semibold">🌏 India + Global members</h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-100">
              {siteStats.totalMembers} members are already searching. Your future sathi might be one profile away.
            </p>
            <Link href="/matches" className="btn btn-gold btn-sm mt-4">
              See recommended matches
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
