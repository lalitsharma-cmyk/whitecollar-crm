// One-time: testingMode is now just the wipe guard → turn OFF (clears the banner).
// Make every automation flag explicitly OFF (durable + visible). Notifications fire
// regardless now. Reversible from Settings → Automation Controls.
import { setSetting, getSetting, AUTOMATION_KEYS } from "../src/lib/settings";
async function main() {
  await setSetting("testingMode.enabled", "false");
  await setSetting("roundRobin.enabled", "false");
  for (const k of AUTOMATION_KEYS) await setSetting(k, "false");
  const keys = ["testingMode.enabled", "roundRobin.enabled", ...AUTOMATION_KEYS];
  console.log("Settings after update:");
  for (const k of keys) console.log(`  ${k} = ${await getSetting(k)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
