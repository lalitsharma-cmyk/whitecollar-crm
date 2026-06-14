// Print a wcr_session cookie value for the admin user (uses NEXTAUTH_SECRET from .env)
import { PrismaClient } from "@prisma/client";
const enc = new TextEncoder();
function b64(b: Uint8Array){let s=Buffer.from(b).toString("base64");return s.replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");}
async function hm(k: string,m: string){const key=await crypto.subtle.importKey("raw",enc.encode(k),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(m)));}
(async()=>{
  const secret = process.env.NEXTAUTH_SECRET!;
  const p = new PrismaClient();
  const argId = process.argv[2];
  const u = argId
    ? await p.user.findUnique({ where: { id: argId } })
    : await p.user.findFirst({ where: { role: "ADMIN" } });
  if (!u) { console.error("no user"); process.exit(1); }
  const payload = { uid: u.id, exp: Math.floor(Date.now()/1000)+3600 };
  const pb = b64(enc.encode(JSON.stringify(payload)));
  const sb = b64(await hm(secret, pb));
  process.stdout.write(pb+"."+sb);
  await p.$disconnect();
})();
