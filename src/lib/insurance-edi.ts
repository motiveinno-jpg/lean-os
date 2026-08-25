/**
 * 4대보험 EDI 파일 생성기
 *
 * ⚠️ 폐기 예정 / 제출용 아님 (2026-07-23 P0).
 *   아래 generateInsuranceEDI 는 공식 규격이 아닌 자체 INI 텍스트([HEAD]/[RECORD]/[FOOT])를
 *   보험별 .txt 4개로 만든다. 국민건강보험 Web EDI 는 "4대보험 전체신청용 XLSX 1개"(정해진 열
 *   순서·코드값)만 받으므로 이 파일은 "허용되지 않은 확장자입니다"로 거부된다. 주민번호도 placeholder.
 *   → 어떤 화면에서도 이 함수 결과를 "제출용"으로 다운로드시키지 말 것. 취득/상실 패널은 이미 비활성화됨.
 *   정식 XLSX 규격(공식 예제 XLS 기준)으로 교체 예정 — 그 전까지 신규 배선 금지.
 *   공식 규격: https://edi.nhis.or.kr/webedi/file_sy/all_chuiduk.html (취득) / all_sangsil.html (상실)
 */

export type InsuranceType = 'national_pension' | 'health' | 'employment' | 'industrial_accident';
export type ReportType = 'acquisition' | 'loss'; // 취득/상실

interface EmployeeInsuranceData {
  name: string;
  residentNumber: string; // 주민등록번호 (masked: 000000-0******)
  joinDate?: string; // YYYYMMDD
  leaveDate?: string;
  monthlySalary: number;
  department?: string;
  position?: string;
  leaveReason?: string; // 상실사유코드
}

interface CompanyInsuranceData {
  companyName: string;
  businessNumber: string; // 사업자등록번호
  workplaceCode?: string; // 사업장관리번호
  representativeName: string;
  address?: string;
}

interface EDIResult {
  insuranceType: InsuranceType;
  reportType: ReportType;
  filename: string;
  content: string; // EDI formatted text
  employeeCount: number;
}

// Insurance type labels in Korean
export const INSURANCE_LABELS: Record<InsuranceType, string> = {
  national_pension: '국민연금',
  health: '건강보험',
  employment: '고용보험',
  industrial_accident: '산재보험',
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  acquisition: '취득신고',
  loss: '상실신고',
};

// Loss reason codes (상실사유)
export const LOSS_REASONS = [
  { code: '11', label: '자진퇴사' },
  { code: '12', label: '권고사직' },
  { code: '22', label: '해고' },
  { code: '23', label: '정년퇴직' },
  { code: '26', label: '계약기간 만료' },
  { code: '31', label: '사업장 이전' },
  { code: '32', label: '사업장 폐업' },
  { code: '41', label: '건강악화/부상' },
];
