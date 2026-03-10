/**
 * OwnerView HR Contract Package Engine
 * 계약 패키지 생성 → 변수 채움 → 이메일 발송 → 서명 → 급여/연차 자동 세팅
 */

import { supabase } from './supabase';
import { fillVariables } from './documents';
import { calculatePayroll } from './payment-batch';
import { calculateAnnualLeave, autoInitLeaveBalance } from './hr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export interface ContractPackage {
  id: string;
  company_id: string;
  employee_id: string;
  title: string;
  status: 'draft' | 'sent' | 'partially_signed' | 'completed' | 'cancelled';
  created_by: string;
  sent_at?: string;
  completed_at?: string;
  expires_at?: string;
  sign_token?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ContractPackageItem {
  id: string;
  package_id: string;
  document_id?: string;
  template_id?: string;
  title: string;
  sort_order: number;
  status: 'pending' | 'signed' | 'rejected';
  signed_at?: string;
  signature_data?: { type: string; data: string };
  created_at: string;
}

export const PACKAGE_STATUS = {
  draft: { label: '임시저장', bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
  sent: { label: '계약 진행 중', bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  partially_signed: { label: '서명 진행 중', bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  completed: { label: '계약완료', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
  cancelled: { label: '취소', bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
} as const;

// ── Contract Template Categories ──

export const CONTRACT_TEMPLATE_CATEGORIES = [
  { value: 'salary_contract', label: '연봉계약서' },
  { value: 'nda', label: '비밀유지서약서' },
  { value: 'non_compete', label: '겸업금지서약서' },
  { value: 'privacy_consent', label: '개인정보 동의서' },
  { value: 'comprehensive_labor', label: '포괄임금 근로계약서' },
] as const;

// ── Built-in HR Document Templates (fallback when DB is empty) ──

export interface BuiltInTemplate {
  id: string;
  name: string;
  category: 'employment' | 'consent' | 'pledge' | 'nda' | 'salary';
  body: string;
  required_variables: string[];
}

export function getBuiltInHRTemplates(): BuiltInTemplate[] {
  return [
    // ─── 1. 포괄임금 근로계약서 (13조) ───
    {
      id: 'builtin-employment-contract',
      name: '포괄임금 근로계약서',
      category: 'employment',
      required_variables: [
        'employee_name', 'resident_number', 'address', 'company_name',
        'representative_name', 'company_address', 'department', 'position',
        'start_date', 'end_date', 'salary_amount', 'base_pay', 'overtime_pay',
      ],
      body: `포괄임금 근로계약서

{{company_name}} (이하 "회사"라 한다)과 {{employee_name}} (이하 "근로자"라 한다)은 다음과 같이 근로계약을 체결한다.

제1조 (근로계약기간)
근로계약기간은 {{start_date}}부터 {{end_date}}까지로 한다. 다만, 계약기간 만료 1개월 전까지 쌍방 이의가 없는 경우 동일 조건으로 1년간 자동 갱신되는 것으로 한다.

제2조 (근무장소)
근로자의 근무장소는 {{company_address}} 소재 회사 사업장으로 한다. 회사는 업무상 필요에 따라 근무장소를 변경할 수 있으며, 이 경우 근로자와 사전에 협의한다.

제3조 (업무내용)
근로자는 {{department}} 소속 {{position}}으로서 회사가 지정하는 업무를 성실히 수행한다.

제4조 (근로시간)
① 근로시간은 1일 8시간, 주 40시간을 원칙으로 하며, 시업시각은 09:00, 종업시각은 18:00으로 한다.
② 휴게시간은 12:00~13:00(1시간)으로 하며, 근로시간에 산입하지 아니한다.
③ 업무상 필요에 따라 근로자의 동의를 얻어 연장·야간·휴일근로를 실시할 수 있다.

제5조 (임금 — 포괄임금제)
① 연간 총 급여(세전)는 금 {{salary_amount}}원으로 하고, 이를 12개월로 나누어 매월 지급한다.
② 월 급여의 구성은 다음과 같다.
  - 기본급: 금 {{base_pay}}원
  - 고정연장근로수당(월 20시간분): 금 {{overtime_pay}}원
③ 위 고정연장근로수당에는 연장·야간·휴일근로에 대한 가산수당이 포함되어 있으며, 실제 연장근로시간이 월 20시간을 초과하는 경우 그 초과분에 대하여는 근로기준법에 따라 별도 지급한다.

제6조 (임금지급일 및 방법)
① 임금은 매월 25일에 근로자가 지정한 금융기관 계좌로 이체하여 지급한다. 지급일이 휴일인 경우 그 전일에 지급한다.
② 국민연금, 건강보험, 고용보험, 소득세 등 법정 공제금액을 공제한 후 지급한다.

제7조 (휴일 및 휴가)
① 주휴일은 일요일로 하며, 관공서의 공휴일에 관한 규정에 따른 공휴일 및 대체공휴일을 유급휴일로 한다.
② 연차유급휴가는 근로기준법 제60조에 따라 부여하며, 입사 1년 미만인 경우 1개월 개근 시 1일의 유급휴가를 부여한다.
③ 기타 경조사 휴가, 병가 등은 회사 취업규칙에 따른다.

제8조 (사회보험)
회사는 근로자를 국민연금, 건강보험, 고용보험, 산업재해보상보험에 가입하며, 각 보험료는 관계 법령에 따라 회사와 근로자가 분담한다.

제9조 (퇴직급여)
① 회사는 근로자가 1년 이상 계속 근로한 후 퇴직하는 경우 근로자퇴직급여보장법에 따라 퇴직급여를 지급한다.
② 퇴직급여 제도는 퇴직금제도 또는 확정급여형 퇴직연금제도로 하며, 세부사항은 취업규칙에 따른다.

제10조 (비밀유지)
근로자는 재직 중은 물론 퇴직 후에도 업무상 취득한 회사의 영업비밀 및 기밀정보를 제3자에게 누설하거나 무단으로 사용하여서는 아니 된다.

제11조 (해고 및 퇴직)
① 회사는 근로기준법 제23조에 따라 정당한 사유 없이 근로자를 해고하지 아니한다.
② 근로자가 자발적으로 퇴직하고자 하는 경우 퇴직 예정일 30일 전까지 회사에 서면으로 통보하여야 한다.

제12조 (취업규칙 준수)
이 계약에 명시되지 아니한 사항은 근로기준법 및 회사 취업규칙에 따른다.

제13조 (계약서 작성)
이 계약의 성립을 증명하기 위하여 계약서 2부를 작성하고, 회사와 근로자가 각각 기명날인 또는 서명한 후 각 1부씩 보관한다.

{{start_date}}

(회사) {{company_name}}
대표이사 {{representative_name}} (인)
주소: {{company_address}}

(근로자) {{employee_name}} (서명)
주민등록번호: {{resident_number}}
주소: {{address}}`,
    },

    // ─── 2. 개인정보 수집·이용 동의서 ───
    {
      id: 'builtin-privacy-consent',
      name: '개인정보 수집·이용 동의서',
      category: 'consent',
      required_variables: ['employee_name', 'company_name', 'start_date'],
      body: `개인정보 수집·이용 동의서

{{company_name}} (이하 "회사"라 한다)은 「개인정보 보호법」 제15조 제1항 제1호 및 제17조 제1항 제1호에 따라 다음과 같이 개인정보의 수집·이용에 대하여 동의를 받고자 합니다.

1. 개인정보의 수집·이용 목적
  가. 인사관리(채용, 배치, 승진, 퇴직 등 인사 전반 관리)
  나. 급여 지급 및 4대 보험 처리
  다. 세무·회계 처리(원천징수, 연말정산 등)
  라. 복리후생 제공(건강검진, 사내대출, 경조사 지원 등)
  마. 비상연락 및 안전관리
  바. 교육·훈련 관리

2. 수집하는 개인정보의 항목
  가. 필수 항목: 성명, 주민등록번호, 주소, 연락처(전화번호, 이메일), 계좌정보(은행명, 계좌번호, 예금주), 학력, 경력, 자격사항
  나. 선택 항목: 가족관계, 비상연락처, 취미·특기, 차량번호, 장애여부
  다. 고유식별정보: 주민등록번호, 외국인등록번호 (4대 보험 및 세무처리 목적에 한하여 수집)

3. 개인정보의 보유 및 이용 기간
  가. 원칙: 근로관계 존속 기간 동안 보유·이용하며, 근로관계 종료 시 지체 없이 파기
  나. 예외: 관계 법령(근로기준법, 소득세법, 국세기본법 등)에 따라 보존이 필요한 경우 해당 법령에서 정한 기간 동안 보존
    - 근로자 명부 및 근로계약 관련 서류: 3년 (근로기준법 제42조)
    - 임금대장: 3년 (근로기준법 제48조)
    - 원천징수 관련 서류: 5년 (소득세법 제164조)

4. 동의를 거부할 권리 및 거부 시 불이익
  귀하는 위 개인정보 수집·이용에 대한 동의를 거부할 권리가 있습니다. 다만, 필수 항목에 대한 동의를 거부하시는 경우 급여 지급, 4대 보험 가입, 근로계약 체결 등 근로관계 유지에 필요한 업무 처리가 불가능할 수 있습니다.

5. 개인정보 제3자 제공
  회사는 수집한 개인정보를 다음의 경우에 제3자에게 제공할 수 있습니다.
  가. 국민연금공단, 국민건강보험공단, 근로복지공단, 한국고용정보원: 4대 보험 취득·상실 신고
  나. 관할 세무서: 원천징수 신고, 연말정산
  다. 금융기관: 급여 계좌이체

본인은 위 내용을 충분히 이해하였으며, 이에 동의합니다.

  □ 필수 항목 수집·이용에 동의합니다.
  □ 선택 항목 수집·이용에 동의합니다.
  □ 고유식별정보(주민등록번호) 수집·이용에 동의합니다.
  □ 개인정보 제3자 제공에 동의합니다.

{{start_date}}

동의자: {{employee_name}} (서명)`,
    },

    // ─── 3. 겸업금지서약서 ───
    {
      id: 'builtin-non-compete',
      name: '겸업금지서약서',
      category: 'pledge',
      required_variables: ['employee_name', 'company_name', 'start_date', 'department', 'position'],
      body: `겸업금지서약서

본인 {{employee_name}}은(는) {{company_name}} (이하 "회사"라 한다)에 {{department}} {{position}}(으)로 근무함에 있어, 다음 사항을 서약합니다.

제1조 (겸업금지)
본인은 회사에 재직하는 동안 회사의 사전 서면 동의 없이 다음 각 호의 행위를 하지 아니할 것을 서약합니다.
  1. 다른 회사, 단체 또는 개인사업자에 취업하거나 고용되는 행위
  2. 직접 또는 타인의 명의를 이용하여 영리사업을 영위하는 행위
  3. 회사의 사업과 경쟁관계에 있는 업종에 투자하거나 임직원으로 참여하는 행위
  4. 프리랜서, 컨설턴트, 자문 등의 명칭을 불문하고 대가를 수수하며 제3자에게 용역을 제공하는 행위

제2조 (사전 승인)
불가피하게 겸업이 필요한 경우, 본인은 사전에 회사에 서면으로 신청하여 승인을 받아야 합니다. 승인 시 겸업의 범위, 기간 등 조건을 준수하여야 하며, 회사는 근로 제공에 지장이 있다고 판단되는 경우 승인을 철회할 수 있습니다.

제3조 (전념의무)
본인은 재직 기간 동안 회사 업무에 전념하며, 직무수행에 지장을 초래하는 어떠한 외부 활동도 하지 아니할 것을 서약합니다.

제4조 (위반 시 책임)
① 본인이 이 서약을 위반한 경우 회사의 취업규칙 및 관계 법령에 따른 징계처분(경고, 감봉, 정직, 해고 등)을 받을 수 있음을 확인합니다.
② 위반 행위로 인하여 회사에 손해가 발생한 경우, 본인은 그 손해를 배상할 책임이 있음을 확인합니다.

제5조 (유효기간)
이 서약은 본인이 회사에 재직하는 기간 동안 유효합니다.

{{start_date}}

서약자
성명: {{employee_name}} (서명)
소속: {{company_name}} {{department}}
직급: {{position}}`,
    },

    // ─── 4. 비밀유지서약서 (NDA) ───
    {
      id: 'builtin-nda',
      name: '비밀유지서약서',
      category: 'nda',
      required_variables: ['employee_name', 'company_name', 'start_date', 'department', 'position'],
      body: `비밀유지서약서

본인 {{employee_name}}은(는) {{company_name}} (이하 "회사"라 한다)에 입사하여 근무함에 있어, 다음 사항을 준수할 것을 서약합니다.

제1조 (비밀정보의 정의)
이 서약에서 "비밀정보"란 회사가 보유하거나 관리하는 다음 각 호의 정보로서, 공공연히 알려져 있지 아니하고 독립된 경제적 가치를 가지는 것을 말합니다.
  1. 기술정보: 설계도, 소스코드, 알고리즘, 제조공정, 개발계획, 연구자료, 특허출원 전 발명 내용
  2. 영업정보: 고객명단, 거래처 정보, 가격정책, 매출·원가 정보, 영업전략, 마케팅 계획, 입찰 정보
  3. 경영정보: 인사정보, 급여체계, 재무제표(공시 전), 투자계획, M&A 정보, 이사회 결의사항
  4. 기타: 회사가 비밀로 지정하거나 관리하는 일체의 정보

제2조 (비밀유지 의무)
① 본인은 업무 수행 과정에서 취득하거나 접근한 비밀정보를 재직 중은 물론 퇴직 후에도 제3자에게 누설, 공개, 전달하지 아니합니다.
② 비밀정보를 업무 목적 외로 사용하거나, 무단으로 복사·복제·반출하지 아니합니다.
③ 비밀정보가 포함된 문서, 파일, 저장매체 등을 철저히 관리하며, 권한 없는 자의 접근을 차단합니다.

제3조 (비밀정보의 반환)
본인은 퇴직 시 또는 회사의 요구가 있을 때, 보유하고 있는 비밀정보(사본, 전자파일, 메모 포함)를 즉시 회사에 반환하거나 폐기하고, 그 사실을 서면으로 확인합니다.

제4조 (지적재산권)
① 본인이 재직 기간 동안 직무와 관련하여 창작하거나 발명한 모든 지적재산(소프트웨어, 디자인, 발명, 저작물 등)은 회사에 귀속됩니다.
② 본인은 위 지적재산에 대한 권리를 회사에 양도하는 데 필요한 일체의 절차에 협조합니다.

제5조 (의무 존속기간)
이 서약에 따른 비밀유지 의무는 퇴직일로부터 2년간 존속합니다. 다만, 부정경쟁방지 및 영업비밀보호에 관한 법률 등 관계 법령에 따른 의무는 별도로 적용됩니다.

제6조 (위반 시 책임)
① 본인이 이 서약을 위반한 경우, 회사는 취업규칙에 따른 징계 및 민·형사상 법적 조치를 취할 수 있음을 확인합니다.
② 위반으로 인하여 회사에 손해가 발생한 경우, 본인은 해당 손해를 전액 배상할 책임이 있습니다.

{{start_date}}

서약자
성명: {{employee_name}} (서명)
소속: {{company_name}} {{department}}
직급: {{position}}`,
    },

    // ─── 5. 연봉계약서 ───
    {
      id: 'builtin-salary-contract',
      name: '연봉계약서',
      category: 'salary',
      required_variables: [
        'employee_name', 'company_name', 'representative_name',
        'start_date', 'end_date', 'salary_amount', 'department', 'position',
      ],
      body: `연봉계약서

{{company_name}} (이하 "회사"라 한다)과 아래 근로자(이하 "근로자"라 한다)는 {{start_date}}부터 {{end_date}}까지의 연봉에 관하여 다음과 같이 계약을 체결한다.

근로자 정보
  성명: {{employee_name}}
  소속: {{department}}
  직급: {{position}}

제1조 (연봉)
① 회사는 근로자에게 연간 총 금 {{salary_amount}}원(세전)을 지급한다.
② 위 연봉에는 기본급 및 법정수당(연장·야간·휴일근로수당)이 포함되어 있다.

제2조 (지급방법)
① 연봉을 12개월로 균등 분할하여 매월 25일에 지급한다.
② 지급일이 토요일 또는 공휴일인 경우 그 전일에 지급한다.
③ 급여에서 다음 각 호의 금액을 공제한 후 지급한다.
  1. 국민연금 보험료(근로자 부담분)
  2. 건강보험료 및 장기요양보험료(근로자 부담분)
  3. 고용보험료(근로자 부담분)
  4. 소득세 및 지방소득세

제3조 (연봉 조정)
① 연봉은 매년 회사의 경영실적, 근로자의 업무성과, 근속연수 등을 종합적으로 고려하여 조정할 수 있다.
② 연봉 조정 시 회사와 근로자는 별도의 연봉계약서를 체결한다.

제4조 (성과급)
회사는 경영실적 및 개인성과에 따라 연봉과 별도로 성과급(인센티브)을 지급할 수 있다. 성과급의 지급 기준, 시기 및 방법은 회사의 성과급 지급 규정에 따른다.

제5조 (퇴직급여)
퇴직급여는 연봉에 포함하지 아니하며, 근로자퇴직급여보장법에 따라 별도로 지급한다.

제6조 (비밀유지)
근로자는 본 계약의 내용(연봉 금액 등)을 다른 임직원 또는 제3자에게 공개하지 아니한다.

제7조 (기타)
본 계약에 명시되지 아니한 사항은 근로기준법, 취업규칙 및 회사 규정에 따른다.

위 계약을 증명하기 위하여 본 계약서 2부를 작성하고, 쌍방이 서명 또는 기명날인한 후 각 1부씩 보관한다.

{{start_date}}

(회사) {{company_name}}
대표이사 {{representative_name}} (인)

(근로자) {{employee_name}} (서명)`,
    },
  ];
}

// ── Build Contract Variables from Employee + Company Data ──

export async function buildContractVariables(
  companyId: string,
  employeeId: string,
  overrides?: Record<string, string>,
): Promise<Record<string, string>> {
  // Get employee data
  const { data: employee } = await db
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .single();

  if (!employee) throw new Error('직원 정보를 찾을 수 없습니다');

  // Get company data
  const { data: company } = await db
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();

  if (!company) throw new Error('회사 정보를 찾을 수 없습니다');

  // Calculate payroll deductions
  const monthlySalary = Math.round(Number(employee.salary || 0) / 12);
  const payroll = monthlySalary > 0 ? calculatePayroll(monthlySalary, employee.name, employeeId) : null;

  // Comprehensive labor: calculate base + OT split (roughly 83% base, 17% OT for 20hr/mo)
  const basePay = Math.round(monthlySalary * 0.83);
  const otPay = monthlySalary - basePay;

  const fmt = (n: number) => n.toLocaleString('ko-KR');

  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const nextYearStr = nextYear.toISOString().slice(0, 10);

  const vars: Record<string, string> = {
    // Employee
    직원명: employee.name || '',
    주민등록번호: employee.resident_number || '______-_______',
    부서: employee.department || '',
    직급: employee.position || '',
    입사일: employee.hire_date || today,

    // Company
    회사명: company.name || '',
    대표자명: company.representative || company.ceo_name || '',

    // Contract period
    계약시작일: employee.hire_date || today,
    계약종료일: nextYearStr,

    // Salary
    연봉: fmt(Number(employee.salary || 0)),
    월급여: fmt(monthlySalary),

    // Comprehensive labor splits
    기본급: fmt(basePay),
    고정연장근로수당: fmt(otPay),

    // Deductions
    국민연금_공제: fmt(payroll?.nationalPension || 0),
    건강보험_공제: fmt(payroll?.healthInsurance || 0),
    고용보험_공제: fmt(payroll?.employmentInsurance || 0),
    소득세_공제: fmt((payroll?.incomeTax || 0) + (payroll?.localIncomeTax || 0)),
    실수령액: fmt(payroll?.netPay || 0),
  };

  // Apply overrides
  if (overrides) {
    Object.assign(vars, overrides);
  }

  return vars;
}

// ── Create Contract Package ──

export async function createContractPackage(params: {
  companyId: string;
  employeeId: string;
  title: string;
  templateIds: string[];
  createdBy: string;
  variableOverrides?: Record<string, string>;
  notes?: string;
}): Promise<{ package: ContractPackage; items: ContractPackageItem[] }> {
  const { companyId, employeeId, title, templateIds, createdBy, variableOverrides, notes } = params;

  // Generate sign token
  const signToken = crypto.randomUUID() + '-' + crypto.randomUUID();

  // Create package
  const { data: pkg, error: pkgError } = await db
    .from('hr_contract_packages')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      title,
      status: 'draft',
      created_by: createdBy,
      sign_token: signToken,
      notes: notes || null,
    })
    .select()
    .single();

  if (pkgError) throw pkgError;

  // Build variables
  const variables = await buildContractVariables(companyId, employeeId, variableOverrides);

  // Save salary metadata for reliable extraction on signing
  const annualSalary = Number(variables.연봉?.replace(/,/g, '') || 0);
  if (annualSalary > 0) {
    await db.from('hr_contract_packages').update({
      notes: JSON.stringify({ ...(notes ? { text: notes } : {}), salary: annualSalary }),
    }).eq('id', pkg.id);
  }

  // Create items: one per template
  const items: ContractPackageItem[] = [];

  for (let i = 0; i < templateIds.length; i++) {
    const templateId = templateIds[i];

    // Get template from DB first, then fall back to built-in templates
    const { data: dbTemplate } = await db
      .from('doc_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    let template = dbTemplate;

    if (!template) {
      // Check built-in templates as fallback
      const builtIn = getBuiltInHRTemplates().find((t) => t.id === templateId);
      if (builtIn) {
        template = {
          id: builtIn.id,
          name: builtIn.name,
          category: builtIn.category,
          content_json: { body: builtIn.body },
          required_variables: builtIn.required_variables,
          is_builtin: true,
        };
      }
    }

    if (!template) continue;

    // Fill variables in template content
    const filledContent = fillVariables(template.content_json as Record<string, any>, variables);

    // Create document from template
    const { data: doc, error: docError } = await db
      .from('documents')
      .insert({
        company_id: companyId,
        template_id: templateId,
        name: `${variables.직원명} - ${template.name}`,
        status: 'draft',
        content_json: filledContent,
        version: 1,
        created_by: createdBy,
      })
      .select()
      .single();

    if (docError) throw docError;

    // Create package item
    const { data: item, error: itemError } = await db
      .from('hr_contract_package_items')
      .insert({
        package_id: pkg.id,
        document_id: doc.id,
        template_id: templateId,
        title: template.name,
        sort_order: i,
        status: 'pending',
      })
      .select()
      .single();

    if (itemError) throw itemError;
    items.push(item);
  }

  return { package: pkg, items };
}

// ── Send Contract Package (email) ──

export async function sendContractPackage(
  packageId: string,
  baseUrl?: string,
): Promise<{ success: boolean; error?: string }> {
  // Get package with employee info
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('*, employees(name, email)')
    .eq('id', packageId)
    .single();

  if (!pkg) throw new Error('계약 패키지를 찾을 수 없습니다');
  if (!pkg.employees?.email) throw new Error('직원 이메일이 등록되지 않았습니다');

  // Get company name
  const { data: company } = await db
    .from('companies')
    .select('name')
    .eq('id', pkg.company_id)
    .single();

  // Get items count
  const { count } = await db
    .from('hr_contract_package_items')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId);

  // Build sign URL
  const signUrl = `${baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://owner-view.com'}/sign?token=${pkg.sign_token}`;

  // Set expiration (14 days from now)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14);

  // Call Edge Function to send email
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('인증 세션이 없습니다');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-contract-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        to: pkg.employees.email,
        employeeName: pkg.employees.name,
        companyName: company?.name || '',
        packageTitle: pkg.title,
        documentCount: count || 0,
        signUrl,
        expiresAt: expiresAt.toISOString(),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`이메일 발송 실패: ${err}`);
    }
  } catch (e: any) {
    // Update status but note the email failure
    await db.from('hr_contract_packages').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      notes: (pkg.notes ? pkg.notes + '\n' : '') + `이메일 발송 실패: ${e.message}`,
    }).eq('id', packageId);

    return { success: false, error: e.message };
  }

  // Update package status
  await db.from('hr_contract_packages').update({
    status: 'sent',
    sent_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
  }).eq('id', packageId);

  return { success: true };
}

