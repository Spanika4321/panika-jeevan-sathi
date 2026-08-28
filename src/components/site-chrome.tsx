import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUnreadNotificationCount, getTotalUnreadMessages, getOwnProfile } from "@/lib/data";
import { CONTACT_EMAIL, CONTACT_WHATSAPP_LINK, CONTACT_WHATSAPP, navLinks } from "@/lib/constants";
import { clsx, initials } from "@/lib/utils";
import Logo from "./logo";
import { Avatar } from "./ui";

export async function Header() {
  const user = await getCurrentUser();
  const [unreadNotifs, unreadMsgs, profile] = user
    ? await Promise.all([
        getUnreadNotificationCount(user.id),
        getTotalUnreadMessages(user.id),
        getOwnProfile(user.id),
      ])
    : [0, 0, null];

  const totalBadge = user ? unreadNotifs + unreadMsgs : 0;

  return (
    <header className="sticky top-0 z-50 border-b border-[#e8e4d8] bg-cream/90 backdrop-blur">
      <div className="container-p flex h-[68px] items-center justify-between gap-3">
        <Logo />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-2 text-sm font-semibold text-[#3f5249] transition hover:bg-brand-50 hover:text-brand-900"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/messages"
                className="relative hidden h-10 w-10 place-items-center rounded-full border border-[#e8e4d8] bg-white text-lg sm:grid"
                aria-label={`Messages${unreadMsgs ? ` (${unreadMsgs} unread)` : ""}`}
                title="Messages"
              >
                ✉️
                {unreadMsgs > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                    {unreadMsgs > 9 ? "9+" : unreadMsgs}
                  </span>
                )}
              </Link>
              <Link
                href="/notifications"
                className="relative grid h-10 w-10 place-items-center rounded-full border border-[#e8e4d8] bg-white text-lg"
                aria-label={`Notifications${totalBadge ? ` (${totalBadge} new)` : ""}`}
                title="Notifications"
              >
                🔔
                {totalBadge > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-white">
                    {totalBadge > 9 ? "9+" : totalBadge}
                  </span>
                )}
              </Link>

              <details className="group relative">
                <summary className="list-none cursor-pointer">
                  <Avatar
                    src={profile?.profilePhotoUrl ?? undefined}
                    name={user.fullName}
                    size={40}
                    className="ring-2 ring-gold-400 ring-offset-2 ring-offset-cream"
                  />
                </summary>
                <div className="invisible absolute right-0 top-12 w-56 rounded-2xl border border-[#e8e4d8] bg-white p-1.5 opacity-0 shadow-lift transition-all duration-150 group-open:visible group-open:opacity-100">
                  <div className="border-b border-[#f0ece1] px-3 py-2.5">
                    <p className="truncate text-sm font-bold text-ink">{user.fullName}</p>
                    <p className="truncate text-xs text-[#7c8a81]">{user.email}</p>
                  </div>
                  {[
                    ["/dashboard", "🏠", "Dashboard"],
                    ["/profile", "👤", "My Profile"],
                    ["/preferences", "🎯", "Partner Preferences"],
                    ["/interests", "💌", "Interests"],
                    ["/shortlist", "⭐", "Shortlist"],
                    ["/settings", "⚙️", "Settings"],
                    ...(user.role === "admin" ? [["/admin", "🛡️", "Admin Panel"] as const] : []),
                  ].map(([href, icon, label]) => (
                    <Link
                      key={href}
                      href={href}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-[#3f5249] hover:bg-brand-50 hover:text-brand-900"
                    >
                      <span aria-hidden="true">{icon}</span> {label}
                    </Link>
                  ))}
                  <form action="/api/actions" method="POST" className="mt-1 border-t border-[#f0ece1] pt-1">
                    <input type="hidden" name="action" value="logout" />
                    <button
                      type="submit"
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      <span aria-hidden="true">🚪</span> Logout
                    </button>
                  </form>
                </div>
              </details>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                Login
              </Link>
              <Link href="/register" className="btn btn-gold btn-sm">
                Join Free
              </Link>
            </>
          )}

          <details className="group relative lg:hidden">
            <summary className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-full border border-[#e8e4d8] bg-white text-lg">
              {user ? "👤" : "☰"}
            </summary>
            <div className="invisible absolute right-0 top-12 w-60 rounded-2xl border border-[#e8e4d8] bg-white p-2 opacity-0 shadow-lift group-open:visible group-open:opacity-100">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-[#3f5249] hover:bg-brand-50"
                >
                  {link.label}
                </Link>
              ))}
              {user ? (
                <div className="mt-1 border-t border-[#f0ece1] pt-1">
                  {[
                    ["/dashboard", "Dashboard"],
                    ["/profile", "My Profile"],
                    ["/messages", "Messages"],
                    ["/notifications", "Notifications"],
                    ["/settings", "Settings"],
                  ].map(([href, label]) => (
                    <Link
                      key={href}
                      href={href}
                      className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-[#3f5249] hover:bg-brand-50"
                    >
                      {label}
                    </Link>
                  ))}
                  {user.role === "admin" && (
                    <Link href="/admin" className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50">
                      Admin Panel
                    </Link>
                  )}
                  <form action="/api/actions" method="POST" className="mt-1 border-t border-[#f0ece1] pt-1">
                    <input type="hidden" name="action" value="logout" />
                    <button type="submit" className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50">
                      Logout
                    </button>
                  </form>
                </div>
              ) : (
                <div className="mt-1 flex gap-2 border-t border-[#f0ece1] p-2">
                  <Link href="/login" className="btn btn-outline btn-sm flex-1">
                    Login
                  </Link>
                  <Link href="/register" className="btn btn-gold btn-sm flex-1">
                    Join Free
                  </Link>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function FlashNotice({ notice, error }: { notice?: string; error?: string }) {
  if (!notice && !error) return null;
  return (
    <div
      className={clsx(
        "mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold",
        error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-brand-200 bg-brand-50 text-brand-900",
      )}
      role="status"
    >
      <span aria-hidden="true">{error ? "⚠️" : "✅"}</span>
      <span>{error ?? notice}</span>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 bg-brand-950 text-brand-100">
      <div className="container-p grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <svg width="38" height="38" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <circle cx="20" cy="26" r="13" stroke="#8CC5B4" strokeWidth="3.4" />
              <circle cx="29" cy="22" r="13" stroke="#FBC95F" strokeWidth="3.4" />
            </svg>
            <span className="font-display text-lg font-semibold text-white">
              PANIKA <span className="text-gold-400">JEEVAN</span> SATHI
            </span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-brand-200">
            India&apos;s trusted, 100% free matrimonial platform. Find a life partner with genuine profiles, family
            values and honest intentions — at home or abroad.
          </p>
          <a
            href={CONTACT_WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#25d366] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1fbd5a]"
          >
            <WhatsAppIcon className="h-4 w-4" /> WhatsApp: +91 {CONTACT_WHATSAPP}
          </a>
        </div>

        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-400">Explore</h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[
              ["/find-matches", "Search Profiles"],
              ["/matches", "Recommended Matches"],
              ["/register", "Create Free Profile"],
              ["/login", "Member Login"],
              ["/about", "About Us"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="text-brand-200 transition hover:text-white">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-400">Support</h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[
              ["/contact", "Contact Us"],
              ["/safety", "Safety Guidelines"],
              ["/privacy-policy", "Privacy Policy"],
              ["/terms", "Terms of Service"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="text-brand-200 transition hover:text-white">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-400">Get in touch</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-brand-200">
            <li className="flex items-start gap-2">
              <span aria-hidden="true">✉️</span> {CONTACT_EMAIL}
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true">💬</span>
              <a href={CONTACT_WHATSAPP_LINK} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                +91 {CONTACT_WHATSAPP} (WhatsApp)
              </a>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true"></span> Mon–Sat, 9:00 AM – 7:00 PM IST
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-brand-900">
        <div className="container-p flex flex-col items-center justify-between gap-3 py-5 text-xs text-brand-300 sm:flex-row">
          <p>© {new Date().getFullYear()} PANIKA JEEVAN SATHI. All rights reserved.</p>
          <p className="font-semibold text-gold-400">100% Free • No memberships • No hidden charges</p>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm0 18.03c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

export function WhatsAppFab() {
  return (
    <a
      href={CONTACT_WHATSAPP_LINK}
      target="_blank"
      rel="noopener noreferrer"
      className="wa-fab"
      aria-label="Chat with us on WhatsApp"
      title="Chat on WhatsApp"
    >
      <WhatsAppIcon className="h-7 w-7" />
    </a>
  );
}

export async function RequireUser({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <>{children}</>;
}
