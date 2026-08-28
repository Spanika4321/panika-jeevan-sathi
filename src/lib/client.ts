export type ActionResult = {
  ok: boolean;
  message: string;
  redirectTo?: string;
  data?: { url?: string };
};

export async function fetchAction(action: string, payload: Record<string, string | Blob>): Promise<ActionResult> {
  const form = new FormData();
  form.set("action", action);
  for (const [key, value] of Object.entries(payload)) {
    if (value === "" || value === null) continue;
    form.set(key, value);
  }

  try {
    const res = await fetch("/api/actions", { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as ActionResult | null;
    if (!data) return { ok: false, message: "Something went wrong. Please try again." };
    return data;
  } catch {
    return { ok: false, message: "Network error. Please check your connection and try again." };
  }
}

/**
 * Central result handler for action forms:
 * - redirectTo present  → navigate there
 * - ok === true         → success (onSuccess, or silent)
 * - ok === false        → show error message
 */
export function applyResult(
  result: ActionResult,
  handlers: { onSuccess?: (message: string) => void; onError: (message: string) => void },
) {
  if (result.redirectTo) {
    window.location.assign(result.redirectTo);
    return;
  }
  if (result.ok) {
    if (handlers.onSuccess) handlers.onSuccess(result.message);
  } else {
    handlers.onError(result.message);
  }
}

export async function uploadPhoto(file: File): Promise<ActionResult> {
  const form = new FormData();
  form.set("photo", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as ActionResult | null;
    if (!data) return { ok: false, message: "Upload failed. Please try again." };
    return data;
  } catch {
    return { ok: false, message: "Upload failed. Please check your connection." };
  }
}
