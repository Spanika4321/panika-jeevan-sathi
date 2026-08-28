import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-p flex flex-col items-center py-24 text-center">
      <p className="font-display text-7xl font-semibold text-brand-200">404</p>
      <h1 className="mt-4 font-display text-2xl font-semibold text-ink">This page wandered off</h1>
      <p className="mt-2 max-w-md text-sm text-[#5c6b62]">
        The profile may have been removed, or the link is incorrect. Let&apos;s get you back to safe ground.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn btn-primary">
          Go home
        </Link>
        <Link href="/find-matches" className="btn btn-outline">
          Browse profiles
        </Link>
      </div>
    </div>
  );
}
