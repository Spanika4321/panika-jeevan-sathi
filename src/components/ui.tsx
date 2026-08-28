import Link from "next/link";
import { clsx, initials } from "@/lib/utils";

export function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} width={size} height={size} className={clsx("avatar", className)} loading="lazy" />
    );
  }
  return (
    <span
      className={clsx("avatar", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800",
        className,
      )}
      title="Identity verified by our team"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.4 3.98a.65.65 0 0 0-1.02-.52l-6.4 5.1a.65.65 0 0 1-.85 0l-1.9-1.51a.65.65 0 0 0-.9.98l1.9 1.5c.63.5 1.48.56 2.17.16l6.99-5.58a.65.65 0 0 0 .01-.63Z"
          clipRule="evenodd"
        />
        <path d="M10 2 3.5 4.5v4.6c0 4.3 2.8 8.3 6.5 9.9 3.7-1.6 6.5-5.6 6.5-9.9V4.5L10 2Z" opacity="0.25" />
      </svg>
      Verified
    </span>
  );
}

export function MatchBadge({ percent }: { percent: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-gold-500 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm"
      title={`Approximate compatibility ${percent}%`}
    >
      {percent}% Match
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  sub,
  center,
  action,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  center?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={clsx("mb-9 flex flex-wrap items-end justify-between gap-4", center && "flex-col items-center text-center")}>
      <div className={clsx(center && "flex flex-col items-center")}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 className="section-title">{title}</h2>
        {sub && <p className={clsx("section-sub mt-3", center && "mx-auto")}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = "📭", title, sub, action }: { icon?: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="text-5xl" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mt-4 font-display text-xl font-semibold text-ink">{title}</h3>
      {sub && <p className="mt-2 max-w-md text-sm leading-relaxed text-[#5c6b62]">{sub}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, icon }: { label: string; value: string | number; icon?: string }) {
  return (
    <div className="card flex items-center gap-3.5 px-5 py-4">
      {icon && (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-100 text-xl" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-2xl font-extrabold text-ink">{value}</p>
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-[#7c8a81]">{label}</p>
      </div>
    </div>
  );
}

export function Field({
  label,
  name,
  type = "text",
  placeholder,
  required,
  hint,
  defaultValue,
  as,
  inputProps,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  defaultValue?: string | number;
  as?: "textarea" | "input" | "select";
  /** Extra native input attributes (min, max, step, list, …). */
  inputProps?: Record<string, string | number | undefined>;
}) {
  const el = as === "textarea" ? (
    <textarea name={name} placeholder={placeholder} required={required} defaultValue={defaultValue} className="textarea" />
  ) : (
    <input name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} className="input" {...inputProps} />
  );
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {el}
      {hint && <p className="mt-1.5 text-xs text-[#7c8a81]">{hint}</p>}
    </div>
  );
}

export function SelectField({
  label,
  name,
  options,
  placeholder = "Any",
  required,
  defaultValue,
}: {
  label: string;
  name: string;
  options: ReadonlyArray<string | { value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <select id={name} name={name} className="select" required={required} defaultValue={defaultValue ?? ""}>
        <option value="">{placeholder}</option>
        {options.map((opt) => {
          const value = typeof opt === "string" ? opt : opt.value;
          const text = typeof opt === "string" ? opt : opt.label;
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export function CardAction({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={clsx("btn btn-sm", className)}>
      {children}
    </Link>
  );
}
