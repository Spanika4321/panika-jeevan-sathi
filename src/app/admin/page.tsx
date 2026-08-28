import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getAdminDashboardData } from "@/lib/data";
import { ActionForm } from "@/components/client-forms";
import { Avatar, EmptyState, Stat } from "@/components/ui";
import { FlashNotice } from "@/components/site-chrome";
import { formatDate, timeAgo, PageSearchParams, pageParam } from "@/lib/utils";


export const metadata: Metadata = { title: "Admin" };

const TABS = [
  ["users", "👥 Users"],
  ["profiles", "📋 Profiles"],
  ["reports", "🚩 Reports"],
  ["content", "📣 Content"],
  ["admins", "🛡️ Admins"],
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const viewer = await requireAdmin();
  const params = await searchParams;
  const tab = pageParam(params, "tab") ?? "users";
  const search = pageParam(params, "q") ?? "";

  const data = await getAdminDashboardData(search);

  return (
    <div className="container-p py-10">
      <FlashNotice notice={pageParam(params, "notice")} error={pageParam(params, "error")} />

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="eyebrow">Control room</span>
          <h1 className="section-title">Admin panel</h1>
          <p className="section-sub mt-1">Logged in as {viewer.fullName} (admin)</p>
        </div>
        <Link href="/dashboard" className="btn btn-outline btn-sm">
          ← Back to site
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <Stat icon="👥" label="Total members" value={data.stats.totalUsers} />
        <Stat icon="✅" label="Active" value={data.stats.activeUsers} />
        <Stat icon="🆕" label="New (7 days)" value={data.stats.newUsers} />
        <Stat icon="✔️" label="Verified" value={data.stats.verifiedProfiles} />
        <Stat icon="🚩" label="Open reports" value={data.stats.pendingReports} />
        <Stat icon="💌" label="Pending interests" value={data.stats.pendingInterests} />
        <Stat icon="✉️" label="New contacts" value={data.stats.newContacts} />
      </div>

      <div className="tabs mb-8 flex-wrap">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/admin?tab=${key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            className={`tab ${tab === key ? "tab-active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* ---------------- USERS ---------------- */}
      {tab === "users" && (
        <div className="space-y-5">
          <form action="/admin?tab=users" method="GET" className="flex max-w-md gap-2">
            <input name="q" defaultValue={search} placeholder="Search name, email or mobile…" className="input" />
            <button type="submit" className="btn btn-primary btn-sm">
              Search
            </button>
          </form>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Profile</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-[#7c8a81]">
                        No users found.
                      </td>
                    </tr>
                  )}
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link href={`/profile/${u.id}`} className="font-bold text-ink hover:text-brand-700">
                          {u.fullName}
                        </Link>
                        {u.role === "admin" && <span className="chip chip-gold ml-2">admin</span>}
                      </td>
                      <td>
                        <p className="text-[#5c6b62]">{u.email}</p>
                        <p className="text-xs text-[#9aa89f]">+91 {u.mobile}</p>
                      </td>
                      <td>
                        <span
                          className={`chip ${
                            u.status === "active"
                              ? "chip-brand"
                              : u.status === "suspended"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td>
                        {u.approvalStatus ? (
                          <div className="flex flex-wrap gap-1">
                            <span className="chip">{u.approvalStatus}</span>
                            {u.verificationStatus === "verified" && <span className="chip chip-brand">✔ verified</span>}
                          </div>
                        ) : (
                          <span className="text-xs text-[#9aa89f]">no profile</span>
                        )}
                      </td>
                      <td className="text-xs text-[#7c8a81]">{formatDate(u.createdAt)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {u.status === "active" ? (
                            <ActionForm
                              action="adminUserAction"
                              payload={{ userId: String(u.id), subAction: "suspend" }}
                              submitLabel="Suspend"
                              submitClassName="btn btn-danger btn-sm !px-3 !py-1.5"
                              className=""
                            />
                          ) : (
                            <ActionForm
                              action="adminUserAction"
                              payload={{ userId: String(u.id), subAction: "activate" }}
                              submitLabel="Activate"
                              submitClassName="btn btn-primary btn-sm !px-3 !py-1.5"
                              className=""
                            />
                          )}
                          {u.role === "admin" && u.id !== viewer.id && (
                            <ActionForm
                              action="adminUserAction"
                              payload={{ userId: String(u.id), subAction: "removeAdmin" }}
                              submitLabel="Remove admin"
                              submitClassName="btn btn-outline btn-sm !px-3 !py-1.5"
                              className=""
                            />
                          )}
                          {u.role !== "admin" && (
                            <ActionForm
                              action="adminUserAction"
                              payload={{ userId: String(u.id), subAction: "makeAdmin" }}
                              submitLabel="Make admin"
                              submitClassName="btn btn-outline btn-sm !px-3 !py-1.5"
                              className=""
                            />
                          )}
                          {u.role !== "admin" && (
                            <ActionForm
                              action="adminUserAction"
                              payload={{ userId: String(u.id), subAction: "delete" }}
                              submitLabel="Delete"
                              confirmText={`Permanently delete ${u.fullName} and all their data?`}
                              submitClassName="btn btn-danger-solid btn-sm !px-3 !py-1.5"
                              className=""
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- PROFILES ---------------- */}
      {tab === "profiles" && (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Location</th>
                  <th>Approval</th>
                  <th>Verification</th>
                  <th>Visibility</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.profiles.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[#7c8a81]">
                      No profiles yet.
                    </td>
                  </tr>
                )}
                {data.profiles.map((p) => (
                  <tr key={p.userId}>
                    <td>
                      <Link href={`/profile/${p.userId}`} className="font-bold text-ink hover:text-brand-700">
                        {p.fullName}
                      </Link>
                      <p className="text-xs text-[#9aa89f]">{p.profession ?? "—"}</p>
                    </td>
                    <td className="text-[#5c6b62]">{p.location ?? "—"}</td>
                    <td>
                      <span className={`chip ${p.approvalStatus === "approved" ? "chip-brand" : "bg-rose-100 text-rose-700"}`}>
                        {p.approvalStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`chip ${p.verificationStatus === "verified" ? "chip-brand" : ""}`}>
                        {p.verificationStatus}
                      </span>
                    </td>
                    <td>
                      <span className="chip">{p.visibility}</span>
                    </td>
                    <td className="text-xs text-[#7c8a81]">{formatDate(p.createdAt)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {p.approvalStatus === "approved" ? (
                          <ActionForm
                            action="adminProfileAction"
                            payload={{ userId: String(p.userId), subAction: "suspend" }}
                            submitLabel="Suspend"
                            submitClassName="btn btn-danger btn-sm !px-3 !py-1.5"
                            className=""
                          />
                        ) : (
                          <ActionForm
                            action="adminProfileAction"
                            payload={{ userId: String(p.userId), subAction: "approve" }}
                            submitLabel="Approve"
                            submitClassName="btn btn-primary btn-sm !px-3 !py-1.5"
                            className=""
                          />
                        )}
                        {p.verificationStatus === "verified" ? (
                          <ActionForm
                            action="adminProfileAction"
                            payload={{ userId: String(p.userId), subAction: "unverify" }}
                            submitLabel="Unverify"
                            submitClassName="btn btn-outline btn-sm !px-3 !py-1.5"
                            className=""
                          />
                        ) : (
                          <ActionForm
                            action="adminProfileAction"
                            payload={{ userId: String(p.userId), subAction: "verify" }}
                            submitLabel="Verify"
                            submitClassName="btn btn-gold btn-sm !px-3 !py-1.5"
                            className=""
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- REPORTS ---------------- */}
      {tab === "reports" &&
        (data.reports.length === 0 ? (
          <EmptyState icon="🛡️" title="No reports" sub="Great — the community is behaving. Reports will appear here." />
        ) : (
          <div className="space-y-4">
            {data.reports.map(({ report, reporter, reported }) => (
              <div key={report.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span
                      className={`chip ${
                        report.status === "pending" ? "bg-rose-100 text-rose-700" : report.status === "resolved" ? "chip-brand" : ""
                      }`}
                    >
                      {report.status}
                    </span>
                    <span className="chip ml-2">🚩 {report.reason}</span>
                    <span className="ml-2 text-xs text-[#9aa89f]">{timeAgo(report.createdAt)}</span>
                  </div>
                  <div className="text-xs text-[#5c6b62]">
                    <span className="font-bold">{reporter?.fullName ?? "Guest"}</span> reported{" "}
                    <span className="font-bold">{reported?.fullName ?? "unknown user"}</span>
                  </div>
                </div>
                {report.details && <p className="mt-3 rounded-xl bg-cream px-4 py-3 text-sm text-[#4c5c53]">{report.details}</p>}
                {report.adminNote && (
                  <p className="mt-2 text-xs font-semibold text-[#7c8a81]">Admin note: {report.adminNote}</p>
                )}
                {report.status === "pending" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionForm
                      action="adminReportAction"
                      payload={{ reportId: String(report.id), subAction: "resolve" }}
                      submitLabel="Mark resolved"
                      submitClassName="btn btn-primary btn-sm"
                      className=""
                    />
                    <ActionForm
                      action="adminReportAction"
                      payload={{ reportId: String(report.id), subAction: "dismiss" }}
                      submitLabel="Dismiss"
                      submitClassName="btn btn-outline btn-sm"
                      className=""
                    />
                    {reported && (
                      <ActionForm
                        action="adminReportAction"
                        payload={{ reportId: String(report.id), subAction: "suspendUser" }}
                        submitLabel="Suspend reported user"
                        confirmText={`Suspend ${reported.fullName}? They will not be able to login until you activate them.`}
                        submitClassName="btn btn-danger-solid btn-sm"
                        className=""
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

      {/* ---------------- CONTENT ---------------- */}
      {tab === "content" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="font-display text-xl font-semibold text-ink">Website announcement</h2>
            <p className="mt-1 text-xs text-[#7c8a81]">Shown as a banner on the home page for all visitors.</p>
            <div className="card mt-4 p-6">
              <ActionForm
                action="adminAnnouncement"
                submitLabel="Publish announcement"
                busyLabel="Publishing…"
                className="space-y-4"
                submitClassName="btn btn-gold w-full"
              >
                <div>
                  <label className="label" htmlFor="ann-title">Title</label>
                  <input id="ann-title" name="title" className="input" required placeholder="e.g. New global members joined!" />
                </div>
                <div>
                  <label className="label" htmlFor="ann-body">Message</label>
                  <textarea id="ann-body" name="body" rows={3} className="textarea" required placeholder="Keep it short and friendly." />
                </div>
              </ActionForm>

              {data.announcements.length > 0 && (
                <div className="mt-6 border-t border-[#f0ece1] pt-4">
                  <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#7c8a81]">Published</h3>
                  <ul className="mt-3 space-y-3">
                    {data.announcements.map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-3 rounded-xl bg-cream px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ink">{a.title}</p>
                          <p className="text-xs text-[#7c8a81]">{a.body}</p>
                          <p className="mt-1 text-[10px] font-semibold text-[#9aa89f]">
                            {timeAgo(a.createdAt)} • {a.audience}
                          </p>
                        </div>
                        <ActionForm
                          action="adminDeleteAnnouncement"
                          payload={{ announcementId: String(a.id) }}
                          submitLabel="Delete"
                          confirmText="Delete this announcement?"
                          submitClassName="btn btn-danger btn-sm !px-3 !py-1.5"
                          className=""
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink">Contact messages</h2>
            <div className="mt-4 space-y-3">
              {data.contacts.length === 0 ? (
                <EmptyState icon="✉️" title="No messages" sub="Messages from the Contact page appear here." />
              ) : (
                data.contacts.map((c) => (
                  <div key={c.id} className="card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-ink">
                        {c.name} <span className="font-normal text-[#7c8a81]">• {c.email}</span>
                        {c.phone && <span className="font-normal text-[#9aa89f]"> • +91 {c.phone}</span>}
                      </p>
                      <div className="flex gap-1.5">
                        <ActionForm
                          action="adminContactAction"
                          payload={{ messageId: String(c.id), subAction: c.status === "new" ? "read" : "reopen" }}
                          submitLabel={c.status === "new" ? "Mark read" : "Reopen"}
                          submitClassName="btn btn-outline btn-sm !px-3 !py-1.5"
                          className=""
                        />
                        <ActionForm
                          action="adminDeleteContact"
                          payload={{ messageId: String(c.id) }}
                          submitLabel="Delete"
                          confirmText="Delete this contact message?"
                          submitClassName="btn btn-danger btn-sm !px-3 !py-1.5"
                          className=""
                        />
                      </div>
                    </div>
                    <p className={`mt-2 text-sm ${c.status === "new" ? "font-semibold text-ink" : "text-[#5c6b62]"}`}>{c.message}</p>
                    <p className="mt-1 text-[10px] font-semibold text-[#9aa89f]">{timeAgo(c.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* ---------------- ADMINS ---------------- */}
      {tab === "admins" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <section className="card p-6">
            <h2 className="font-display text-xl font-semibold text-ink">Current admins</h2>
            <ul className="mt-4 space-y-3">
              {data.admins.map((a) => (
                <li key={a.id} className="flex items-center gap-3">
                  <Avatar name={a.name} size={40} />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-ink">{a.name}</p>
                    <p className="text-xs text-[#7c8a81]">{a.email} • {a.role}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-[#7c8a81]">
              Tip: promote any member from the Users tab. Removing admin rights happens there too.
            </p>
          </section>

          <section className="card p-6">
            <h2 className="font-display text-xl font-semibold text-ink">Recent interest activity</h2>
            <ul className="mt-4 space-y-2.5">
              {data.recentInterests.slice(0, 8).map(({ interest, sender, receiver }) => (
                <li key={interest.id} className="rounded-xl bg-cream px-4 py-3 text-sm">
                  <span className="font-bold text-ink">{sender?.fullName ?? "?"}</span>
                  <span className="mx-1.5 text-gold-600" aria-hidden="true">→</span>
                  <span className="font-bold text-ink">{receiver?.fullName ?? "?"}</span>
                  <span className={`chip ml-2 ${interest.status === "accepted" ? "chip-gold" : ""}`}>{interest.status}</span>
                  <span className="ml-2 text-[10px] font-semibold text-[#9aa89f]">{timeAgo(interest.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
