export const APP_NAME = "PANIKA JEEVAN SATHI";
export const APP_SHORT = "Panika Jeevan Sathi";
export const TAGLINE = "Find a life partner. Build a beautiful future.";
export const FREE_NOTE = "100% free — forever. No memberships, no paywalls.";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "https://panikajeevansathi.coolstore.in";

export const ADMIN_NAME = "Panika Sukul";
export const ADMIN_EMAIL = "sukulpanika939@gmail.com";
export const CONTACT_EMAIL = "sukulpanika939@gmail.com";
export const CONTACT_WHATSAPP = "8099834725";
export const CONTACT_WHATSAPP_LINK = `https://wa.me/91${CONTACT_WHATSAPP}?text=${encodeURIComponent(
  "Hello PANIKA JEEVAN SATHI! I have a question.",
)}`;

export const genderOptions = ["Female", "Male", "Other"] as const;
export const maritalStatusOptions = ["Never Married", "Divorced", "Widowed", "Separated"] as const;
export const visibilityOptions = [
  { value: "public", label: "Public — visible to everyone" },
  { value: "members", label: "Members only — visible to logged-in members" },
] as const;

export const religionOptions = [
  "Hindu",
  "Muslim",
  "Christian",
  "Sikh",
  "Buddhist",
  "Jain",
  "Parsi",
  "Other",
];
export const communityOptions = [
  "Brahmin",
  "Patel",
  "Jat",
  "Maratha",
  "Iyer",
  "Sunni",
  "Shia",
  "Rajput",
  "Kayastha",
  "Nair",
  "Reddy",
  "Kammala",
  "Gounder",
  "Vanniyar",
  "Other",
];
export const educationOptions = [
  "Below 10th",
  "10th Pass",
  "12th Pass",
  "Diploma",
  "Graduate",
  "Post Graduate",
  "MBA",
  "B.Tech / B.E.",
  "M.Tech / M.E.",
  "MBA + PGDM",
  "CA / CS / CMA",
  "MBBS / Doctor",
  "M.D. / Specialist",
  "Ph.D.",
  "Other",
];

export const locationOptions = [
  "New Delhi",
  "Mumbai, Maharashtra",
  "Pune, Maharashtra",
  "Ahmedabad, Gujarat",
  "Jaipur, Rajasthan",
  "Lucknow, Uttar Pradesh",
  "Kolkata, West Bengal",
  "Chennai, Tamil Nadu",
  "Bangalore, Karnataka",
  "Hyderabad, Telangana",
  "Kochi, Kerala",
  "Indore, Madhya Pradesh",
  "Patna, Bihar",
  "Bhopal, Madhya Pradesh",
  "Surat, Gujarat",
  "London, UK",
  "Dubai, UAE",
  "Singapore",
  "New York, USA",
  "Sydney, Australia",
];

export const navLinks = [
  { href: "/", label: "Home" },
  { href: "/find-matches", label: "Search Profiles" },
  { href: "/matches", label: "Recommended" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/contact", label: "Contact" },
] as const;
