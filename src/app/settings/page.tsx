import Link from "next/link";
import type { Metadata } from "next";
import { PageSearchParams, pageParam } from "@/lib/utils";
import { requireUser } from "@/lib/auth";
import { getBlockedUsers, getOwnPrivacy } from "@/lib/data";
import { ActionForm } from "@/components/client-forms";
import { Avatar } from "@/components/ui";
import { FlashNotice } from "@/components/site-chrome";


export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [privacy, blocked] = await Promise.all([getOwnPrivacy(user.id), getBlockedUsers(user.id)]);

  return (
    <div className="container-p max-w-3xl py-10">
      <FlashNotice notice={pageParam(params, "notice")} error={pageParam(params, "error")} />

      <span className="eyebrow">Account</span>
      <h1 className="section-title">Settings</h1>

      <div className="mt-8 space-y-8">
        {/* Password */}
        <section className="card p-6">
          <h2 className="font-display text-lg font-semibold text-ink">Change password</h2>
          <p className="mt-1 text-xs text-[#7c8a81]">
            Account: {user.email} • Mobile: +91 {user.mobile}
          </p>
          <ActionForm
            action="changePassword"
            submitLabel="Update password"
            busyLabel="Updating…"
            className="mt-4 grid gap-4 sm:grid-cols-3"
            submitClassName="btn btn-primary sm:col-span-3"
          >
            <div>
              <label className="label" htmlFor="cur-pass">Current password</label>
              <input id="cur-pass" name="currentPassword" type="password" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="new-pass">New password</label>
              <input id="new-pass" name="newPassword" type="password" className="input" required minLength={8} />
            </div>
            <div>
              <label className="label" htmlFor="confirm-pass">Confirm new password</label>
              <input id="confirm-pass" name="confirmPassword" type="password" className="input" required />
            </div>
            <p className="text-xs text-[#7c8a81] sm:col-span-3">Minimum 8 characters with letters and numbers.</p>
          </ActionForm>
        </section>

        {/* Privacy */}
        <section className="card p-6">
          <h2 className="font-display text-lg font-semibold text-ink">Privacy</h2>
          <ActionForm
            action="updatePrivacy"
            submitLabel="Save privacy settings"
            busyLabel="Saving…"
            className="mt-4 space-y-4"
            submitClassName="btn btn-primary"
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#e8e4d8] p-4">
              <input
                type="checkbox"
                name="hidePhone"
                defaultChecked={privacy?.hidePhone ?? true}
                className="mt-1 h-4 w-4 accent-[#1d5649]"
              />
              <span>
                <span className="block text-sm font-bold text-ink">Hide my phone number</span>
                <span className="block text-xs text-[#7c8a81]">
                  Matched partners can see it only if you uncheck this. Recommended: keep hidden until you trust the person.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#e8e4d8] p-4">
              <input
                type="checkbox"
                name="hideEmail"
                defaultChecked={privacy?.hideEmail ?? true}
                className="mt-1 h-4 w-4 accent-[#1d5649]"
              />
              <span>
                <span className="block text-sm font-bold text-ink">Hide my email</span>
                <span className="block text-xs text-[#7c8a81]">Matched partners can see it only if you uncheck this.</span>
              </span>
            </label>
            <div>
              <label className="label" htmlFor="visibility">Profile visibility</label>
              <select
                id="visibility"
                name="profileVisibility"
                className="select"
                defaultValue={privacy?.profileVisibility ?? "members"}
              >
                <option value="members">Members only — visible to logged-in members</option>
                <option value="public">Public — visible to everyone, including guests</option>
              </select>
            </div>
          </ActionForm>
        </section>

        {/* Blocked users */}
        <section className="card p-6">
          <h2 className="font-display text-lg font-semibold text-ink">Blocked users</h2>
          {blocked.length === 0 ? (
            <p className="mt-3 text-sm text-[#7c8a81]">You haven&apos;t blocked anyone.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {blocked.map(({ profile, reason, createdAt }) => (
                <li key={profile?.userId ?? createdAt.getTime()} className="flex items-center gap-3.5">
                  {profile && <Avatar name={profile.fullName} src={profile.profilePhotoUrl} size={40} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">{profile?.fullName ?? "Unknown user"}</p>
                    <p className="truncate text-xs text-[#7c8a81]">{reason ?? "Blocked"}</p>
                  </div>
                  {profile && (
                    <ActionForm
                      action="unblockUser"
                      payload={{ profileUserId: String(profile.userId) }}
                      submitLabel="Unblock"
                      submitClassName="btn btn-outline btn-sm"
                      className=""
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Danger zone */}
        <section className="card border-rose-200 p-6">
          <h2 className="font-display text-lg font-semibold text-rose-700">Delete account</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#5c6b62]">
            This permanently removes your profile, interests, messages and notifications. This cannot be undone.
          </p>
          <ActionForm
            action="deleteAccount"
            submitLabel="Delete my account"
            busyLabel="Deleting…"
            confirmText="Are you absolutely sure? Your profile and all data will be permanently deleted."
            submitClassName="btn btn-danger-solid"
            className="mt-4"
          >
            <div>
              <label className="label" htmlFor="confirm-name">
                Type your full name ({user.fullName}) to confirm
              </label>
              <input id="confirm-name" name="confirmName" className="input" required />
            </div>
          </ActionForm>
        </section>

        <div className="text-center text-sm text-[#7c8a81]">
          Need help?{" "}
          <Link href="/contact" className="font-bold text-brand-700 hover:underline">
            Contact us
          </Link>{" "}
          or WhatsApp +91 8099834725
        </div>
      </div>
    </div>
  );
}
