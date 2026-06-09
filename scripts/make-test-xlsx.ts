// Generate a realistic messy HR candidate Excel for QA: row 1 = merged section
// titles, row 2 = real field headers, rows 3+ = data (incl. a phone-only row).
import * as XLSX from "xlsx";
const aoa = [
  ["CANDIDATE ID", "BASIC INFORMATION", "", "", "", "F2F INTERVIEW", "HR EVALUATION", "SALES ASSESSMENT", "HR DECISION", "FINAL", "", "", ""],
  ["ID", "Candidate Name", "Mobile Number", "WhatsApp Number", "City", "Current Company", "Current Profile", "Total Experience", "Current CTC", "Expected CTC", "Notice Period", "Source", "Status", "HR Remarks"],
  ["1", "QA Test Alpha", "9000000001", "9000000001", "Delhi", "Acme Corp", "Sales Executive", "3 years", "30000", "45000", "30 days", "Naukri", "New", "QA test row alpha"],
  ["2", "QA Test Beta", "9000000002", "", "Mumbai", "Beta Ltd", "BDM", "5 years", "50000", "70000", "60 days", "LinkedIn", "Interested", "QA test row beta"],
  ["3", "", "9000000003", "", "Pune", "Gamma Inc", "BDE", "2 years", "25000", "35000", "Immediate", "Referral", "New", "QA phone-only row"],
];
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Candidates");
XLSX.writeFile(wb, "C:/Users/Lenovo/whitecollar-crm/qa-test-candidates.xlsx");
console.log("wrote qa-test-candidates.xlsx (3 data rows; header row = row 2)");
