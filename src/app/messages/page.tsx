import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getConversationList } from "@/lib/data";
import { Avatar, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const user = await requireUser();
  const conversations = await getConversationList(user.id);

  return (
    <div className="container-p py-10">
      <div className="mb-8">
        <span className="eyebrow">Private inbox</span>
        <h1 className="section-title">Messages</h1>
        <p className="section-sub mt-2">
          Conversations open automatically once an interest is accepted on both sides.
        </p>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon="💬"
          title="No conversations yet"
          sub="Accept an interest — or receive one — and your private chat will appear here instantly."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/interests" className="btn btn-primary">
                Check interests
              </Link>
              <Link href="/find-matches" className="btn btn-outline">
                Browse profiles
              </Link>
            </div>
          }
        />
      ) : (
        <div className="card divide-y divide-[#f0ece1]">
          {conversations.map(({ conversation, other, lastMessage, unreadCount }) =>
            other ? (
              <Link
                key={conversation.id}
                href={`/messages/${conversation.id}`}
                className="flex items-center gap-4 px-5 py-4 transition hover:bg-cream"
              >
                <Avatar name={other.fullName} src={other.profilePhotoUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{other.fullName}</p>
                  <p className="truncate text-xs text-[#7c8a81]">
                    {lastMessage ? (
                      <>
                        {lastMessage.senderId === user.id && "You: "}
                        {lastMessage.content}
                      </>
                    ) : (
                      "Say hello 👋"
                    )}
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
    </div>
  );
}
