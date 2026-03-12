/**
 * 4대보험 EDI 파일 생성기
 * 취득신고서/상실신고서를 EDI 파일로 자동 생성
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

/**
 * Generate 4대보험 EDI report files
 */
export function generateInsuranceEDI(params: {
  company: CompanyInsuranceData;
  employees: EmployeeInsuranceData[];
  reportType: ReportType;
  reportDate: string; // YYYYMMDD
}): EDIResult[] {
  const { company, employees, reportType, reportDate } = params;
  const results: EDIResult[] = [];
  const insuranceTypes: InsuranceType[] = ['national_pension', 'health', 'employment', 'industrial_accident'];

  for (const type of insuranceTypes) {
    const lines: string[] = [];

    // Header
    lines.push(`[HEAD]`);
    lines.push(`보고구분=${REPORT_TYPE_LABELS[reportType]}`);
    lines.push(`보험종류=${INSURANCE_LABELS[type]}`);
    lines.push(`사업장명=${company.companyName}`);
    lines.push(`사업자번호=${company.businessNumber}`);
    lines.push(`사업장관리번호=${company.workplaceCode || ''}`);
    lines.push(`대표자명=${company.representativeName}`);
    lines.push(`신고일자=${reportDate}`);
    lines.push(`신고인원=${employees.length}`);
    lines.push(``);

    // Employee records
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      lines.push(`[RECORD_${String(i + 1).padStart(3, '0')}]`);
      lines.push(`성명=${emp.name}`);
      lines.push(`주민등록번호=${emp.residentNumber}`);

      if (reportType === 'acquisition') {
        lines.push(`취득일=${emp.joinDate || ''}`);
        lines.push(`월보수액=${emp.monthlySalary}`);
        // Insurance-specific rates
        if (type === 'national_pension') {
          lines.push(`기준소득월액=${Math.min(Math.max(emp.monthlySalary, 370000), 5900000)}`);
          lines.push(`연금보험료율=9.0`);
        } else if (type === 'health') {
          lines.push(`보수월액=${emp.monthlySalary}`);
          lines.push(`건강보험료율=7.09`);
          lines.push(`장기요양보험료율=0.9182`);
        } else if (type === 'employment') {
          lines.push(`월평균보수=${emp.monthlySalary}`);
          lines.push(`고용보험료율_근로자=0.9`);
          lines.push(`고용보험료율_사업주=1.15`);
        } else if (type === 'industrial_accident') {
          lines.push(`월평균보수=${emp.monthlySalary}`);
          lines.push(`산재보험료율=업종별`);
        }
      } else {
        lines.push(`상실일=${emp.leaveDate || ''}`);
        lines.push(`상실사유=${emp.leaveReason || '11'}`);
        if (type === 'employment') {
          lines.push(`이직확인서_발급여부=Y`);
          lines.push(`퇴직전3개월보수총액=${emp.monthlySalary * 3}`);
        }
      }

      lines.push(`부서=${emp.department || ''}`);
      lines.push(`직위=${emp.position || ''}`);
      lines.push(``);
    }

    // Footer
    lines.push(`[FOOT]`);
    lines.push(`총인원=${employees.length}`);
    lines.push(`생성일시=${new Date().toISOString()}`);

    const typeCode = { national_pension: 'NP', health: 'HI', employment: 'EI', industrial_accident: 'IA' }[type];
    const reportCode = reportType === 'acquisition' ? 'ACQ' : 'LOSS';

    results.push({
      insuranceType: type,
      reportType,
      filename: `${reportCode}_${typeCode}_${company.businessNumber}_${reportDate}.edi`,
      content: lines.join('\n'),
      employeeCount: employees.length,
    });
  }

  return results;
}

/**
 * Download EDI files as a zip or individual files
 */
export function downloadEDIFile(result: EDIResult) {
  const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
