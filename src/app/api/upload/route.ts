import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_SIZE = 4 * 1024 * 1024; // 4 MB
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function uploadsDir() {
  const dir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await getCurrentUser();
    if (!viewer) {
      return NextResponse.json({ ok: false, message: "Please login first." }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("photo");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "No photo received." });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ ok: false, message: "Photo must be smaller than 4 MB." });
    }
    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ ok: false, message: "Please upload a JPG, PNG or WebP photo." });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const dir = uploadsDir();
    const filename = `u${viewer.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(dir, filename), bytes);

    // Remove previous photo file from disk if it lives in /uploads/
    const prev = (await db.select({ url: profiles.profilePhotoUrl }).from(profiles).where(eq(profiles.userId, viewer.id)).limit(1))[0];
    if (prev?.url && prev.url.startsWith("/uploads/")) {
      const oldPath = path.join(process.cwd(), "public", prev.url.replace(/^\/+/, ""));
      if (fs.existsSync(oldPath) && oldPath.startsWith(path.join(process.cwd(), "public", "uploads"))) {
        fs.rmSync(oldPath, { force: true });
      }
    }

    const url = `/uploads/${filename}`;
    await db.update(profiles).set({ profilePhotoUrl: url, updatedAt: new Date() }).where(eq(profiles.userId, viewer.id));

    return NextResponse.json({ ok: true, message: "Photo uploaded.", url });
  } catch (error) {
    console.error("[Panika Jeevan Sathi] Upload error:", error);
    return NextResponse.json({ ok: false, message: "Upload failed. Please try again." });
  }
}
