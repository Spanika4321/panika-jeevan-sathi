import { describe, expect, it } from "vitest";
import { providerJoinSchema, searchParamsSchema } from "@/lib/validation";

describe("searchParamsSchema", () => {
  it("defaults every field to an empty string", () => {
    expect(searchParamsSchema.parse({})).toEqual({
      service: "",
      location: "",
      pin: "",
      category: "",
    });
  });

  it("trims values", () => {
    expect(searchParamsSchema.parse({ service: "  Electrician " })).toMatchObject({
      service: "Electrician",
    });
  });

  it("rejects non-numeric or over-long PIN input", () => {
    expect(searchParamsSchema.safeParse({ pin: "abc123" }).success).toBe(false);
    expect(searchParamsSchema.safeParse({ service: "x".repeat(81) }).success).toBe(false);
  });

  it("accepts partial PIN typing (up to 6 digits)", () => {
    expect(searchParamsSchema.safeParse({ pin: "400" }).success).toBe(true);
  });
});

describe("providerJoinSchema", () => {
  const valid = {
    businessName: "Rajesh Electricals",
    contactName: "Rajesh Kumar",
    phone: "9876543210",
    email: "",
    city: "Delhi",
    pincode: "110005",
    categorySlugs: ["electrician"],
  };

  it("accepts a valid provider submission", () => {
    expect(providerJoinSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid phone and PIN", () => {
    expect(providerJoinSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(false);
    expect(providerJoinSchema.safeParse({ ...valid, pincode: "011000" }).success).toBe(false);
  });

  it("requires a business name and at least one category", () => {
    expect(providerJoinSchema.safeParse({ ...valid, businessName: "ab" }).success).toBe(false);
    expect(providerJoinSchema.safeParse({ ...valid, categorySlugs: [] }).success).toBe(false);
  });
});
