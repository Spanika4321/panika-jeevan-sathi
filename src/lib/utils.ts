export function clsx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function cleanPhone(value: string) {
  return value.replace(/[^0-9+]/g, "").trim();
}

export function getString(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

export function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key);
  return value.length > 0 ? value : null;
}

export function getInt(formData: FormData, key: string) {
  const value = getString(formData, key);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getBool(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

export function searchParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function toInt(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function yearsAgoDate(age: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

export function calculateAge(dateOfBirth?: string | Date | null) {
  if (!dateOfBirth) return null;
  const dob = typeof dateOfBirth === "string" ? new Date(`${dateOfBirth}T00:00:00`) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

export function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatTime(value?: string | Date | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function timeAgo(value?: string | Date | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function moneyLabel(value?: number | null) {
  if (!value) return "Not shared";
  return `₹${new Intl.NumberFormat("en-IN").format(value / 100000)} LPA`;
}

export function moneyFull(value?: number | null) {
  if (!value) return "Not shared";
  return `₹${new Intl.NumberFormat("en-IN").format(value)} / year`;
}

export function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "PJ"
  );
}

export function profileSummary(profile: Pick<ProfileSummary, "age" | "location" | "profession" | "education">) {
  return [profile.age ? `${profile.age} yrs` : null, profile.location, profile.profession, profile.education]
    .filter(Boolean)
    .join(" • ");
}

export type ProfileSummary = {
  age: number | null;
  location: string | null;
  profession: string | null;
  education: string | null;
};

export function sameText(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function textIncludes(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
}

export function redirectWithMessage(base: string, key: "notice" | "error", value: string) {
  const url = new URL(base, "https://panika.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export function safeReturnTo(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function profileCompletion(fields: Array<string | null | undefined | number>): number {
  const filled = fields.filter((f) => (typeof f === "number" ? f > 0 : f != null && String(f).trim().length > 0)).length;
  return Math.round((filled / fields.length) * 100);
}

export type PageSearchParams = Record<string, string | string[] | undefined>;

export function pageParam(params: PageSearchParams, key: string): string | undefined {
  const v = params[key];
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
