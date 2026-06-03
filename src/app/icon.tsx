import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const logoB64 = readFileSync(join(process.cwd(), "public/brand/wcr-logo.png")).toString("base64");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex",
          alignItems: "center", justifyContent: "center",
          background: "#0b1a33", borderRadius: 6,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={`data:image/png;base64,${logoB64}`} width={24} height={24} />
      </div>
    ),
    { ...size }
  );
}
