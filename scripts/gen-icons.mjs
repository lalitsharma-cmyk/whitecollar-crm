// One-off icon generator for PWA. Produces:
//   public/icon-192.png  (Android home screen)
//   public/icon-512.png  (Android splash)
//   public/icon-maskable-512.png  (Android adaptive, safe zone)
//
// Run: node scripts/gen-icons.mjs

import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "public");
mkdirSync(outDir, { recursive: true });

// Standard icon — full bleed, gold W on navy
function svg(size, opts = {}) {
  const { maskable = false } = opts;
  // For maskable, content must fit in safe zone (80% of canvas)
  const cx = size / 2, cy = size / 2;
  const inner = maskable ? size * 0.66 : size * 0.9;
  const fontSize = inner * 0.72;
  const tagSize = size * 0.06;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0b1a33"/>
        <stop offset="100%" stop-color="#152d57"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
    <text x="${cx}" y="${cy + fontSize * 0.04}" font-family="system-ui,-apple-system,sans-serif"
          font-size="${fontSize}" font-weight="900" fill="#c9a24b" text-anchor="middle" dominant-baseline="middle">W</text>
    ${maskable ? "" : `<text x="${cx}" y="${cy + fontSize * 0.55}" font-family="system-ui,-apple-system,sans-serif"
          font-size="${tagSize}" font-weight="700" fill="#ffffff" opacity="0.85" text-anchor="middle"
          letter-spacing="${tagSize * 0.18}">REALTY · CRM</text>`}
  </svg>`;
}

async function emit(name, size, opts) {
  const buf = Buffer.from(svg(size, opts));
  const png = await sharp(buf).png().toBuffer();
  writeFileSync(join(outDir, name), png);
  console.log(`  ✓ ${name}  ${png.length} bytes  ${size}x${size}`);
}

await emit("icon-192.png", 192);
await emit("icon-512.png", 512);
await emit("icon-maskable-512.png", 512, { maskable: true });
await emit("og-image.png", 1200);
console.log("\n✅ PWA icons generated in public/");
