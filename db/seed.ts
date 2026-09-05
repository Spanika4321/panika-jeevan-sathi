/**
 * SEVA MARKET INDIA — database seed (foundation).
 * ─────────────────────────────────────────────
 * Populates:
 *   · All 28 States + 8 Union Territories
 *   · Sample District → City → Locality → PIN data for 10 major metros
 *   · 12 homepage categories with ~50 concrete services
 *   · 4 demo provider profiles with listings (search demo)
 *
 * Idempotent: safe to run repeatedly (upserts on natural keys).
 * Honours DATABASE_URL (defaults to file:./dev.db).
 */
import { and, eq } from "drizzle-orm";
import { db, ensureDbReady } from "@/db/index";
import {
  categories,
  cities,
  districts,
  localities,
  pinCodes,
  providerProfiles,
  serviceListings,
  services,
  states,
  users,
} from "@/db/schema";

// ─────────────────────────────────────────────────────────────
// 1 · States & Union Territories of India
// ─────────────────────────────────────────────────────────────
const STATES: Array<{ name: string; code: string; isUT?: boolean }> = [
  { name: "Andhra Pradesh", code: "AP" },
  { name: "Arunachal Pradesh", code: "AR" },
  { name: "Assam", code: "AS" },
  { name: "Bihar", code: "BR" },
  { name: "Chhattisgarh", code: "CG" },
  { name: "Goa", code: "GA" },
  { name: "Gujarat", code: "GJ" },
  { name: "Haryana", code: "HR" },
  { name: "Himachal Pradesh", code: "HP" },
  { name: "Jharkhand", code: "JH" },
  { name: "Karnataka", code: "KA" },
  { name: "Kerala", code: "KL" },
  { name: "Madhya Pradesh", code: "MP" },
  { name: "Maharashtra", code: "MH" },
  { name: "Manipur", code: "MN" },
  { name: "Meghalaya", code: "ML" },
  { name: "Mizoram", code: "MZ" },
  { name: "Nagaland", code: "NL" },
  { name: "Odisha", code: "OD" },
  { name: "Punjab", code: "PB" },
  { name: "Rajasthan", code: "RJ" },
  { name: "Sikkim", code: "SK" },
  { name: "Tamil Nadu", code: "TN" },
  { name: "Telangana", code: "TG" },
  { name: "Tripura", code: "TR" },
  { name: "Uttar Pradesh", code: "UP" },
  { name: "Uttarakhand", code: "UK" },
  { name: "West Bengal", code: "WB" },
  { name: "Andaman and Nicobar Islands", code: "AN", isUT: true },
  { name: "Chandigarh", code: "CH", isUT: true },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "DH", isUT: true },
  { name: "Delhi", code: "DL", isUT: true },
  { name: "Jammu and Kashmir", code: "JK", isUT: true },
  { name: "Ladakh", code: "LA", isUT: true },
  { name: "Lakshadweep", code: "LD", isUT: true },
  { name: "Puducherry", code: "PY", isUT: true },
];

