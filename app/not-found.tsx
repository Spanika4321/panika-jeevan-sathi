import Link from "next/link";
import { Home, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-display text-6xl font-extrabold text-brand-500">404</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-navy-900">Page nahi mila</h1>
      <p className="mt-2 text-sm text-slate-600">
        The page you are looking for doesn&rsquo;t exist or has moved.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Home className="h-4 w-4" aria-hidden />
          Go home
        </Link>
        <Link
          href="/search"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-navy-900 hover:bg-slate-50"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search services
        </Link>
      </div>
    </div>
  );
}
