import { fmtIST, toISTLocalInput, fromISTLocalInput } from "../src/lib/datetime";

const utc = new Date("2026-05-26T06:45:00Z");
console.log("UTC input:        ", utc.toISOString());
console.log("fmtIST(utc):      ", fmtIST(utc));
console.log("Expected:         ", "26 May 2026, 12:15");
console.log();

const now = new Date();
console.log("Now UTC:          ", now.toISOString());
console.log("fmtIST(now):      ", fmtIST(now));
console.log("toISTLocalInput:  ", toISTLocalInput(now));

// Round-trip
const round = fromISTLocalInput(toISTLocalInput(now));
console.log("Round-trip ms diff:", round ? (round.getTime() - now.getTime()) : "null");
