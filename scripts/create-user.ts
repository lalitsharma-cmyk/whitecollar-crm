// Create a NEW CRM user with a strong generated password (printed once).
//   npx tsx scripts/create-user.ts <email> <name> <role> [team]
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const [email, name, role, team] = [process.argv[2]?.trim().toLowerCase(), process.argv[3], (process.argv[4] ?? "ADMIN").toUpperCase(), process.argv[5] ?? null];
if (!email || !name) { console.error("Usage: tsx scripts/create-user.ts <email> <name> <role> [team]"); process.exit(1); }
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
function strongPassword(): string {
  const U="ABCDEFGHJKLMNPQRSTUVWXYZ",L="abcdefghijkmnpqrstuvwxyz",D="23456789",S="!@#$%&*?";
  const pick=(s:string)=>s[randomInt(s.length)]; const all=U+L+D;
  const c=[pick(U),pick(L),pick(D),pick(S),pick(U),pick(L),pick(D),pick(L),pick(U),pick(D)];
  while(c.length<12)c.push(pick(all));
  for(let i=c.length-1;i>0;i--){const j=randomInt(i+1);[c[i],c[j]]=[c[j],c[i]];}
  const p=c.join(""); return `${p.slice(0,4)}-${p.slice(4,8)}-${p.slice(8)}`;
}
async function main(){
  const existing = await prisma.user.findUnique({ where:{ email } });
  if (existing) { console.error(`❌ A user with ${email} already exists (${existing.name}). Use set-user-password.ts to reset.`); process.exit(1); }
  const password = strongPassword();
  const hash = await bcrypt.hash(password, 10);
  const u = await prisma.user.create({ data: { email, name, role: role as any, team: team ?? undefined, active: true, passwordHash: hash, isSuperAdmin: false } });
  console.log(`\n✅ Created: ${u.name} · ${u.role}${u.team?" · "+u.team:""} · active${u.isSuperAdmin?" · SUPER-ADMIN":""}`);
  console.log(`   ───────────────────────────────────────────`);
  console.log(`   Login URL:  https://crm.whitecollarrealty.com/login`);
  console.log(`   Email:      ${email}`);
  console.log(`   Password:   ${password}`);
  console.log(`   ───────────────────────────────────────────`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