// ── Get Package by Sign Token (for external signing page) ──

export async function getPackageByToken(token: string) {
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('*, employees(name, email, department, position)')
    .eq('sign_token', token)
    .single();

  if (!pkg) return null;

  // Check expiration
  if (pkg.expires_at && new Date(pkg.expires_at) < new Date()) {
    return { ...pkg, expired: true, items: [] };
  }

  // Get items with document content
  const { data: items } = await db
    .from('hr_contract_package_items')
    .select('*, documents(name, content_json, status)')
    .eq('package_id', pkg.id)
    .order('sort_order');

  return { ...pkg, expired: false, items: items || [] };
}

// ── Sign a Contract Item ──

export async function signContractItem(
  itemId: string,
  signatureData: { type: 'draw' | 'type' | 'upload'; data: string },
  ipAddress?: string,
): Promise<{ allSigned: boolean }> {
  // Update item
  const { data: item, error } = await db
    .from('hr_contract_package_items')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signature_data: { ...signatureData, ip: ipAddress || null },
    })
    .eq('id', itemId)
    .select('package_id, document_id')
    .single();

  if (error) throw error;

  // Lock the associated document
  if (item?.document_id) {
    await db.from('documents').update({
      status: 'locked',
      locked_at: new Date().toISOString(),
    }).eq('id', item.document_id);
  }

  // Check if all items in the package are signed
  const { data: allItems } = await db
    .from('hr_contract_package_items')
    .select('id, status')
    .eq('package_id', item.package_id);

  const allSigned = (allItems || []).every((i: any) => i.status === 'signed');
  const someSigned = (allItems || []).some((i: any) => i.status === 'signed');

  if (allSigned) {
    // Complete the package
    await db.from('hr_contract_packages').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', item.package_id);

    // Trigger post-signing actions
    await onAllContractsSigned(item.package_id);
  } else if (someSigned) {
    await db.from('hr_contract_packages').update({
      status: 'partially_signed',
    }).eq('id', item.package_id);
  }

  return { allSigned };
}

