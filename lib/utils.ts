/**
 * SEVA MARKET INDIA — shared pure utilities.
 * Framework-free so they are trivially unit-testable.
 */

/** Compose conditional class names (lightweight `cn`). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** URL-safe slug: "AC & Appliance Repair" → "ac-and-appliance-repair". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Format a number as Indian Rupees with en-IN grouping: 125000 → "₹1,25,000". */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Indian PIN codes: 6 digits, cannot start with 0. */
export function isValidPINCode(pin: string): boolean {
  return /^[1-9][0-9]{5}$/.test(pin.trim());
}

/** Indian mobile numbers (10-digit, starting 6–9; tolerates +91/0/spaces/dashes). */
export function isValidIndianPhone(phone: string): boolean {
  const normalized = phone
    .replace(/[\s-]/g, "")
    .replace(/^\+91/, "")
    .replace(/^0/, "");
  return /^[6-9]\d{9}$/.test(normalized);
}

/** Price-band label: "₹199 – ₹399" / "₹199 onwards" / "Price on request". */
export function formatPriceBand(min?: number | null, max?: number | null): string {
  if (min && max) return `${formatINR(min)} – ${formatINR(max)}`;
  if (min) return `${formatINR(min)} onwards`;
  if (max) return `Up to ${formatINR(max)}`;
  return "Price on request";
}

// ─────────────────────────────────────────────────────────────
// Search URL builder — single source of truth for /search params
// ─────────────────────────────────────────────────────────────
export interface SearchUrlInput {
  service?: string | null;
  location?: string | null;
  pin?: string | null;
  category?: string | null;
}

export function buildSearchUrl(input: SearchUrlInput): string {
  const params = new URLSearchParams();
  const service = input.service?.trim();
  const location = input.location?.trim();
  const pin = input.pin?.trim();
  const category = input.category?.trim();

  if (service) params.set("service", service);
  if (location) params.set("location", location);
  if (pin) params.set("pin", pin);
  if (category) params.set("category", category);

  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}
