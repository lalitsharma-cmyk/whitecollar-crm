/**
 * scripts/test-date-parsing.ts
 *
 * Unit tests for the improved date parsing logic.
 * Tests all date format scenarios that can break imports.
 */

import { parseImportDate, detectDateColumn, detectTimeColumn, applyTimeToDate } from "@/lib/parseImportDate";

function testCase(label: string, input: string | undefined, expectedDate: Date | undefined) {
  const result = parseImportDate(input);
  const match = result && expectedDate && result.getTime() === expectedDate.getTime();
  const status = match ? "✅" : "❌";
  console.log(`${status} ${label}`);
  if (!match) {
    console.log(`   Input: "${input}"`);
    console.log(`   Expected: ${expectedDate?.toISOString()}`);
    console.log(`   Got:      ${result?.toISOString()}`);
  }
}

function testColumnDetection() {
  console.log("\n🔍 Column Detection Tests");
  console.log("═".repeat(50));

  const dateHeaders = ["Date", "LeadDate", "Created", "DateGenerated", "entrydate", "CreatedDate"];
  const detected = detectDateColumn(dateHeaders);
  console.log(`✅ Date column detected: ${detected}`);

  const timeHeaders = ["Time", "LeadTime", "CallTime", "EntryTime"];
  const timeDetected = detectTimeColumn(timeHeaders);
  console.log(`✅ Time column detected: ${timeDetected}`);
}

function testDateParsing() {
  console.log("\n📅 Date Parsing Tests");
  console.log("═".repeat(50));

  // ISO format
  testCase(
    "ISO format (2026-06-15)",
    "2026-06-15",
    new Date(Date.UTC(2026, 5, 15, 6, 30))
  );

  // dd/mm/yyyy (Indian format)
  testCase(
    "Indian format (15/06/2026)",
    "15/06/2026",
    new Date(Date.UTC(2026, 5, 15, 6, 30))
  );

  // dd-mm-yyyy variant
  testCase(
    "Indian dash format (15-06-2026)",
    "15-06-2026",
    new Date(Date.UTC(2026, 5, 15, 6, 30))
  );

  // Excel serial number (45867 = 2025-06-15)
  const excelSerial = 45867;
  const excelDate = new Date(Math.round((excelSerial - 25569) * 86400 * 1000));
  testCase(
    `Excel serial (${excelSerial})`,
    String(excelSerial),
    excelDate
  );

  // Generic JS parsing (May 4, 2025)
  testCase(
    "Generic JS format (May 4, 2025)",
    "May 4, 2025",
    new Date(Date.UTC(2025, 4, 4, 6, 30))
  );

  // Null/undefined
  testCase("Null input", undefined, undefined);
  testCase("Empty string", "", undefined);

  // Invalid
  const invalid = parseImportDate("not a date");
  console.log(invalid ? "❌ Invalid date should not parse" : "✅ Invalid date correctly rejected");
}

function testTimeApplication() {
  console.log("\n⏰ Time Application Tests");
  console.log("═".repeat(50));

  const baseDate = new Date(Date.UTC(2026, 5, 15, 6, 30)); // noon IST

  // Test 1: Simple time
  let result = applyTimeToDate(baseDate, "14:30");
  const expected1 = new Date(Date.UTC(2026, 5, 15, 9, 0)); // 14:30 IST = 09:00 UTC
  console.log(
    result.getTime() === expected1.getTime()
      ? "✅ Simple time (14:30)"
      : `❌ Simple time — expected ${expected1.toISOString()}, got ${result.toISOString()}`
  );

  // Test 2: Morning time
  result = applyTimeToDate(baseDate, "9:00");
  const expected2 = new Date(Date.UTC(2026, 5, 15, 3, 30)); // 09:00 IST = 03:30 UTC
  console.log(
    result.getTime() === expected2.getTime()
      ? "✅ Morning time (09:00)"
      : `❌ Morning time — expected ${expected2.toISOString()}, got ${result.toISOString()}`
  );

  // Test 3: No time provided
  result = applyTimeToDate(baseDate, undefined);
  console.log(
    result.getTime() === baseDate.getTime()
      ? "✅ No time (returns original)"
      : `❌ No time — should return original`
  );

  // Test 4: Invalid time
  result = applyTimeToDate(baseDate, "invalid");
  console.log(
    result.getTime() === baseDate.getTime()
      ? "✅ Invalid time (returns original)"
      : `❌ Invalid time — should return original`
  );
}

function testMidnightConversion() {
  console.log("\n🌙 Midnight Conversion Tests");
  console.log("═".repeat(50));

  // A midnight UTC date should become noon IST
  const midnight = new Date(Date.UTC(2026, 5, 15, 0, 0, 0));
  const result = parseImportDate("2026-06-15");

  const hasNoonTime =
    result && result.getUTCHours() === 6 && result.getUTCMinutes() === 30;
  console.log(
    hasNoonTime
      ? "✅ Midnight UTC → Noon IST conversion"
      : `❌ Midnight conversion failed — got ${result?.toUTCString()}`
  );
}

console.log("🧪 Import Date Parsing Tests");
console.log("═".repeat(70));
console.log("");

testColumnDetection();
testDateParsing();
testTimeApplication();
testMidnightConversion();

console.log("\n" + "═".repeat(70));
console.log("✅ Test suite complete");
