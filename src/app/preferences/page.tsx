import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getOwnPreferences } from "@/lib/data";
import { ActionForm } from "@/components/client-forms";
import { Field, SelectField } from "@/components/ui";
import {
  communityOptions,
  educationOptions,
  locationOptions,
  maritalStatusOptions,
  religionOptions,
} from "@/lib/constants";

export const metadata: Metadata = { title: "Partner Preferences" };

const MOTHER_TONGUES = [
  "Hindi", "Bengali", "Assamese", "Tamil", "Telugu", "Marathi", "Gujarati", "Kannada",
  "Malayalam", "Urdu", "Punjabi", "Odia", "Bhojpuri", "Manipuri", "Nagamese", "Other",
];

export default async function PreferencesPage() {
  const user = await requireUser();
  const prefs = await getOwnPreferences(user.id);

  return (
    <div className="container-p max-w-3xl py-10">
      <span className="eyebrow">Partner preferences</span>
      <h1 className="section-title">Who are you looking for?</h1>
      <p className="section-sub mt-2">
        These preferences power your <strong>recommended matches</strong> and help families connect faster. Leave a field
        empty to keep it open.
      </p>

      <div className="card mt-8 p-6 sm:p-8">
        <ActionForm action="updatePreferences" submitLabel="Save preferences" busyLabel="Saving…" className="space-y-8">
          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-display text-lg font-semibold text-ink sm:col-span-2">The basics</h2>
            <SelectField
              label="Looking for"
              name="lookingFor"
              options={["Female", "Male"]}
              defaultValue={prefs?.lookingFor ?? (user.gender === "Male" ? "Female" : user.gender === "Female" ? "Male" : undefined)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Age from" name="ageMin" type="number" inputProps={{ min: 18, max: 80 }} defaultValue={prefs?.ageMin ?? ""} />
              <Field label="Age to" name="ageMax" type="number" inputProps={{ min: 18, max: 80 }} defaultValue={prefs?.ageMax ?? ""} />
            </div>
            <Field label="Preferred location" name="location" defaultValue={prefs?.location ?? ""} hint="e.g. Assam, or leave empty for anywhere (India + global)" />
            <SelectField label="Preferred religion" name="religion" options={religionOptions} defaultValue={prefs?.religion ?? undefined} />
          </section>

          <div className="h-px bg-[#f0ece1]" />

          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-display text-lg font-semibold text-ink sm:col-span-2">More specific (optional)</h2>
            <SelectField label="Community" name="community" options={communityOptions} defaultValue={prefs?.community ?? undefined} />
            <SelectField label="Mother tongue" name="motherTongue" options={MOTHER_TONGUES} defaultValue={prefs?.motherTongue ?? undefined} />
            <SelectField label="Marital status" name="maritalStatus" options={maritalStatusOptions} defaultValue={prefs?.maritalStatus ?? undefined} />
            <SelectField label="Education" name="education" options={educationOptions} defaultValue={prefs?.education ?? undefined} />
            <Field label="Profession (keyword)" name="profession" defaultValue={prefs?.profession ?? ""} placeholder="e.g. Doctor, Engineer, Teacher" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Income ≥ (₹/yr)" name="incomeMin" type="number" inputProps={{ min: 0, step: 100000 }} defaultValue={prefs?.incomeMin ?? ""} />
              <Field label="Income ≤ (₹/yr)" name="incomeMax" type="number" inputProps={{ min: 0, step: 100000 }} defaultValue={prefs?.incomeMax ?? ""} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Height ≥ (cm)" name="heightMinCm" type="number" inputProps={{ min: 130, max: 210 }} defaultValue={prefs?.heightMinCm ?? ""} />
              <Field label="Height ≤ (cm)" name="heightMaxCm" type="number" inputProps={{ min: 130, max: 210 }} defaultValue={prefs?.heightMaxCm ?? ""} />
            </div>
          </section>

          <div className="h-px bg-[#f0ece1]" />

          <section>
            <h2 className="font-display text-lg font-semibold text-ink">A note for matches</h2>
            <div className="mt-3">
              <Field
                label="Description"
                name="description"
                as="textarea"
                defaultValue={prefs?.description ?? ""}
                placeholder="e.g. Looking for someone kind, independent and close to family. A good sense of humour is a bonus!"
              />
            </div>
          </section>
        </ActionForm>
      </div>

      <p className="mt-4 text-xs text-[#7c8a81]">
        Tip: broad preferences bring more recommendations; specific ones bring more relevant ones. You can change them anytime.
      </p>
    </div>
  );
}