// ── Post-signing: Update salary + leave balance ──

async function onAllContractsSigned(packageId: string) {
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('company_id, employee_id, notes')
    .eq('id', packageId)
    .single();

  if (!pkg) return;

  // Try to extract salary from metadata (stored at package creation)
  let annualSalary = 0;
  try {
    const meta = typeof pkg.notes === 'string' ? JSON.parse(pkg.notes) : pkg.notes;
    if (meta?.salary) annualSalary = Number(meta.salary);
  } catch { /* not JSON, try regex fallback */ }

  // Regex fallback: extract salary from document content
  if (annualSalary === 0) {
    const { data: items } = await db
      .from('hr_contract_package_items')
      .select('document_id, title')
      .eq('package_id', packageId);

    for (const item of (items || [])) {
      if (!item.document_id) continue;
      const isSalaryContract = item.title.includes('연봉') || item.title.includes('포괄임금');
      if (!isSalaryContract) continue;

      const { data: doc } = await db
        .from('documents')
        .select('content_json')
        .eq('id', item.document_id)
        .single();
      if (!doc?.content_json) continue;

      const content = JSON.stringify(doc.content_json);
      const salaryMatch = content.match(/연간 총 금\s*([\d,]+)/) || content.match(/연봉[^\d]*([\d,]+)/);
      if (salaryMatch) {
        annualSalary = Number(salaryMatch[1].replace(/,/g, ''));
        if (annualSalary > 0) break;
      }
    }
  }

  if (annualSalary > 0) {
    const monthlySalary = Math.round(annualSalary / 12);

    // Update employee salary
    await db.from('employees').update({
      salary: monthlySalary,
    }).eq('id', pkg.employee_id);

    // Add salary history
    await db.from('salary_history').insert({
      company_id: pkg.company_id,
      employee_id: pkg.employee_id,
      effective_date: new Date().toISOString().slice(0, 10),
      salary: monthlySalary,
      change_reason: '연봉계약 체결',
    });

    // Create employee_contracts record
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    await db.from('employee_contracts').insert({
      company_id: pkg.company_id,
      employee_id: pkg.employee_id,
      contract_type: 'full_time',
      start_date: new Date().toISOString().slice(0, 10),
      end_date: nextYear.toISOString().slice(0, 10),
      salary: monthlySalary,
      status: 'active',
    });
  }

  // Update employee status to active (onboarding complete)
  await db.from('employees').update({ status: 'active' }).eq('id', pkg.employee_id);

  // Auto-init leave balance for current year
  const { data: employee } = await db
    .from('employees')
    .select('hire_date')
    .eq('id', pkg.employee_id)
    .single();

  if (employee?.hire_date) {
    const year = new Date().getFullYear();
    await autoInitLeaveBalance(pkg.company_id, pkg.employee_id, employee.hire_date, year);
  }
}

