"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm } from "./client-forms";
import { Avatar, VerifiedBadge } from "./ui";
import { REPORT_REASONS } from "@/lib/report-reasons";

type InterestInfo = { id: number; status: string; message: string | null; createdAt: Date } | null;

export default function ProfileActions({
  profileUserId,
  profileName,
  isOwner,
  loggedIn,
  accepted,
  shortlisted,
  sentInterest,
  receivedInterest,
  conversationId,
}: {
  profileUserId: number;
  profileName: string;
  isOwner: boolean;
  loggedIn: boolean;
  accepted: boolean;
  shortlisted: boolean;
  sentInterest: InterestInfo;
  receivedInterest: InterestInfo;
  conversationId?: number;
}) {
  const [showInterestForm, setShowInterestForm] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);

  if (!loggedIn) {
    return (
      <div className="card space-y-3 p-6 text-center">
        <p className="text-sm font-semibold text-[#5c6b62]">
          Create a free profile to send interest, shortlist and chat with {profileName.split(" ")[0]}.
        </p>
        <div className="grid gap-2">
          <Link href={`/register?next=/profile/${profileUserId}`} className="btn btn-gold w-full">
            Create free profile
          </Link>
          <Link href={`/login?returnTo=/profile/${profileUserId}`} className="btn btn-outline w-full">
            I already have a profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-5 p-6">
      {/* primary action */}
      {isOwner ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-[#5c6b62]">This is your profile.</p>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/profile/edit" className="btn btn-primary w-full">
              Edit profile
            </Link>
            <Link href="/preferences" className="btn btn-outline w-full">
              Preferences
            </Link>
          </div>
        </div>
      ) : (
        <>
          {sentInterest?.status === "pending" && (
            <div className="space-y-3">
              <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-bold text-brand-800">
                💌 Interest sent on {new Date(sentInterest.createdAt).toLocaleDateString("en-IN")}.
                {sentInterest.message ? " They'll see your message." : ""}
              </p>
              <ActionForm
                action="cancelInterest"
                payload={{ interestId: String(sentInterest.id) }}
                submitLabel="Cancel interest"
                submitClassName="btn btn-danger btn-sm w-full"
                className=""
              />
            </div>
          )}

          {sentInterest?.status === "accepted" && (
            <div className="space-y-3">
              <p className="rounded-xl bg-gold-50 px-4 py-3 text-sm font-bold text-gold-900">
                💞 You two are matched! {profileName.split(" ")[0]} accepted your interest.
              </p>
              <ActionForm
                action="startConversation"
                payload={{ profileUserId: String(profileUserId) }}
                submitLabel={conversationId ? `Open conversation` : "Start conversation"}
                submitClassName="btn btn-primary w-full"
                className=""
              />
            </div>
          )}

          {sentInterest?.status === "rejected" && (
            <p className="rounded-xl bg-cream-dark px-4 py-3 text-sm font-semibold text-[#5c6b62]">
              Your interest was not accepted. Keep searching — the right match is out there.
            </p>
          )}

          {receivedInterest?.status === "pending" && (
            <div className="space-y-3">
              <p className="rounded-xl bg-gold-50 px-4 py-3 text-sm font-bold text-gold-900">
                ⭐ {profileName.split(" ")[0]} sent you an interest — respond now!
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ActionForm
                  action="interestStatus"
                  payload={{ interestId: String(receivedInterest.id), status: "accept" }}
                  submitLabel="Accept 💞"
                  submitClassName="btn btn-primary w-full"
                  className=""
                />
                <ActionForm
                  action="interestStatus"
                  payload={{ interestId: String(receivedInterest.id), status: "reject" }}
                  submitLabel="Reject"
                  submitClassName="btn btn-danger w-full"
                  className=""
                />
              </div>
            </div>
          )}

          {receivedInterest?.status === "accepted" && (
            <div className="space-y-3">
              <p className="rounded-xl bg-gold-50 px-4 py-3 text-sm font-bold text-gold-900">
                💞 You accepted {profileName.split(" ")[0]}'s interest. You're matched!
              </p>
              <ActionForm
                action="startConversation"
                payload={{ profileUserId: String(profileUserId) }}
                submitLabel="Open conversation"
                submitClassName="btn btn-primary w-full"
                className=""
              />
            </div>
          )}

          {receivedInterest?.status === "rejected" && (
            <p className="rounded-xl bg-cream-dark px-4 py-3 text-sm font-semibold text-[#5c6b62]">
              You declined this interest earlier.
            </p>
          )}

          {!sentInterest && !receivedInterest && (
            <div className="space-y-3">
              {!showInterestForm ? (
                <button
                  type="button"
                  onClick={() => setShowInterestForm(true)}
                  className="btn btn-primary w-full"
                >
                  💌 Send Interest
                </button>
              ) : (
                <ActionForm
                  action="sendInterest"
                  payload={{ receiverId: String(profileUserId) }}
                  submitLabel="Send interest"
                  busyLabel="Sending…"
                  submitClassName="btn btn-primary w-full"
                  onSuccess={() => setShowInterestForm(false)}
                >
                  <div className="space-y-3 rounded-2xl bg-cream p-4">
                    <p className="text-sm font-bold text-ink">
                      Tell {profileName.split(" ")[0]} why you&apos;re interested
                    </p>
                    <textarea
                      name="message"
                      rows={3}
                      maxLength={500}
                      placeholder="e.g. Hi! I noticed we're both from Assam and love music. I'd love to know more about you and your family."
                      className="textarea"
                    />
                    <p className="text-xs text-[#7c8a81]">Optional — but a personal note works wonders. Max 500 characters.</p>
                  </div>
                </ActionForm>
              )}
            </div>
          )}

          {/* secondary actions */}
          <div className="grid grid-cols-2 gap-2 border-t border-[#f0ece1] pt-4">
            <ActionForm
              action="shortlist"
              payload={{ profileUserId: String(profileUserId) }}
              submitLabel={shortlisted ? "★ Shortlisted" : "☆ Shortlist"}
              submitClassName={shortlisted ? "btn btn-gold w-full" : "btn btn-outline w-full"}
              className=""
            />
            {accepted ? (
              <ActionForm
                action="startConversation"
                payload={{ profileUserId: String(profileUserId) }}
                submitLabel="💬 Message"
                submitClassName="btn btn-outline w-full"
                className=""
              />
            ) : (
              <button
                type="button"
                className="btn btn-outline w-full"
                title="Chat opens after an interest is accepted"
              >
                🔒 Chat (after match)
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[#f0ece1] pt-3 text-xs">
            <button
              type="button"
              onClick={() => setShowReportForm((v) => !v)}
              className="font-bold text-[#7c8a81] hover:text-rose-700"
            >
              🚩 Report profile
            </button>
            <ActionForm
              action="blockUser"
              payload={{ profileUserId: String(profileUserId) }}
              submitLabel="Block user"
              busyLabel="Blocking…"
              confirmText={`Block ${profileName}? You will no longer see their profiles and messaging will be disabled.`}
              submitClassName="font-bold text-[#7c8a81] hover:text-rose-700"
              className="contents"
            />
          </div>

          {showReportForm && (
            <ActionForm
              action="reportProfile"
              payload={{ profileUserId: String(profileUserId) }}
              submitLabel="Submit report"
              submitClassName="btn btn-danger btn-sm w-full"
              onSuccess={() => setShowReportForm(false)}
            >
              <div className="space-y-3 rounded-2xl bg-cream p-4">
                <div>
                  <label className="label" htmlFor="report-reason">Reason</label>
                  <select id="report-reason" name="reason" className="select" defaultValue="">
                    <option value="" disabled>
                      Select a reason
                    </option>
                    {REPORT_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="report-details">Details (optional)</label>
                  <textarea id="report-details" name="details" rows={2} className="textarea" placeholder="Anything our team should know…" />
                </div>
              </div>
            </ActionForm>
          )}
        </>
      )}

      {accepted && !isOwner && (
        <div className="rounded-2xl bg-brand-50 p-4 text-xs leading-relaxed text-brand-900">
          <strong>🛡️ Stay safe:</strong> never share money or documents, meet in public or family settings, and report
          anything uncomfortable immediately.
        </div>
      )}
    </div>
  );
}

export function ProfilePhoto({
  url,
  name,
  verificationStatus,
  headline,
}: {
  url: string | null;
  name: string;
  verificationStatus: string;
  headline?: string | null;
}) {
  return (
    <div>
      <div className="relative overflow-hidden rounded-3xl border border-[#e8e4d8] bg-gradient-to-br from-brand-100 to-cream-dark">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="aspect-[4/4.6] w-full object-cover" />
        ) : (
          <div className="grid aspect-[4/4.6] w-full place-items-center">
            <Avatar name={name} size={120} className="!text-5xl" />
          </div>
        )}
        {verificationStatus === "verified" && (
          <div className="absolute left-4 top-4">
            <VerifiedBadge />
          </div>
        )}
      </div>
      {headline && <p className="mt-4 text-sm italic leading-relaxed text-[#5c6b62]">“{headline}”</p>}
    </div>
  );
}
