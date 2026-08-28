"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { applyResult, fetchAction, uploadPhoto, type ActionResult } from "@/lib/client";
import { clsx } from "@/lib/utils";

export function FormAlert({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      className={clsx(
        "flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold",
        kind === "error" && "bg-rose-50 text-rose-700",
        kind === "success" && "bg-brand-50 text-brand-800",
        kind === "info" && "bg-gold-50 text-gold-800",
      )}
      role={kind === "error" ? "alert" : "status"}
    >
      <span aria-hidden="true">{kind === "error" ? "⚠️" : kind === "success" ? "✅" : "ℹ️"}</span>
      <span>{children}</span>
    </p>
  );
}

type ActionFormProps = {
  action: string;
  /** Static values always sent with the request (e.g. IDs). */
  payload?: Record<string, string>;
  /** When true, the whole form navigates on success without extra handling. */
  redirectOnSuccess?: boolean;
  onSuccess?: (result: ActionResult) => void;
  submitLabel?: string;
  busyLabel?: string;
  submitClassName?: string;
  children?: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** When set, asks for confirmation before submitting (destructive actions). */
  confirmText?: string;
};

/**
 * Client-side form that posts to /api/actions and handles the JSON result
 * (redirect, success notice or inline error) without a page reload.
 */
export function ActionForm({
  action,
  payload = {},
  redirectOnSuccess = false,
  onSuccess,
  submitLabel = "Submit",
  busyLabel,
  submitClassName = "btn btn-primary",
  children,
  className,
  resetOnSuccess = true,
  confirmText,
}: ActionFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const form = event.currentTarget;
    const data: Record<string, string | Blob> = { ...payload };
    for (const [key, value] of new FormData(form).entries()) {
      if (!(key in data)) data[key] = value as string | Blob;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await fetchAction(action, data);

    if (result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }

    if (result.ok) {
      if (redirectOnSuccess) {
        window.location.assign("/");
        return;
      }
      setNotice(result.message);
      if (resetOnSuccess) form.reset();
      onSuccess?.(result);
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={handleSubmit} className={className} noValidate={false}>
      {Object.entries(payload).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {children}
      <div className="mt-4 space-y-3">
        <FormAlert kind="error">{error}</FormAlert>
        <FormAlert kind="success">{notice}</FormAlert>
        <button type="submit" disabled={busy} className={submitClassName}>
          {busy ? busyLabel ?? `${submitLabel}…` : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Profile photo uploader: pick an image, POST it to /api/upload,
 * then stash the returned URL into a hidden input + preview.
 */
export function PhotoUploadField({ currentUrl }: { currentUrl?: string | null }) {
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onFileChange(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await uploadPhoto(file);
    setBusy(false);

    if (result.ok && result.data?.url) {
      setPreview(result.data.url);
      setNotice("Photo uploaded. Remember to save your profile.");
      const form = input.form;
      if (form) {
        let hidden = form.querySelector<HTMLInputElement>('input[name="profilePhotoUrl"]');
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = "profilePhotoUrl";
          form.append(hidden);
        }
        hidden.value = result.data.url;
      }
    } else {
      setError(result.message);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-5">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Profile preview" className="h-28 w-28 rounded-2xl border border-[#e8e4d8] object-cover" />
      ) : (
        <div className="grid h-28 w-28 place-items-center rounded-2xl border-2 border-dashed border-[#d8d2c2] text-3xl" aria-hidden="true">
          📷
        </div>
      )}
      <div className="min-w-[220px] flex-1 space-y-3">
        <label className="btn btn-outline btn-sm cursor-pointer">
          {busy ? "Uploading…" : "Choose photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
            disabled={busy}
            className="sr-only"
          />
        </label>
        {currentUrl && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={(e) => {
              const form = (e.currentTarget as HTMLButtonElement).form;
              const checkbox = form?.querySelector<HTMLInputElement>('input[name="deletePhoto"]');
              if (checkbox) checkbox.checked = true;
              setPreview(null);
              setNotice("The photo will be removed when you save.");
            }}
          >
            Remove current photo
          </button>
        )}
        <p className="text-xs text-[#7c8a81]">JPG, PNG or WebP • up to 4 MB</p>
        <FormAlert kind="error">{error}</FormAlert>
        <FormAlert kind="success">{notice}</FormAlert>
      </div>
    </div>
  );
}
