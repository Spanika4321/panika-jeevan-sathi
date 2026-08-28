import Link from "next/link";
import type { Metadata } from "next";
import { PageSearchParams, pageParam } from "@/lib/utils";
import { ActionForm, FormAlert } from "@/components/client-forms";
import { Field } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Login" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;
  const error = pageParam(params, "error");
  const returnTo = pageParam(params, "returnTo") ?? "";

  return (
    <div className="container-p flex flex-col items-center py-14 lg:py-20">
      <div className="w-full max-w-md">
        <div className="text-center">
          <span className="eyebrow">Member login</span>
          <h1 className="section-title">Welcome back</h1>
          <p className="section-sub mt-3 !mx-auto">Log in to your 100% free PANIKA JEEVAN SATHI account.</p>
        </div>

        <div className="card mt-8 p-6 sm:p-8">
          {error && <FormAlert kind="error">{error}</FormAlert>}
          <ActionForm
            action="login"
            payload={{ returnTo }}
            submitLabel="Login"
            busyLabel="Logging in…"
            className="space-y-4"
            submitClassName="btn btn-primary btn-lg w-full"
          >
            <Field label="Email address" name="email" type="email" placeholder="you@example.com" required />
            <Field label="Password" name="password" type="password" placeholder="Your password" required />
          </ActionForm>

          <div className="mt-6 border-t border-[#f0ece1] pt-5 text-center text-sm text-[#5c6b62]">
            New here?{" "}
            <Link href="/register" className="font-bold text-brand-700 hover:underline">
              Create a free profile
            </Link>{" "}
            — it takes 2 minutes.
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-[#7c8a81]">
          Trouble logging in? Message us on WhatsApp: +91 8099834725
        </p>
      </div>
    </div>
  );
}
