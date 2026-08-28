import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getChat } from "@/lib/data";
import { ActionForm } from "@/components/client-forms";
import { Avatar, EmptyState } from "@/components/ui";
import { formatTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversation" };

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = Number.parseInt(id, 10);
  if (!Number.isFinite(conversationId)) notFound();

  const user = await requireUser();
  const chat = await getChat(user.id, conversationId);
  if (!chat) notFound();

  return (
    <div className="container-p py-8">
      <nav className="mb-5 flex items-center justify-between" aria-label="Breadcrumb">
        <Link href="/messages" className="text-sm font-bold text-brand-700 hover:underline">
          ← All messages
        </Link>
        {chat.other && (
          <Link href={`/profile/${chat.other.userId}`} className="text-sm font-bold text-brand-700 hover:underline">
            View profile →
          </Link>
        )}
      </nav>

      {!chat.other ? (
        <EmptyState icon="🕊️" title="This conversation is no longer available" />
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3.5 border-b border-[#f0ece1] bg-cream px-5 py-4">
              <Avatar name={chat.other.fullName} src={chat.other.profilePhotoUrl} size={46} />
              <div className="flex-1">
                <p className="text-sm font-bold text-ink">
                  {chat.other.fullName} {chat.other.age ? `• ${chat.other.age}` : ""}
                </p>
                <p className="text-xs font-semibold text-brand-600">
                  {chat.isBlocked ? "⚠️ Messaging is blocked in this conversation" : "💞 Matched connection"}
                </p>
              </div>
            </div>

            <div className="max-h-[46vh] min-h-[240px] space-y-3 overflow-y-auto px-5 py-5">
              {chat.messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#7c8a81]">
                  No messages yet — say namaste! 🙏
                </p>
              ) : (
                chat.messages.map((msg) => {
                  const mine = msg.senderId === user.id;
                  return (
                    <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={
                          mine
                            ? "max-w-[82%] rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-sm text-white"
                            : "max-w-[82%] rounded-2xl rounded-bl-md border border-[#e8e4d8] bg-white px-4 py-2.5 text-sm text-ink"
                        }
                      >
                        <p className="whitespace-pre-line break-words">{msg.content}</p>
                        <p className={`mt-1 text-[10px] font-semibold ${mine ? "text-brand-200" : "text-[#9aa89f]"}`}>
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {chat.isBlocked ? (
            <div className="card mt-4 p-5 text-sm font-semibold text-rose-700">
              This conversation is blocked (by either side). Messaging is disabled.
            </div>
          ) : (
            <div className="card mt-4 p-4">
              <ActionForm
                action="sendMessage"
                payload={{ conversationId: String(conversationId) }}
                submitLabel="Send"
                busyLabel="Sending…"
                submitClassName="btn btn-primary w-full sm:w-auto"
                className="sm:flex sm:items-end sm:gap-3"
                resetOnSuccess={false}
              >
                <textarea
                  name="content"
                  rows={2}
                  maxLength={2000}
                  required
                  placeholder="Type your message…"
                  className="textarea flex-1"
                  defaultValue=""
                />
              </ActionForm>
            </div>
          )}
        </>
      )}
    </div>
  );
}
