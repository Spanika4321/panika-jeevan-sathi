/**
 * Database architecture tests — run against the throwaway test SQLite DB
 * (`npm test` re-creates it via `tsx db/push.ts --reset` before Vitest).
 *
 * Validates the full India → State → District → City → Locality → PIN
 * hierarchy plus the core marketplace relations, constraints and cascades.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { client, db, ensureDbReady } from "@/db";
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
import { buildProviderWhere } from "@/lib/search";
import { DDL_TABLES } from "@/db/ddl";

beforeAll(async () => {
  await ensureDbReady;
  // Clean slate in FK-dependency order (db is already fresh via --reset,
  // this also keeps `vitest --watch` runs deterministic).
  for (const table of [
    serviceListings,
    providerProfiles,
    services,
    categories,
    users,
    localities,
    pinCodes,
    cities,
    districts,
    states,
  ]) {
    await db.delete(table);
  }
});

afterAll(async () => {
  await client.close();
});

describe("schema materialisation (drift guard)", () => {
  it("contains every table defined in db/ddl.ts", async () => {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    const present = new Set(result.rows.map((r) => String(r.name)));
    for (const table of DDL_TABLES) {
      expect(present.has(table), `missing table: ${table}`).toBe(true);
    }
    expect(present.size).toBeGreaterThanOrEqual(DDL_TABLES.length);
  });

  it("enforces foreign keys (PRAGMA on)", async () => {
    const pragma = await client.execute("PRAGMA foreign_keys");
    expect(Number(pragma.rows[0]?.foreign_keys ?? 0)).toBe(1);
  });
});

describe("Location hierarchy (India → State → District → City → Locality → PIN)", () => {
  it("creates and traverses the full chain in both directions", async () => {
    await db.insert(pinCodes).values({ code: "999999" }).onConflictDoNothing();
    const [state] = await db
      .insert(states)
      .values({ name: "Test Pradesh", code: "TP" })
      .returning();
    const [district] = await db
      .insert(districts)
      .values({ stateId: state.id, name: "Test District" })
      .returning();
    const [city] = await db
      .insert(cities)
      .values({ districtId: district.id, name: "Test City" })
      .returning();
    const [locality] = await db
      .insert(localities)
      .values({ cityId: city.id, name: "Test Locality", pinCode: "999999" })
      .returning();

    // Bottom-up: locality → city → district → state + pin
    const tree = await db.query.localities.findFirst({
      where: eq(localities.id, locality.id),
      with: {
        city: { with: { district: { with: { state: true } } } },
        pin: true,
      },
    });
    expect(tree?.city.name).toBe("Test City");
    expect(tree?.city.district.name).toBe("Test District");
    expect(tree?.city.district.state.name).toBe("Test Pradesh");
    expect(tree?.pin.code).toBe("999999");

    // Top-down: state → districts → cities → localities
    const down = await db.query.states.findFirst({
      where: eq(states.id, state.id),
      with: { districts: { with: { cities: { with: { localities: true } } } } },
    });
    expect(down?.districts[0].cities[0].localities[0].name).toBe("Test Locality");
  });

  it("enforces unique (parent, name) per location level", async () => {
    const [state] = await db.insert(states).values({ name: "Unique Pradesh" }).returning();
    await db.insert(districts).values({ stateId: state.id, name: "Solo District" });
    await expect(
      db.insert(districts).values({ stateId: state.id, name: "Solo District" })
    ).rejects.toThrow();

    // Same district name is valid inside a different state.
    const [other] = await db.insert(states).values({ name: "Other Pradesh" }).returning();
    await expect(
      db.insert(districts).values({ stateId: other.id, name: "Solo District" })
    ).resolves.toBeTruthy();
  });

  it("supports one PIN covering many localities (search-by-PIN basis)", async () => {
    await db.insert(pinCodes).values({ code: "888888" }).onConflictDoNothing();
    const [state] = await db.insert(states).values({ name: "Pin Pradesh" }).returning();
    const [district] = await db
      .insert(districts)
      .values({ stateId: state.id, name: "Pin District" })
      .returning();
    const [city] = await db
      .insert(cities)
      .values({ districtId: district.id, name: "Pin City" })
      .returning();
    for (const name of ["North Area", "South Area", "East Area"]) {
      await db.insert(localities).values({ cityId: city.id, name, pinCode: "888888" });
    }

    const byPin = await db.query.pinCodes.findFirst({
      where: eq(pinCodes.code, "888888"),
      with: { localities: true },
    });
    expect(byPin?.localities).toHaveLength(3);
  });
});

describe("Categories & services", () => {
  it("creates a category with services and enforces unique slugs", async () => {
    const [category] = await db
      .insert(categories)
      .values({ name: "Test Category", slug: "test-category", icon: "Zap", sortOrder: 99 })
      .returning();
    await db.insert(services).values({
      categoryId: category.id,
      name: "Widget Fixing",
      slug: "widget-fixing",
      unit: "visit",
      priceMin: 199,
      priceMax: 399,
    });
    await expect(
      db.insert(services).values({
        categoryId: category.id,
        name: "Widget Fixing Again",
        slug: "widget-fixing",
      })
    ).rejects.toThrow();

    const rows = await db.query.categories.findFirst({
      where: eq(categories.slug, "test-category"),
      with: { services: true },
    });
    expect(rows?.services).toHaveLength(1);
    expect(rows?.services[0].priceMin).toBe(199);
  });
});

describe("Users & providers", () => {
  it("links user → provider profile → locality → listings", async () => {
    await db.insert(pinCodes).values({ code: "777777" }).onConflictDoNothing();
    const [state] = await db.insert(states).values({ name: "Provider Pradesh" }).returning();
    const [district] = await db
      .insert(districts)
      .values({ stateId: state.id, name: "Provider District" })
      .returning();
    const [city] = await db
      .insert(cities)
      .values({ districtId: district.id, name: "Provider City" })
      .returning();
    const [locality] = await db
      .insert(localities)
      .values({ cityId: city.id, name: "Provider Colony", pinCode: "777777" })
      .returning();

    const [user] = await db
      .insert(users)
      .values({ name: "Test Provider", phone: "9999900000", role: "PROVIDER" })
      .returning();
    const [provider] = await db
      .insert(providerProfiles)
      .values({
        userId: user.id,
        businessName: "Test Provider Services",
        localityId: locality.id,
        isVerified: true,
        experienceYears: 5,
        ratingAvg: 4.5,
        ratingCount: 12,
      })
      .returning();

    const [category] = await db
      .insert(categories)
      .values({ name: "PC Category", slug: "pc-category" })
      .returning();
    const [service] = await db
      .insert(services)
      .values({ categoryId: category.id, name: "PC Service", slug: "pc-service" })
      .returning();
    await db.insert(serviceListings).values({
      providerId: provider.id,
      serviceId: service.id,
      priceMin: 100,
      priceMax: 200,
    });

    const full = await db.query.providerProfiles.findFirst({
      where: eq(providerProfiles.id, provider.id),
      with: {
        user: true,
        locality: { with: { city: true, pin: true } },
        services: { with: { service: true } },
      },
    });

    expect(full?.user.phone).toBe("9999900000");
    expect(full?.locality?.name).toBe("Provider Colony");
    expect(full?.locality?.pin.code).toBe("777777");
    expect(full?.services[0].service.name).toBe("PC Service");
  });

  it("prevents duplicate provider-service listings", async () => {
    const [user] = await db
      .insert(users)
      .values({ name: "Dup Provider", phone: "9888800000", role: "PROVIDER" })
      .returning();
    const [provider] = await db
      .insert(providerProfiles)
      .values({ userId: user.id, businessName: "Dup Services" })
      .returning();
    const [category] = await db
      .insert(categories)
      .values({ name: "Dup Cat", slug: "dup-cat" })
      .returning();
    const [service] = await db
      .insert(services)
      .values({ categoryId: category.id, name: "Dup Service", slug: "dup-service" })
      .returning();

    await db.insert(serviceListings).values({ providerId: provider.id, serviceId: service.id });
    await expect(
      db.insert(serviceListings).values({ providerId: provider.id, serviceId: service.id })
    ).rejects.toThrow();
  });

  it("search filter (production /search shape): service + PIN combine via AND", async () => {
    // Mirrors app/search/page.tsx through the shared lib/search.ts builder.
    const providers = await db.query.providerProfiles.findMany({
      where: buildProviderWhere({ service: "PC Service", location: "", pin: "777777", category: "" }),
      with: { locality: true },
    });

    expect(providers).toHaveLength(1);
    expect(providers[0].businessName).toBe("Test Provider Services");
    expect(providers[0].locality?.pinCode).toBe("777777");

    // A different PIN must not match.
    const none = await db.query.providerProfiles.findMany({
      where: buildProviderWhere({ service: "PC Service", location: "", pin: "560034", category: "" }),
    });
    expect(none).toHaveLength(0);
  });

  it("cascades: deleting a user removes their provider profile and listings", async () => {
    const [user] = await db
      .insert(users)
      .values({ name: "Cascade User", phone: "9777700000", role: "PROVIDER" })
      .returning();
    const [provider] = await db
      .insert(providerProfiles)
      .values({ userId: user.id, businessName: "Cascade Services" })
      .returning();
    const [category] = await db
      .insert(categories)
      .values({ name: "Cascade Cat", slug: "cascade-cat" })
      .returning();
    const [service] = await db
      .insert(services)
      .values({ categoryId: category.id, name: "Cascade Service", slug: "cascade-service" })
      .returning();
    await db.insert(serviceListings).values({ providerId: provider.id, serviceId: service.id });

    await db.delete(users).where(eq(users.id, user.id));

    expect(
      await db.query.providerProfiles.findFirst({ where: eq(providerProfiles.id, provider.id) })
    ).toBeUndefined();
    expect(
      await db.select().from(serviceListings).where(eq(serviceListings.providerId, provider.id))
    ).toHaveLength(0);
  });
});
