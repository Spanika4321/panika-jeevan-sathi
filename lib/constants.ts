/**
 * SEVA MARKET INDIA — app-wide constants.
 */

export const SITE = {
  name: "Seva Market India",
  shortName: "Seva Market",
  tagline: "India's local services marketplace",
  description:
    "Find and contact trusted local service providers near you — electricians, plumbers, cleaners, tutors and more — by service, city, locality or PIN code.",
  supportEmail: "support@sevamarket.in",
} as const;

/** User roles (schema stores these as strings — see db/schema.ts). */
export const ROLES = ["CUSTOMER", "PROVIDER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Primary navigation (header + mobile menu). */
export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/categories", label: "Categories" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/provider/join", label: "For Providers" },
] as const;

/** Footer city shortcuts → pre-filtered search. */
export const TOP_CITIES = [
  "Delhi",
  "Mumbai",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Jaipur",
] as const;

/** Popular services shown as quick chips under the hero search bar. */
export const POPULAR_SERVICES = [
  "Electrician",
  "Plumber",
  "AC Repair",
  "Home Cleaning",
  "Packers & Movers",
] as const;

/**
 * Fallback category grid used when the database is unreachable/empty so the
 * homepage still renders something useful (graceful degradation).
 */
export const FALLBACK_CATEGORIES = [
  { name: "Electrician", nameHi: "इलेक्ट्रिशियन", slug: "electrician", icon: "Zap" },
  { name: "Plumber", nameHi: "प्लंबर", slug: "plumber", icon: "Wrench" },
  { name: "Carpenter", nameHi: "कारपेंटर", slug: "carpenter", icon: "Hammer" },
  { name: "AC & Appliance Repair", nameHi: "एसी रिपेयर", slug: "ac-appliance-repair", icon: "AirVent" },
  { name: "Home Cleaning", nameHi: "होम क्लीनिंग", slug: "home-cleaning", icon: "Sparkles" },
  { name: "Pest Control", nameHi: "पेस्ट कंट्रोल", slug: "pest-control", icon: "Bug" },
  { name: "Painting", nameHi: "पेंटिंग", slug: "painting", icon: "Paintbrush" },
  { name: "Salon at Home", nameHi: "सैलून एट होम", slug: "salon-at-home", icon: "Scissors" },
  { name: "Packers & Movers", nameHi: "पैकर्स और मूवर्स", slug: "packers-movers", icon: "Truck" },
  { name: "Home Tutors", nameHi: "होम ट्यूटर", slug: "home-tutors", icon: "GraduationCap" },
  { name: "Mobile & Laptop Repair", nameHi: "मोबाइल रिपेयर", slug: "mobile-laptop-repair", icon: "Smartphone" },
  { name: "Car & Bike Care", nameHi: "कार और बाइक केयर", slug: "car-bike-care", icon: "Car" },
] as const;
