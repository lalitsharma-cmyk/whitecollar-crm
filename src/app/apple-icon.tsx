import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const logoB64 = readFileSync(join(process.cwd(), "public/brand/wcr-logo.png")).toString("base64");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex",
          alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, #0b1a33 0%, #0f2347 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={`data:image/png;base64,${logoB64}`} width={140} height={140} />
      </div>
    ),
    { ...size }
  );
}