// ─────────────────────────────────────────────────────────────
// 2 · Sample location tree for major metros
// ─────────────────────────────────────────────────────────────
const METRO_LOCATIONS: Array<{
  state: string;
  district: string;
  city: string;
  localities: Array<[string, string]>;
}> = [
  {
    state: "Delhi",
    district: "New Delhi",
    city: "Delhi",
    localities: [
      ["Connaught Place", "110001"],
      ["Karol Bagh", "110005"],
      ["Dwarka", "110075"],
      ["Saket", "110017"],
      ["Rohini", "110085"],
    ],
  },
  {
    state: "Maharashtra",
    district: "Mumbai",
    city: "Mumbai",
    localities: [
      ["Andheri West", "400053"],
      ["Bandra West", "400050"],
      ["Powai", "400076"],
      ["Dadar", "400014"],
    ],
  },
  {
    state: "Maharashtra",
    district: "Pune",
    city: "Pune",
    localities: [
      ["Kothrud", "411038"],
      ["Hinjewadi", "411057"],
      ["Viman Nagar", "411014"],
    ],
  },
  {
    state: "Karnataka",
    district: "Bengaluru Urban",
    city: "Bengaluru",
    localities: [
      ["Koramangala", "560034"],
      ["Indiranagar", "560038"],
      ["Whitefield", "560066"],
      ["Jayanagar", "560041"],
    ],
  },
  {
    state: "Telangana",
    district: "Hyderabad",
    city: "Hyderabad",
    localities: [
      ["Ameerpet", "500016"],
      ["Gachibowli", "500032"],
      ["Banjara Hills", "500034"],
    ],
  },
  {
    state: "Tamil Nadu",
    district: "Chennai",
    city: "Chennai",
    localities: [
      ["T. Nagar", "600017"],
      ["Adyar", "600020"],
      ["Velachery", "600042"],
    ],
  },
  {
    state: "West Bengal",
    district: "Kolkata",
    city: "Kolkata",
    localities: [
      ["Salt Lake City", "700091"],
      ["Park Street", "700016"],
      ["Behala", "700034"],
    ],
  },
  {
    state: "Uttar Pradesh",
    district: "Lucknow",
    city: "Lucknow",
    localities: [
      ["Gomti Nagar", "226010"],
      ["Hazratganj", "226001"],
      ["Alambagh", "226005"],
    ],
  },
  {
    state: "Rajasthan",
    district: "Jaipur",
    city: "Jaipur",
    localities: [
      ["Malviya Nagar", "302017"],
      ["Vaishali Nagar", "302021"],
      ["C-Scheme", "302001"],
    ],
  },
  {
    state: "Gujarat",
    district: "Ahmedabad",
    city: "Ahmedabad",
    localities: [
      ["Satellite", "380015"],
      ["Maninagar", "380008"],
      ["Bodakdev", "380054"],
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// 3 · Categories & services
// ─────────────────────────────────────────────────────────────
const CATEGORIES: Array<{
  name: string;
  nameHi: string;
  slug: string;
  icon: string;
  services: Array<{ name: string; unit?: string; priceMin?: number; priceMax?: number }>;
}> = [
  {
    name: "Electrician",
    nameHi: "इलेक्ट्रिशियन",
    slug: "electrician",
    icon: "Zap",
    services: [
      { name: "Fan installation", unit: "visit", priceMin: 199, priceMax: 399 },
      { name: "Wiring & switchboard repair", unit: "visit", priceMin: 249, priceMax: 799 },
      { name: "Inverter & stabilizer installation", unit: "visit", priceMin: 399, priceMax: 899 },
      { name: "Light & chandelier fixture fitting", unit: "visit", priceMin: 199, priceMax: 599 },
      { name: "Full house wiring check", unit: "visit", priceMin: 499, priceMax: 1499 },
    ],
  },
  {
    name: "Plumber",
    nameHi: "प्लंबर",
    slug: "plumber",
    icon: "Wrench",
    services: [
      { name: "Tap & pipe leak repair", unit: "visit", priceMin: 149, priceMax: 399 },
      { name: "Bathroom fitting installation", unit: "visit", priceMin: 299, priceMax: 899 },
      { name: "Water tank cleaning", unit: "visit", priceMin: 499, priceMax: 1299 },
      { name: "Water motor / pump repair", unit: "visit", priceMin: 349, priceMax: 999 },
      { name: "Drain & blockage cleaning", unit: "visit", priceMin: 299, priceMax: 799 },
    ],
  },
  {
    name: "Carpenter",
    nameHi: "कारपेंटर",
    slug: "carpenter",
    icon: "Hammer",
    services: [
      { name: "Furniture repair", unit: "visit", priceMin: 249, priceMax: 699 },
      { name: "Door & lock fitting", unit: "visit", priceMin: 199, priceMax: 499 },
      { name: "Modular wardrobe & kitchen work", unit: "sq. ft.", priceMin: 450, priceMax: 1200 },
      { name: "Custom furniture making", unit: "item", priceMin: 1499, priceMax: 9999 },
    ],
  },
  {
    name: "AC & Appliance Repair",
    nameHi: "एसी और एप्लायंस रिपेयर",
    slug: "ac-appliance-repair",
    icon: "AirVent",
    services: [
      { name: "AC service & gas refill", unit: "visit", priceMin: 599, priceMax: 2499 },
      { name: "AC installation / uninstallation", unit: "visit", priceMin: 599, priceMax: 1299 },
      { name: "Refrigerator repair", unit: "visit", priceMin: 349, priceMax: 1299 },
      { name: "Washing machine repair", unit: "visit", priceMin: 349, priceMax: 1199 },
      { name: "Microwave & oven repair", unit: "visit", priceMin: 299, priceMax: 899 },
    ],
  },
  {
    name: "Home Cleaning",
    nameHi: "होम क्लीनिंग",
    slug: "home-cleaning",
    icon: "Sparkles",
    services: [
      { name: "Full home deep cleaning", unit: "visit", priceMin: 1999, priceMax: 5999 },
      { name: "Kitchen deep cleaning", unit: "visit", priceMin: 999, priceMax: 2499 },
      { name: "Bathroom deep cleaning", unit: "visit", priceMin: 599, priceMax: 1199 },
      { name: "Sofa & carpet shampooing", unit: "visit", priceMin: 599, priceMax: 1999 },
      { name: "Water tank cleaning", unit: "visit", priceMin: 699, priceMax: 1499 },
    ],
  },
  {
    name: "Pest Control",
    nameHi: "पेस्ट कंट्रोल",
    slug: "pest-control",
    icon: "Bug",
    services: [
      { name: "Cockroach & ant control", unit: "visit", priceMin: 999, priceMax: 2499 },
      { name: "Termite treatment", unit: "visit", priceMin: 1499, priceMax: 5999 },
      { name: "Bed bug treatment", unit: "visit", priceMin: 1199, priceMax: 3499 },
      { name: "Mosquito & general fumigation", unit: "visit", priceMin: 899, priceMax: 2299 },
    ],
  },
  {
    name: "Painting",
    nameHi: "पेंटिंग",
    slug: "painting",
    icon: "Paintbrush",
    services: [
      { name: "Interior wall painting", unit: "sq. ft.", priceMin: 12, priceMax: 35 },
      { name: "Exterior wall painting", unit: "sq. ft.", priceMin: 15, priceMax: 45 },
      { name: "Waterproofing & seepage treatment", unit: "sq. ft.", priceMin: 45, priceMax: 120 },
      { name: "Wood & metal polish", unit: "item", priceMin: 499, priceMax: 2999 },
    ],
  },
  {
    name: "Salon at Home",
    nameHi: "सैलून एट होम",
    slug: "salon-at-home",
    icon: "Scissors",
    services: [
      { name: "Women's salon package", unit: "visit", priceMin: 699, priceMax: 2499 },
      { name: "Haircut & styling", unit: "visit", priceMin: 299, priceMax: 999 },
      { name: "Men's grooming package", unit: "visit", priceMin: 399, priceMax: 1199 },
      { name: "Facial & clean-up", unit: "visit", priceMin: 499, priceMax: 1799 },
    ],
  },
  {
    name: "Packers & Movers",
    nameHi: "पैकर्स और मूवर्स",
    slug: "packers-movers",
    icon: "Truck",
    services: [
      { name: "Within-city home shifting", unit: "visit", priceMin: 3999, priceMax: 14999 },
      { name: "Intercity home shifting", unit: "visit", priceMin: 8999, priceMax: 39999 },
      { name: "Only packing service", unit: "visit", priceMin: 1999, priceMax: 7999 },
      { name: "Bike / car transport", unit: "item", priceMin: 2999, priceMax: 14999 },
    ],
  },
  {
    name: "Home Tutors",
    nameHi: "होम ट्यूटर",
    slug: "home-tutors",
    icon: "GraduationCap",
    services: [
      { name: "Class 6–10 all subjects tutoring", unit: "hour", priceMin: 300, priceMax: 800 },
      { name: "Class 11–12 (Science) tutoring", unit: "hour", priceMin: 500, priceMax: 1200 },
      { name: "Competitive exam coaching", unit: "hour", priceMin: 600, priceMax: 1500 },
      { name: "Spoken English classes", unit: "hour", priceMin: 250, priceMax: 700 },
    ],
  },
  {
    name: "Mobile & Laptop Repair",
    nameHi: "मोबाइल और लैपटॉप रिपेयर",
    slug: "mobile-laptop-repair",
    icon: "Smartphone",
    services: [
      { name: "Smartphone screen replacement", unit: "visit", priceMin: 899, priceMax: 5999 },
      { name: "Phone battery & charging port repair", unit: "visit", priceMin: 499, priceMax: 1999 },
      { name: "Laptop OS & software service", unit: "visit", priceMin: 499, priceMax: 1499 },
      { name: "Laptop hardware repair & upgrade", unit: "visit", priceMin: 899, priceMax: 4999 },
    ],
  },
  {
    name: "Car & Bike Care",
    nameHi: "कार और बाइक केयर",
    slug: "car-bike-care",
    icon: "Car",
    services: [
      { name: "Doorstep car wash & detailing", unit: "visit", priceMin: 499, priceMax: 2499 },
      { name: "Bike service at home", unit: "visit", priceMin: 399, priceMax: 1199 },
      { name: "Car battery jumpstart / replacement", unit: "visit", priceMin: 499, priceMax: 8999 },
      { name: "Tyre puncture & change assistance", unit: "visit", priceMin: 299, priceMax: 999 },
    ],
  },
];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─────────────────────────────────────────────────────────────
// 4 · Demo providers (dev preview data)
// ─────────────────────────────────────────────────────────────
const PROVIDERS: Array<{
  user: { name: string; email: string; phone: string };
  businessName: string;
  about: string;
  city: string;
  locality: string;
  experienceYears: number;
  ratingAvg: number;
  ratingCount: number;
  isVerified: boolean;
  categorySlugs: string[];
}> = [
  {
    user: { name: "Rajesh Kumar", email: "rajesh@demo.sevamarket.in", phone: "9876543210" },
    businessName: "Rajesh Electricals & Co.",
    about:
      "8+ years of residential electrical work in West Delhi. Same-day fan, wiring and inverter services with 30-day workmanship guarantee.",
    city: "Delhi",
    locality: "Karol Bagh",
    experienceYears: 8,
    ratingAvg: 4.7,
    ratingCount: 23,
    isVerified: true,
    categorySlugs: ["electrician"],
  },
  {
    user: { name: "Ayesha Shaikh", email: "ayesha@demo.sevamarket.in", phone: "9876500011" },
    businessName: "Mumbai HomeFix Services",
    about:
      "Trusted plumber and carpenter team serving Andheri to Bandra. Transparent pricing, fixed visits, weekend slots available.",
    city: "Mumbai",
    locality: "Andheri West",
    experienceYears: 6,
    ratingAvg: 4.5,
    ratingCount: 17,
    isVerified: true,
    categorySlugs: ["plumber", "carpenter"],
  },
  {
    user: { name: "Manoj Gowda", email: "manoj@demo.sevamarket.in", phone: "9876500022" },
    businessName: "CleanPro Bengaluru",
    about:
      "Professional deep-cleaning and eco-friendly pest control for homes and offices across South-East Bengaluru.",
    city: "Bengaluru",
    locality: "Koramangala",
    experienceYears: 4,
    ratingAvg: 4.2,
    ratingCount: 9,
    isVerified: false,
    categorySlugs: ["home-cleaning", "pest-control"],
  },
  {
    user: { name: "Sandeep Pawar", email: "sandeep@demo.sevamarket.in", phone: "9876500033" },
    businessName: "Shree Sai Packers & Movers",
    about:
      "Pune-based shifting experts for local and intercity moves. Trained crew, quality packing material, insured transit.",
    city: "Pune",
    locality: "Hinjewadi",
    experienceYears: 11,
    ratingAvg: 4.6,
    ratingCount: 31,
    isVerified: true,
    categorySlugs: ["packers-movers"],
  },
];

// ─────────────────────────────────────────────────────────────
// Seed runner
// ─────────────────────────────────────────────────────────────
async function main() {
  await ensureDbReady;
  console.log("🌱 Seeding SEVA MARKET INDIA…");

  // 1) States / UTs
  for (const s of STATES) {
    await db
      .insert(states)
      .values({ name: s.name, code: s.code, isUT: s.isUT ?? false })
      .onConflictDoUpdate({
        target: states.name,
        set: { code: s.code, isUT: s.isUT ?? false },
      });
  }
  console.log(`   ✓ ${STATES.length} states & UTs`);

  // 2) Metro location trees
  for (const loc of METRO_LOCATIONS) {
    const [state] = await db
      .insert(states)
      .values({ name: loc.state })
      .onConflictDoUpdate({ target: states.name, set: { name: loc.state } })
      .returning();

    const [district] = await db
      .insert(districts)
      .values({ stateId: state.id, name: loc.district })
      .onConflictDoUpdate({
        target: [districts.stateId, districts.name],
        set: { name: loc.district },
      })
      .returning();

    const [city] = await db
      .insert(cities)
      .values({ districtId: district.id, name: loc.city })
      .onConflictDoUpdate({
        target: [cities.districtId, cities.name],
        set: { name: loc.city },
      })
      .returning();

    for (const [localityName, pin] of loc.localities) {
      await db
        .insert(pinCodes)
        .values({ code: pin })
        .onConflictDoNothing({ target: pinCodes.code });

      await db
        .insert(localities)
        .values({ cityId: city.id, name: localityName, pinCode: pin })
        .onConflictDoUpdate({
          target: [localities.cityId, localities.name],
          set: { pinCode: pin },
        });
    }
  }
  console.log(`   ✓ ${METRO_LOCATIONS.length} metro location trees`);

  // 3) Categories & services
  let serviceCount = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    const [category] = await db
      .insert(categories)
      .values({
        name: c.name,
        nameHi: c.nameHi,
        slug: c.slug,
        icon: c.icon,
        sortOrder: i + 1,
      })
      .onConflictDoUpdate({
        target: categories.slug,
        set: { name: c.name, nameHi: c.nameHi, icon: c.icon, sortOrder: i + 1 },
      })
      .returning();

    for (const svc of c.services) {
      await db
        .insert(services)
        .values({
          categoryId: category.id,
          name: svc.name,
          slug: slugify(svc.name),
          unit: svc.unit ?? null,
          priceMin: svc.priceMin ?? null,
          priceMax: svc.priceMax ?? null,
        })
        .onConflictDoUpdate({
          target: services.slug,
          set: {
            categoryId: category.id,
            priceMin: svc.priceMin ?? null,
            priceMax: svc.priceMax ?? null,
          },
        });
      serviceCount += 1;
    }
  }
  console.log(`   ✓ ${CATEGORIES.length} categories · ${serviceCount} services`);

  // 4) Demo providers + listings
  for (const p of PROVIDERS) {
    const [user] = await db
      .insert(users)
      .values({ ...p.user, role: "PROVIDER" })
      .onConflictDoUpdate({
        target: users.phone,
        set: { name: p.user.name, email: p.user.email, role: "PROVIDER" },
      })
      .returning();

    const [locality] = await db
      .select({ id: localities.id })
      .from(localities)
      .innerJoin(cities, eq(localities.cityId, cities.id))
      .where(and(eq(cities.name, p.city), eq(localities.name, p.locality)))
      .limit(1);

    const [provider] = await db
      .insert(providerProfiles)
      .values({
        userId: user.id,
        businessName: p.businessName,
        about: p.about,
        localityId: locality?.id ?? null,
        experienceYears: p.experienceYears,
        ratingAvg: p.ratingAvg,
        ratingCount: p.ratingCount,
        isVerified: p.isVerified,
      })
      .onConflictDoUpdate({
        target: providerProfiles.userId,
        set: {
          businessName: p.businessName,
          about: p.about,
          localityId: locality?.id ?? null,
          experienceYears: p.experienceYears,
          ratingAvg: p.ratingAvg,
          ratingCount: p.ratingCount,
          isVerified: p.isVerified,
        },
      })
      .returning();

    for (const slug of p.categorySlugs) {
      const catServices = await db
        .select({ id: services.id, priceMin: services.priceMin, priceMax: services.priceMax })
        .from(services)
        .innerJoin(categories, eq(services.categoryId, categories.id))
        .where(eq(categories.slug, slug));

      for (const svc of catServices) {
        await db
          .insert(serviceListings)
          .values({
            providerId: provider.id,
            serviceId: svc.id,
            priceMin: svc.priceMin,
            priceMax: svc.priceMax,
          })
          .onConflictDoNothing({
            target: [serviceListings.providerId, serviceListings.serviceId],
          });
      }
    }
  }
  console.log(`   ✓ ${PROVIDERS.length} demo providers with listings`);

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => {
    // libsql client has no explicit disconnect; allow process to exit.
    process.exit(0);
  });
