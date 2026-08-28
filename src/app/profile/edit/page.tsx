import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getOwnProfile } from "@/lib/data";
import { ActionForm, PhotoUploadField } from "@/components/client-forms";
import { Field, SelectField } from "@/components/ui";
import {
  communityOptions,
  educationOptions,
  locationOptions,
  maritalStatusOptions,
  religionOptions,
} from "@/lib/constants";

export const metadata: Metadata = { title: "Edit Profile" };

const MOTHER_TONGUES = [
  "Hindi", "Bengali", "Assamese", "Tamil", "Telugu", "Marathi", "Gujarati", "Kannada",
  "Malayalam", "Urdu", "Punjabi", "Odia", "Bhojpuri", "Manipuri", "Nagamese", "Tulu", "Other",
];

export default async function EditProfilePage() {
  const user = await requireUser();
  const profile = await getOwnProfile(user.id);

  return (
    <div className="container-p max-w-4xl py-10">
      <span className="eyebrow">My profile</span>
      <h1 className="section-title">Edit profile</h1>
      <p className="section-sub mt-2">Keep your details honest and up to date — it builds trust with families.</p>

      <div className="card mt-8 p-6 sm:p-8">
        <ActionForm action="updateProfile" submitLabel="Save profile" busyLabel="Saving…" className="space-y-8">
          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold text-ink">Photo & basics</h2>
            <PhotoUploadField currentUrl={profile?.profilePhotoUrl ?? null} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="fullName" defaultValue={user.fullName} required />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={user.dateOfBirth ?? ""} />
                <div>
                  <label className="label">Gender</label>
                  <input className="input" value={user.gender} disabled />
                </div>
              </div>
              <Field label="Location (city / state)" name="location" defaultValue={profile?.location ?? ""} hint="e.g. Silchar, Assam" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Height (cm)" name="heightCm" type="number" inputProps={{ min: 130, max: 210 }} defaultValue={profile?.heightCm ?? ""} />
                <Field label="Income / year (₹)" name="income" type="number" inputProps={{ min: 0, step: 50000 }} defaultValue={profile?.income ?? ""} />
              </div>
            </div>
          </section>

          <div className="h-px bg-[#f0ece1]" />

          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="font-display text-lg font-semibold text-ink sm:col-span-2">Identity & background</h2>
            <SelectField label="Religion" name="religion" options={religionOptions} defaultValue={profile?.religion ?? undefined} />
            <SelectField label="Community" name="community" options={communityOptions} defaultValue={profile?.community ?? undefined} />
            <SelectField label="Mother tongue" name="motherTongue" options={MOTHER_TONGUES} defaultValue={profile?.motherTongue ?? undefined} />
            <SelectField label="Marital status" name="maritalStatus" options={maritalStatusOptions} defaultValue={profile?.maritalStatus ?? undefined} />
            <SelectField label="Education" name="education" options={educationOptions} defaultValue={profile?.education ?? undefined} />
            <Field label="Profession" name="profession" defaultValue={profile?.profession ?? ""} placeholder="e.g. Civil Engineer" />
          </section>

          <div className="h-px bg-[#f0ece1]" />

          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold text-ink">About you</h2>
            <Field label="Headline" name="headline" defaultValue={profile?.headline ?? ""} placeholder="One line that captures who you are" hint="Shown at the top of your profile card." />
            <Field label="About me" name="about" as="textarea" defaultValue={profile?.about ?? ""} placeholder="Your interests, values, a typical day, what you're looking for in life…" />
            <Field label="Family details" name="familyDetails" as="textarea" defaultValue={profile?.familyDetails ?? ""} placeholder="Tell us about your family — parents, siblings, family values…" />
            <Field label="Lifestyle" name="lifestyle" as="textarea" defaultValue={profile?.lifestyle ?? ""} placeholder="Vegetarian or non-vegetarian, smoking / drinking, fitness, hobbies…" />
          </section>
        </ActionForm>
      </div>
    </div>
  );
}
