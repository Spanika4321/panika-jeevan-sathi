import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm } from "@/components/client-forms";
import { Field, SelectField } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  communityOptions,
  educationOptions,
  genderOptions,
  locationOptions,
  maritalStatusOptions,
  religionOptions,
} from "@/lib/constants";

export const metadata: Metadata = { title: "Create Free Profile" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="container-p py-12 lg:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <span className="eyebrow">Join free — forever free</span>
          <h1 className="section-title">Create your matrimonial profile</h1>
          <p className="section-sub mt-3 !mx-auto text-center">
            A few honest details help the right family find you. You can update everything anytime.
          </p>
        </div>

        <div className="card mt-8 overflow-hidden">
          <ActionForm action="register" submitLabel="Create my free profile" busyLabel="Creating your account…" className="p-6 sm:p-8">
            <section>
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gold-500 text-xs font-extrabold text-white">1</span>
                Your account
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Full name" name="fullName" placeholder="As on your documents" required />
                <div>
                  <label className="label" htmlFor="gender">
                    I am a <span className="text-rose-500">*</span>
                  </label>
                  <select id="gender" name="gender" className="select" required defaultValue="">
                    <option value="" disabled>
                      Select
                    </option>
                    {genderOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <Field label="Date of birth" name="dateOfBirth" type="date" required />
                <Field label="Mobile number" name="mobile" type="tel" placeholder="10-digit mobile number" required hint="Used only for your account. We never publish it." />
                <Field label="Email address" name="email" type="email" placeholder="you@example.com" required />
                <Field label="Password" name="password" type="password" placeholder="Min 8 chars, letters + numbers" required />
              </div>
            </section>

            <div className="my-7 h-px bg-[#f0ece1]" />

            <section>
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gold-500 text-xs font-extrabold text-white">2</span>
                Your profile basics
              </h2>
              <p className="mt-1 text-xs text-[#7c8a81]">All optional — but the more you share, the better your matches.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <SelectField label="Looking for" name="lookingFor" placeholder="Anyone" options={["Female", "Male"]} />
                <SelectField label="Location (city / state)" name="location" placeholder="Select or skip" options={locationOptions} />
                <SelectField label="Religion" name="religion" options={religionOptions} />
                <SelectField label="Community" name="community" options={communityOptions} />
                <SelectField label="Mother tongue" name="motherTongue" placeholder="e.g. Hindi" options={["Hindi", "Bengali", "Assamese", "Tamil", "Telugu", "Marathi", "Gujarati", "Kannada", "Malayalam", "Urdu", "Punjabi", "Odia", "Bhojpuri", "Manipuri", "Nagamese", "Other"]} />
                <SelectField label="Marital status" name="maritalStatus" options={maritalStatusOptions} />
                <SelectField label="Education" name="education" options={educationOptions} />
                <Field label="Profession" name="profession" placeholder="e.g. Software Engineer" />
                <Field label="Height (cm)" name="heightCm" type="number" inputProps={{ min: 130, max: 210 }} placeholder="e.g. 170" />
                <Field label="Income (per year, ₹)" name="income" type="number" inputProps={{ min: 0 }} placeholder="Optional" />
              </div>
              <div className="mt-4">
                <Field
                  label="One-line headline"
                  name="headline"
                  placeholder="e.g. Gentle, family-oriented doctor from Guwahati"
                  hint="Shown on your profile card — keep it under 200 characters."
                />
              </div>
            </section>
          </ActionForm>
        </div>

        <p className="mt-5 text-center text-sm text-[#5c6b62]">
          Already a member?{" "}
          <Link href="/login" className="font-bold text-brand-700 hover:underline">
            Login here
          </Link>
        </p>
      </div>
    </div>
  );
}