// ── Get Contract Packages List ──

export async function getContractPackages(companyId: string, status?: string) {
  let query = db
    .from('hr_contract_packages')
    .select('*, employees(name, department, position)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data } = await query;
  return data || [];
}

// ── Get Package with Items ──

export async function getContractPackageWithItems(packageId: string) {
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('*, employees(name, email, department, position)')
    .eq('id', packageId)
    .single();

  if (!pkg) return null;

  const { data: items } = await db
    .from('hr_contract_package_items')
    .select('*, documents(name, content_json, status)')
    .eq('package_id', packageId)
    .order('sort_order');

  return { ...pkg, items: items || [] };
}

// ── Cancel Package ──

export async function cancelContractPackage(packageId: string) {
  await db.from('hr_contract_packages').update({
    status: 'cancelled',
    updated_at: new Date().toISOString(),
  }).eq('id', packageId);
}

// ── Get Contract Templates ──

export async function getContractTemplates(companyId: string) {
  const { data } = await db
    .from('doc_templates')
    .select('*')
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .in('category', ['salary_contract', 'nda', 'non_compete', 'privacy_consent', 'comprehensive_labor', 'contract_labor'])
    .eq('is_active', true)
    .order('name');

  // Fall back to built-in templates when DB has no templates
  if (!data || data.length === 0) {
    return getBuiltInHRTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      content_json: { body: t.body },
      required_variables: t.required_variables,
      is_active: true,
      is_builtin: true,
      company_id: null,
    }));
  }

  return data;
}

// ── Resend Contract Email ──

export async function resendContractEmail(packageId: string, baseUrl?: string) {
  return sendContractPackage(packageId, baseUrl);
}
