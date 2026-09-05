import { describe, expect, it } from "vitest";
import {
  buildSearchUrl,
  cn,
  formatINR,
  formatPriceBand,
  isValidIndianPhone,
  isValidPINCode,
  slugify,
} from "@/lib/utils";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("skips false/null/undefined entries", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Home Cleaning")).toBe("home-cleaning");
  });

  it("converts ampersand to 'and'", () => {
    expect(slugify("AC & Appliance Repair")).toBe("ac-and-appliance-repair");
    expect(slugify("Packers & Movers")).toBe("packers-and-movers");
  });

  it("strips special characters and collapses separators", () => {
    expect(slugify("  T. Nagar — Deep   Cleaning! ")).toBe("t-nagar-deep-cleaning");
  });

  it("returns empty string for junk input", () => {
    expect(slugify("???")).toBe("");
  });
});

describe("formatINR", () => {
  it("formats with en-IN digit grouping", () => {
    expect(formatINR(125000)).toBe("₹1,25,000");
  });

  it("formats small and zero amounts", () => {
    expect(formatINR(0)).toBe("₹0");
    expect(formatINR(999)).toBe("₹999");
  });

  it("drops decimal places", () => {
    expect(formatINR(499.9)).toBe("₹500");
  });
});

describe("isValidPINCode", () => {
  it("accepts valid 6-digit PINs", () => {
    expect(isValidPINCode("110001")).toBe(true);
    expect(isValidPINCode("400053")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isValidPINCode("  560034  ")).toBe(true);
  });

  it("rejects PINs starting with 0", () => {
    expect(isValidPINCode("010001")).toBe(false);
  });

  it("rejects wrong lengths and non-digits", () => {
    expect(isValidPINCode("11000")).toBe(false);
    expect(isValidPINCode("1100012")).toBe(false);
    expect(isValidPINCode("11000a")).toBe(false);
  });
});

describe("isValidIndianPhone", () => {
  it("accepts 10-digit mobile numbers starting 6-9", () => {
    expect(isValidIndianPhone("9876543210")).toBe(true);
    expect(isValidIndianPhone("6123456789")).toBe(true);
  });

  it("accepts +91 / 0 prefixed numbers", () => {
    expect(isValidIndianPhone("+919876543210")).toBe(true);
    expect(isValidIndianPhone("09876543210")).toBe(true);
  });

  it("tolerates spaces and dashes", () => {
    expect(isValidIndianPhone("98765 43210")).toBe(true);
  });

  it("rejects invalid numbers", () => {
    expect(isValidIndianPhone("1234567890")).toBe(false);
    expect(isValidIndianPhone("987654321")).toBe(false);
    expect(isValidIndianPhone("98765432101")).toBe(false);
  });
});

describe("formatPriceBand", () => {
  it("renders min – max", () => {
    expect(formatPriceBand(199, 399)).toBe("₹199 – ₹399");
  });

  it("renders one-sided bands", () => {
    expect(formatPriceBand(199, null)).toBe("₹199 onwards");
    expect(formatPriceBand(null, 999)).toBe("Up to ₹999");
  });

  it("falls back to price-on-request", () => {
    expect(formatPriceBand(undefined, null)).toBe("Price on request");
  });
});

describe("buildSearchUrl", () => {
  it("returns bare /search with no input", () => {
    expect(buildSearchUrl({})).toBe("/search");
    expect(buildSearchUrl({ service: "   ", location: "" })).toBe("/search");
  });

  it("includes only provided filters, trimmed", () => {
    expect(buildSearchUrl({ service: " plumber " })).toBe("/search?service=plumber");
    expect(buildSearchUrl({ pin: "400053" })).toBe("/search?pin=400053");
  });

  it("encodes multi-word values and combines filters in a stable order", () => {
    expect(
      buildSearchUrl({ service: "ac repair", location: "mumbai", pin: "400053", category: "plumber" })
    ).toBe("/search?service=ac+repair&location=mumbai&pin=400053&category=plumber");
  });
});
