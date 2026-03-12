const XLSX = require("xlsx");
const wb = XLSX.readFile("/Users/motive/Downloads/대표님 보고자료_모티브 통합_2026년_ver12.xlsx");

// Read key data from multiple sheets

// 1. 자금예산현황 (2) - Monthly cashflow forecast
console.log("\n=== 자금예산현황 SUMMARY ===");
const ws1 = wb.Sheets["▶자금예산현황 (2)"];
const d1 = XLSX.utils.sheet_to_json(ws1, {header:1, defval:""});
// Row 29=header, 30-44=data
const cfHeaders = d1[29]; // 월별, "", 26.01월, 26.02월, ...
console.log("Headers:", JSON.stringify(cfHeaders.slice(0,15)));
for (let i = 30; i <= 44; i++) {
  const row = d1[i];
  if (row && row[0]) {
    console.log(row[0] + ": 1월=" + row[2] + " 2월=" + row[3] + " 3월=" + row[4]);
  }
}

// 2. 현금시제기준_26.02월 - Current month cash position
console.log("\n=== 현금시제 26.02월 SUMMARY ===");
const ws2 = wb.Sheets["▶현금시제기준_26.02월"];
const d2 = XLSX.utils.sheet_to_json(ws2, {header:1, defval:""});
// Find total income/expense/balance
for (let i = 0; i < d2.length; i++) {
  const row = d2[i];
  if (row && row[1] && typeof row[1] === "string") {
    if (row[1].includes("총 입금") || row[1].includes("총 지출") || row[1].includes("현금시제잔액")) {
      console.log("Row " + i + ": " + row[1] + " = " + row[9]);
    }
  }
}

// 3. 고정비용 - Fixed costs detail
console.log("\n=== 고정비용 MONTHLY SUMMARY ===");
const ws3 = wb.Sheets["▶고정비용"];
const d3 = XLSX.utils.sheet_to_json(ws3, {header:1, defval:""});
// Find monthly totals (bottom rows)
for (let i = 85; i < 96; i++) {
  const row = d3[i];
  if (row && (row[3] || row[4])) {
    console.log("Row " + i + ": " + JSON.stringify([row[3], row[4], row[5], row[7], row[11]].map(String).slice(0,5)));
  }
}

// 4. 급여 sheet - Salary detail
console.log("\n=== 급여 SUMMARY ===");
const ws4 = wb.Sheets["급여"];
const d4 = XLSX.utils.sheet_to_json(ws4, {header:1, defval:""});
// First 20 rows
for (let i = 0; i < 20; i++) {
  const row = d4[i];
  if (row) {
    const cleaned = row.slice(0, 10).filter(c => c !== "");
    if (cleaned.length > 0) console.log("Row " + i + ": " + JSON.stringify(cleaned));
  }
}

// 5. 실적보고서 - 2026 revenue data
console.log("\n=== 실적보고서 KEY METRICS ===");
const ws5 = wb.Sheets["▶실적보고서"];
const d5 = XLSX.utils.sheet_to_json(ws5, {header:1, defval:""});
for (let i = 5; i < 17; i++) {
  const row = d5[i];
  if (row && row[1]) {
    console.log(row[1] + ": " + row[2]);
  }
}

// 6. 퇴직금
console.log("\n=== 퇴직금 ===");
const ws6 = wb.Sheets["퇴직금"];
const d6 = XLSX.utils.sheet_to_json(ws6, {header:1, defval:""});
for (let i = 0; i < 20; i++) {
  const row = d6[i];
  if (row) {
    const cleaned = row.slice(0, 8).filter(c => c !== "");
    if (cleaned.length > 0) console.log("Row " + i + ": " + JSON.stringify(cleaned));
  }
}

// 7. Sheet1 (summary?)
console.log("\n=== Sheet1 ===");
const ws7 = wb.Sheets["Sheet1"];
const d7 = XLSX.utils.sheet_to_json(ws7, {header:1, defval:""});
for (let i = 0; i < 42; i++) {
  const row = d7[i];
  if (row) {
    const cleaned = row.slice(0, 17).filter(c => c !== "");
    if (cleaned.length > 0) console.log("Row " + i + ": " + JSON.stringify(cleaned));
  }
}
