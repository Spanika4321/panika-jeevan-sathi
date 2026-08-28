import type { Metadata } from "next";
import { PageSearchParams, pageParam } from "@/lib/utils";
import { ActionForm } from "@/components/client-forms";
import { Field } from "@/components/ui";
import { FlashNotice } from "@/components/site-chrome";
import { CONTACT_EMAIL, CONTACT_WHATSAPP, CONTACT_WHATSAPP_LINK } from "@/lib/constants";


export const metadata: Metadata = { title: "Contact Us" };

export default async function ContactPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const params = await searchParams;

  return (
    <div className="container-p py-12">
      <FlashNotice notice={pageParam(params, "notice")} error={pageParam(params, "error")} />

      <div className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">We&apos;re here for you</span>
        <h1 className="section-title">Contact us</h1>
        <p className="section-sub mt-3 !mx-auto">
          Questions, feedback or family referrals — we reply to every message, usually within 24 hours.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-4xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <a
            href={CONTACT_WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-hover flex items-center gap-4 p-6"
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#25d366] text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden="true">
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm5.52 11.85c-.25-.12-1.47-.72-1.69-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z" />
              </svg>
            </span>
            <div>
              <p className="font-display font-semibold text-ink">WhatsApp (fastest)</p>
              <p className="text-sm text-[#5c6b62]">+91 {CONTACT_WHATSAPP} • tap to chat</p>
            </div>
          </a>

          <div className="card flex items-center gap-4 p-6">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-100 text-2xl" aria-hidden="true">
              ✉️
            </span>
            <div>
              <p className="font-display font-semibold text-ink">Email</p>
              <p className="break-all text-sm text-[#5c6b62]">{CONTACT_EMAIL}</p>
            </div>
          </div>

          <div className="card p-6 text-sm leading-relaxed text-[#5c6b62]">
            <p className="font-display font-semibold text-ink">Support hours</p>
            <p className="mt-1">Monday – Saturday, 9:00 AM to 7:00 PM (IST).</p>
            <p className="mt-3 font-display font-semibold text-ink">Safety promise</p>
            <p className="mt-1">
              Never send money to anyone on this platform. If someone asks for money, block and report them immediately.
            </p>
          </div>
        </div>

        <div className="card p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-ink">Send us a message</h2>
          <ActionForm
            action="contactMessage"
            submitLabel="Send message"
            busyLabel="Sending…"
            className="mt-5 space-y-4"
            submitClassName="btn btn-gold w-full"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" name="name" required />
              <Field label="Phone (optional)" name="phone" type="tel" />
            </div>
            <Field label="Email" name="email" type="email" required />
            <Field label="Message" name="message" as="textarea" required placeholder="How can we help?" />
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
