import { z } from "zod";
import { isValidIndianPhone, isValidPINCode } from "@/lib/utils";

/**
 * App-boundary validation (zod).
 * The DB stores enum-like strings; these schemas are the gatekeepers.
 */

/** /search page query params. */
export const searchParamsSchema = z.object({
  service: z.string().trim().max(80).optional().default(""),
  location: z.string().trim().max(80).optional().default(""),
  pin: z
    .string()
    .trim()
    .regex(/^\d{0,6}$/, "PIN code must be up to 6 digits")
    .optional()
    .default(""),
  category: z.string().trim().max(120).optional().default(""),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

/** Provider self-registration (future onboarding flow — shape locked early). */
export const providerJoinSchema = z.object({
  businessName: z.string().trim().min(3, "Business name is too short").max(80),
  contactName: z.string().trim().min(2, "Contact name is too short").max(80),
  phone: z.string().refine(isValidIndianPhone, "Enter a valid 10-digit Indian mobile number"),
  email: z.string().trim().email().optional().or(z.literal("")),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().refine(isValidPINCode, "Enter a valid 6-digit PIN code"),
  categorySlugs: z.array(z.string()).min(1, "Pick at least one service category"),
});

export type ProviderJoinInput = z.infer<typeof providerJoinSchema>;
