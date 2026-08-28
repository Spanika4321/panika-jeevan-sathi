import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getNotifications } from "@/lib/data";
import { ActionForm } from "@/components/client-forms";
import { EmptyState } from "@/components/ui";
import { FlashNotice } from "@/components/site-chrome";
import { timeAgo, PageSearchParams, pageParam } from "@/lib/utils";


export const metadata: Metadata = { title: "Notifications" };

const typeIcons: Record<string, string> = {
  interest_received: "💌",
  interest_accepted: "💞",
  interest_rejected: "🕊️",
  shortlisted: "⭐",
  new_message: "💬",
  report_resolved: "🛡️",
  announcement: "📣",
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const notifications = await getNotifications(user.id);
  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <div className="container-p max-w-3xl py-10">
      <FlashNotice notice={pageParam(params, "notice")} error={pageParam(params, "error")} />

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Stay in the loop</span>
          <h1 className="section-title">Notifications</h1>
        </div>
        {hasUnread && (
          <ActionForm
            action="notificationAction"
            payload={{ subAction: "markAll" }}
            submitLabel="Mark all as read"
            submitClassName="btn btn-outline btn-sm"
            className=""
          />
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="No notifications yet"
          sub="When someone shows interest, accepts yours, or messages you, you'll be notified here."
          action={
            <Link href="/find-matches" className="btn btn-primary">
              Get started
            </Link>
          }
        />
      ) : (
        <div className="card divide-y divide-[#f0ece1]">
          {notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-4 px-5 py-4 ${n.readAt ? "" : "bg-gold-50/60"}`}>
              <span className="mt-0.5 text-xl" aria-hidden="true">
                {typeIcons[n.type] ?? "🔔"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink">{n.title}</p>
                {n.body && <p className="mt-0.5 text-xs leading-relaxed text-[#5c6b62]">{n.body}</p>}
                <p className="mt-1 text-[11px] font-semibold text-[#9aa89f]">{timeAgo(n.createdAt)}</p>
              </div>
              {!n.readAt && n.linkUrl ? (
                <Link href={n.linkUrl} className="btn btn-primary btn-sm shrink-0">
                  Open
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
