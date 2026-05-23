import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, #0b1a33 0%, #0f2347 100%)",
          color: "#c9a24b",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ fontSize: 110, fontWeight: 900, lineHeight: 1 }}>W</div>
        <div style={{ fontSize: 14, letterSpacing: 4, marginTop: 6, color: "#fff", opacity: 0.85, fontWeight: 700 }}>
          REALTY · CRM
        </div>
      </div>
    ),
    { ...size }
  );
}
