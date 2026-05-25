"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, Check } from "lucide-react";

interface Props {
  initialPhotoUrl: string | null;
  avatarColor: string;
  initials: string;
}

const MAX_DIM = 400;          // resize to max 400×400px
const MAX_BYTES = 500_000;    // ~500KB hard cap on the resulting dataURL

/**
 * Profile photo uploader. We do the resize CLIENT-SIDE before upload because:
 *  1. The server doesn't have S3 / file storage configured (yet)
 *  2. Storing tiny base64 dataURLs in Postgres is fine for a 6-person team
 *  3. Avoids unnecessary bandwidth — a phone-camera 4MB shot becomes ~80KB
 */
export default function ProfilePhotoEditor({ initialPhotoUrl, avatarColor, initials }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(initialPhotoUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { setMsg("Pick an image file"); return; }
    setBusy(true); setMsg(null);
    try {
      const dataUrl = await resizeImage(f);
      if (dataUrl.length > MAX_BYTES) {
        setMsg("Image too big even after resizing — try a smaller photo");
        return;
      }
      setPreview(dataUrl);
      await save(dataUrl);
    } catch (err) {
      setMsg(`Failed: ${String(err).slice(0, 60)}`);
    } finally { setBusy(false); }
  }

  async function save(dataUrl: string | null) {
    const r = await fetch("/api/profile/photo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrl: dataUrl }),
    });
    if (r.ok) { setMsg("✓ Saved"); router.refresh(); setTimeout(() => setMsg(null), 2000); }
    else { setMsg("Save failed"); }
  }

  async function remove() {
    if (busy) return;
    setBusy(true); setPreview(null);
    await save(null);
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Avatar preview — falls back to initials chip if no photo */}
      <div className="relative">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Profile" className="w-32 h-32 rounded-full object-cover border-4 border-[#c9a24b]" />
        ) : (
          <div className={`w-32 h-32 rounded-full ${avatarColor} flex items-center justify-center text-white text-4xl font-bold border-4 border-[#e5e7eb]`}>
            {initials}
          </div>
        )}
      </div>

      <div className="flex gap-2 w-full">
        <label className="btn btn-primary text-xs flex-1 justify-center cursor-pointer">
          <Upload className="w-3 h-3" /> {busy ? "Uploading…" : preview ? "Change" : "Upload photo"}
          <input type="file" accept="image/*" onChange={onPick} disabled={busy} className="hidden" />
        </label>
        {preview && (
          <button onClick={remove} disabled={busy} className="btn btn-ghost text-xs"><Trash2 className="w-3 h-3" /></button>
        )}
      </div>

      {msg && (
        <div className={`text-[11px] ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-700"} flex items-center gap-1`}>
          {msg.startsWith("✓") && <Check className="w-3 h-3" />} {msg}
        </div>
      )}
      <p className="text-[10px] text-gray-500 text-center">Max 5MB · resized to 400×400 automatically. Stored privately in the CRM.</p>
    </div>
  );
}

/** Read file → draw to canvas at <=MAX_DIM → re-encode as JPEG dataURL */
async function resizeImage(file: File): Promise<string> {
  if (file.size > 5_000_000) throw new Error("File over 5MB — pick a smaller image");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}
