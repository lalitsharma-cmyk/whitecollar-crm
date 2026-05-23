// PWA icon generator — uses the real White Collar Realty logo
// Composites the brand logo onto a navy gradient background for each size.
// Run: node scripts/gen-icons.mjs

import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "public");
mkdirSync(outDir, { recursive: true });

const LOGO = readFileSync(join(process.cwd(), "public/brand/wcr-logo.png"));

function bgSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0b1a33"/>
        <stop offset="100%" stop-color="#152d57"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
  </svg>`;
}

async function emit(name, size, opts = {}) {
  const { padPct = 0.18 } = opts;
  const pad = Math.round(size * padPct);
  const logoSize = size - pad * 2;
  // Render the logo at the desired inner size (white-on-transparent original works fine)
  const logoBuf = await sharp(LOGO).resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const bg = await sharp(Buffer.from(bgSvg(size))).png().toBuffer();
  const composited = await sharp(bg).composite([{ input: logoBuf, top: pad, left: pad }]).png().toBuffer();
  writeFileSync(join(outDir, name), composited);
  console.log(`  ✓ ${name}  ${composited.length} bytes  ${size}x${size}`);
}

// Standard icons: small padding, logo fills nicely
await emit("icon-192.png", 192, { padPct: 0.14 });
await emit("icon-512.png", 512, { padPct: 0.14 });
// Maskable: 20% safe-zone padding on each side per spec
await emit("icon-maskable-512.png", 512, { padPct: 0.22 });
// OG image (social preview)
await emit("og-image.png", 1200, { padPct: 0.30 });
console.log("\n✅ PWA icons regenerated using real brand logo");
