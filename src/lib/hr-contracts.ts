/**
 * OwnerView HR Contract Package Engine
 * 계약 패키지 생성 → 변수 채움 → 이메일 발송 → 서명 → 급여/연차 자동 세팅
 */

import { supabase } from './supabase';
import { fillVariables } from './documents';
import { calculatePayroll } from './payment-batch';
import { calculateAnnualLeave, autoInitLeaveBalance } from './hr';
import { logAuditTrail } from '@/lib/audit-trail';
import { generatePackageHash, storeDocumentHash } from '@/lib/document-integrity';

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
    // ─── 1. 포괄임금 근로계약서 (14조) ───
    {
      id: 'builtin-employment-contract',
      name: '포괄임금 근로계약서',
      category: 'employment',
      required_variables: [
        'employee_name', 'start_date', 'probation_start', 'probation_end',
        'probation_pay_rate', 'position', 'salary_amount', 'contract_date', 'birth_date',
      ],
      body: `근로계약서

(주)모티브이노베이션 (이하 'A')와(과) {{employee_name}} (이하 'B')은(는) 다음과 같이 근로계약을 체결하고, 이를 성실히 준수할 것을 약속하며 서명날인합니다.


제1조 [ 근로계약기간 ]
계약기간은 {{start_date}} 부터 근로계약을 체결한 것으로 본다(단, 3개월간은 수습기간으로 한다).

제2조 [ 수습평가 ]
① 'B'의 수습기간은 {{probation_start}} 부터 {{probation_end}} 까지 3개월로 본다.
② 계약체결일로부터 최초 3개월 간은 근무적합성 등 판단하기 위해 수습기간으로 보고, 급여지급률은 {{probation_pay_rate}} 이다.
③ 수습기간 중 또는 기간 만료 시 근무태도 및 업무능력 등에 대한 인사평가를 통해 부적격하다고 판단될 경우, 본 채용을 취소되거나 수습기간이 연장 될 수 있다.
④ 수습기간 종료 후 당사자간의 명시적인 이견이 없는 경우에는 별도의 계약체결이 없더라도 최초 계약체결일로부터 근로계약을 체결한 것으로 간주한다.

제3조 [ 준수의무 ]
① 'B'는 'A'의 피고용인으로서 품위를 지키며 'A'의 제반규칙을 준수하여야 한다.
② 'B'는 최선을 다하여 'A'의 업무지시에 응하며 본 계약에 의하여 부과된 업무를 성실히 수행하여야 한다.
③ 'B'는 계약기간동안 'A'의 사전동의나 요구가 없는 한 다른 업무에도 직접 또는 간접으로 종사하지 못하며, 어떠한 영업행위나 거래도 할 수 없다.
④ 'B'는 계약기간 중 또는 계약기간 종료 후 업무수행과 관련하여 알게 된 어떠한 정보라도 타인 또는 타 기관에 누설하여서는 안된다.
⑤ 'B'의 업무수행 중 나온 결과물은 'A'에게 귀속되며, 소유권은 'A'에게 있다.
⑥ 'B'는 본 계약 내용 및 관련된 사항을 타인에게 누설하여서는 안된다.

제4조 [ 근로장소 및 업무 ]
① 'B'의 근로장소는 회사 사무실 내이며, {{position}} 업무를 수행한다.
② 'A'는 업무 필요 시 근로장소와 주요업무를 변경할 수 있고 'B'는 이에 동의한다.

제5조 [ 근로시간 및 휴게 ]
① 'B'의 근로시간은 1일 8시간, 주 40시간이며 아래와 같이 시차근무제를 원칙으로 하여 운영된다.
     - 근무시간 1 : 출근시간 오전 09시 30분 / 퇴근시간 오후 18시 30분
     - 근무시간 2 : 출근시간 오전 10시 / 퇴근시간 오후 19시
     - 휴게시간 : 오후 12시 30분 ~ 13시 30분
② 업무사정에 따라 변경 가능하며, 회사 내에서 휴식을 원칙으로 한다.
③ 'B'는 업무상 필요에 따라 연장/휴일/야간근로를 할 수 있고 이에 동의한다.

제6조 [ 근로일 및 휴일 ]
'B'의 근로일은 월·화·수·목·금요일이며, 주휴일은 토, 일요일로 한다.

제7조 [ 임금 및 포괄임금산정제 ]
① 근로자의 임금은 업무의 특성과 계산의 편의성을 감안하여 기본급, 식대, 야간근무, 휴일근무 등 모두 포함되어 책정한 포괄임금제로 운영한다.
② 'A'는 'B'에게 입금 지급 시 소득세, 사회보험 등 관계법령에 따른 금액을 원천징수를 한 후 그 차액을 지급한다.
③ 'B'의 급여는 매월 1일부터 말일까지 산정하여 매월 마지막일에 'B' 명의의 계좌로 지급한다.
④ 'B'가 신규 입사자 및 퇴사자 혹은 재직자의 결근이 발생하는 경우에는 일할 계산하여 지급한다.
⑤ 'B'의 {{pay_basis}}은 퇴직금을 별도로 하여 {{salary_amount}} 이며, 구성항목은 다음과 같다.

* 월 통상임금 산정 209시간 기준
※별도작성 '연봉계약서' 참조

제8조 [ 연차휴가 ]
연차유급휴가는 '근로기준법'의 정함에 따르며, 그 외 사항은 '취업규칙'등에 의한다.

제9조 [ 퇴직 등 ]
① 'B'는 퇴사 시 최소한 30일 전에 사전 통보하고 퇴직 승인을 득한 후에 퇴직하도록 한다. 다만, 'A'는 정당한 사유 없이 퇴직 수리를 거부 할 수 없다.
② 'B'는 퇴직의 수리와 동시에 관련 업무인수, 인계를 철저히 하여 업무의 연속성을 보장하여야 하며 부득이 기일을 경과한 경우 퇴직 후에도 일정한 기간 동안 업무의 처리를 인계하여야 한다.
    단, 연장 인계 처리 동안에는 'A'는 정상적인 급여를 'B'에게 지급하도록 하며, 퇴직 당월의 사회보험 납부에 책임을 지지 않는다.
③ 'A'과 'B'사이의 본 계약이 해지되었을 때에는 만 1년 이상 근무한 경우에 한해 퇴사일로부터 역산한 3개월 급여총액 기준으로 아래와 같이 퇴직금 산정식으로 지급한다.
    - 급여총액 = 퇴사일로부터 역산한 3개월 평균 급여액
    - 평균임금 = 급여총액 / 근무일수
    - 퇴직급여 = (평균임금*근속일수*30일) / 365일
    * 평균임금 계산시 근무일수는 3개월 기간(90일) 기준임
    * 퇴직급여 계산시 근속일수는 퇴사일까지 근무한 일수임
④ 'B'가 고의로 인수인계를 게을리하거나 기타 불성실 인수인계가 이루어진 경우 'A'는 30일치의 급여를 공제한 잔액을 지급하며 'B'의 업무인수 인계의 성실 이행과 동시에 잔액을 지급한다.

제10조 [ 계약해지 ]
'A'는 'B'가 다음 사항 중 하나에 해당할 경우 30일전에 사전통보하고 본 계약을 해지하거나 또는 재계약체결을 거부할 수 있다.
① 제3조의 의무를 위반하였을 경우
② 계약기간 도중 'B'의 업무처리가 고의적으로 'A'에게 해를 끼칠 경우
③ 'A'의 정당한 업무명령을 거부한 경우 일정한 소명의 기회를 부여한 후 그럼에도 시정이 되지 아니할 시
④ 'B'의 근무태만 등의 사유로 업무실적이 현저하게 저조하다고 판단되는 경우
⑤ 'B'가 질병 등 기타의 사유로 본 계약상의 의무를 성실히 수행할 수 없다고 판단되는 경우
⑥ 'B'가 계속하여 3일 이상 무단 결근한 경우
⑦ 회사업무와 관련하여 청탁을 받고 재물을 수령한 경우
⑧ 전과사실이 있거나 신체 및 정신상의 이상 등으로 직무를 수행할 수 없는 경우
⑨ 학력, 경력 등에 대한 허위사실이 발견될 경우
⑩ 'A'의 사정에 의하여 담당직무가 소멸하거나 기타의 사유로 계속 고용의 필요성이 없을 경우

제11조 [ 비밀유지 및 손해배상 ]
① 'B'는 계약기간 및 계약 종료 후에도 계약기간 얻은 'A'의 영업비밀, 고객정보 및 기타 'A'가 비밀로 취급하는 모든 정보를 'A'의 사전 서면동의 없이 누설하거나 'A' 이외의 자를 위하여 사용하여서는 아니된다.
② 'B'는 'A'의 영업비밀누설, 명예훼손 등 피해 시 'A'에게 일체의 손해를 배상하고, 민·형사상 책임을 진다.
③ 'B'가 본 계약 위반 및 귀책사유로 인해 계약기간 중 또는 계약해지 후 'A'에게 손해를 입힌 경우 모든 손해를 배상하여야 하며, 'A'를 면책시키고 모든 민·형사상 법적 책임을 진다.

제12조 [ 재해보상 ]
'B'가 업무상 재해 시 산업재해보상보험법에 따른다. 업무 외 사유로 재해 시 'A'는 책임지지 않는다.

제13조 [ 기타 ]
'B'는 위 계약서의 내용을 충분히 숙지하여 사본을 교부 받았고, 본 계약서에 정하지 않은 사항은 '근로기준법' 및 사규에 따르며, 상기 초과근무실시, 포괄임금제에 대한 동의여부는 아래 'B'의 성명란의 서명으로 갈음한다.

제14조 [ 연봉 미공개의 의무 ]
※별도작성 '비밀유지서약서' 참조
'B'는 연봉액수를 포함, 계약에 관한 모든 내용을 타인에게 알려서는 아니되며, 알려질 경우 징계 조치한다.


{{contract_date}}
회사명(A)
(주)모티브이노베이션
생년월일(B)
{{birth_date}}

직위/성명(A)
대표 / 채희웅
성명(B)
{{employee_name}}

서명(인)
{{company_seal}}
서명(인)
{{employee_seal}}`,
    },

    // ─── 2. 개인정보 수집·이용에 관한 동의서 ───
    {
      id: 'builtin-privacy-consent',
      name: '개인정보 수집·이용에 관한 동의서',
      category: 'consent',
      required_variables: ['employee_name', 'contract_date', 'birth_date'],
      body: `개인정보 수집 · 이용에 관한 동의서

1. {{employee_name}}은(는) (주)모티브이노베이션 의 근로자로서 인사관리상 개인정보의 수집·이용이 필요하다는 것을 이해하고 있고 다음과 같은 개인정보·민감정보·고유식별정보를 수집·이용하는 것에 동의합니다.

[개인정보의 항목]
가. 성명
나. 증명사진, 주소, 이메일, 연락처
다. 학력, 근무경력, 자격증
라. 기타 근무와 관련된 개인정보

[수집·이용 목적]
가. 채용 및 승진 등 인사관리
나. 세법, 노동관계법령 등에서 부과하는 의무이행

[보유기간]
재직기간 동안 보유하고, 기타 개별법령에서 보유기간을 정하고 있는 경우 그에 따름


[민감정보의 항목]
가. 신체장애
나. 병력
다. 범죄정보
라. 보훈대상여부

[수집·이용 목적]
가. 채용 및 승진 등 인사관리
나. 세법, 노동관계법령 등에서 부과하는 의무이행
다. 정부지원금 신청

[보유기간]
재직기간 동안 보유하고, 기타 개별법령에서 보유기간을 정하고 있는 경우 그에 따름


[고유식별정보]
가. 주민등록번호
나. 운전면허번호
다. 여권번호
라. 외국인등록번호

[수집·이용 목적]
가. 채용 및 승진 등 인사관리
나. 세법, 노동관계법령 등에서 부과하는 의무이행
다. 정부지원금 신청

[보유기간]
재직기간동안 보유하고, 기타 개별법령에서 보유기간을 정하고 있는 경우 그에 따름


2. {{employee_name}}은(는) (주)모티브이노베이션이(가) 취득한 개인정보를 재직기간 동안 내부적으로 채용·승진 등 인사관리에 이용하고, 외부적으로 법령에 따라 관계기관 및 회사의 세무 및 노무관리(4대보험, 급여 등) 대행업체에 수집, 작성, 변경, 제출, 전달 등의 조치에 제공하는 것에 동의합니다.

3. (주)모티브이노베이션은(는) 취득한 개인정보를 수집한 목적에 필요한 범위에서 적합하게 처리하고 그 목적 외의 용도로 사용하지 않으며, 개인정보를 제공한 당사자는 언제나 자신이 입력한 개인정보를 열람·수정 및 정보제공에 대한 철회를 할 수 있습니다.

4. 본인은 1~3항에 따라 수집되는 개인정보의 항목과 개인정보의 수집·이용에 대한 거부를 할 수 있는 권리가 있다는 사실을 충분히 설명받고 숙지하였으며, 미동의시 적법하게 시행되는 의 규정 및 법령에 따라 발생하는 불이익에 대한 책임은 본인에게 있음을 확인합니다.


{{contract_date}}
회사명    (주)모티브이노베이션    생년월일    {{birth_date}}
직위/성명    대표 / 채희웅    성명    {{employee_name}}
서명(인)    {{company_seal}}    서명(인)    {{employee_seal}}`,
    },

    // ─── 3. 겸업금지서약서 ───
    {
      id: 'builtin-non-compete',
      name: '겸업금지서약서',
      category: 'pledge',
      required_variables: ['employee_name', 'contract_date', 'birth_date'],
      body: `겸업금지서약서

{{employee_name}} (이하 '본인')은(는) (주)모티브이노베이션 (이하 '회사')에 입사함에 있어 다음과 같이 서약합니다.

서약사항

회사 및/또는 본인이 보유하고 있는 기술 또는 새로이 취득할 기술, 회사의 업무에 종사하는 과정에서 또는 그와 관련하여 알게 되거나 생성한 기술상 또는 영업상의 정보(고객정보 또는 협력업체에 관한 정보 포함), know-how, 네트워크, 기타 자료(이하 통틀어 "영업비밀")의 전부 또는 일부를 제3자에게 이전 또는 양도하거나 회사업무 이외의 목적으로 이용하지 않고,
회사 및/또는 본인이 보유하고 있는 기술 및 향후 회사 및/또는 본인이 개발(외부기관에 의뢰하여 개발하는 경우를 포함한다)하거나 도입하는 기술의 전부 또는 일부에 관한 사업에 대하여 새로운 회사를 설립하여 사업을 영위하거나 회사가 경영하는 사업에 직접 또는 간접적으로 중대한 영향을 미치는 다른 사업에 종사하지 아니할 것입니다.
또한, 본인은 종전에 근무하던 회사로부터 어떠한 영업비밀도 누설, 유출, 목적 외 이용한 사실이 없으며, 회사의 업무를 수행함에 있어서 종전 회사의 영업비밀을 부당 이용하지 아니할 것입니다.
본 서약사항은 회사에 근무하는 기간은 물론 퇴사 후 1년까지 유효합니다.

본인은 위 서약 사항을 위반하는 경우 이로 인하여 회사에게 발생하는 모든 손해를 배상할 것입니다.


{{contract_date}}    생년월일    {{birth_date}}
성명    {{employee_name}}
서명(인)    {{employee_seal}}`,
    },

    // ─── 4. 비밀유지서약서 (NDA) ───
    {
      id: 'builtin-nda',
      name: '비밀유지서약서',
      category: 'nda',
      required_variables: ['employee_name', 'contract_date', 'birth_date'],
      body: `비밀유지서약서

{{employee_name}}(이하 "본인")은(는) (주)모티브이노베이션(이하 "회사")의 임직원으로서 회사에 입사하여 회사를 위하여 업무를 수행함에 있어 취득할 가능성이 있는 회사의 영업비밀 보호와 관련하여 다음과 같이 서약합니다.

제1조 (영업비밀)
본 서약서상 영업비밀이란 아래에 각 사항을 포함, 회사 업무수행과 관련하여 알게 되거나 제공받는 영업활동에 유용한 기술상 또는 경영상의 제반 정보(이하 "영업비밀")를 의미하며, 이에 한정되지 아니합니다.
1. 제품의 소스코드, 지식재산 및 관련 기술, 마케팅 계획, 판매기법 및 영업기법, 판매방법에 관한 사항
2. 회사의 인사, 조직, 재무, 전산, 연구개발, 교육, 훈련 등에 관한 사항
3. 타사와의 계약 및 그 계약 관계에서 생성하거나 제공받은 각종 기술 및 각종 경영상의 정보에 관한 사항
4. 사업계획수립시 생성된 각종 보고서 및 기초자료, 분석정보 등 내부논의 문건을 포함한 유,무형의 일체 정보
5. 기타 회사의 영업활동에 유용한 기술상 또는 경영상 정보에 관한 사항

제2조 (비밀유지의무)
1. 재직 중에 알게 된 영업비밀을 회사가 명시적으로 승인한 이외의 방법으로 사용하지 않겠습니다.
2. 영업비밀 관련 자료를 사전 서면승인없이 복사, 녹음, 촬영 기타 방법에 의해 복제, 반출, 전송하지 않겠습니다.
3. 영업비밀의 유지, 관리에 최선을 다하며, 제3자에게 유출, 공개되지 않도록 필요한 모든 조치를 취하겠습니다.
4. 재직 시, 퇴사 후에도 사전 서면승인 없이 영업비밀을 사용하지 않으며, 제3자에게 공개, 누설하지 않겠습니다.
5. 상기 누설, 제공 및 공개금지 등 비밀유지의무는 구두, 서면, 파일(동영상 포함) 등에 의한 경우를 포함합니다.

제3조 (자료의 반환)
1. 퇴사, 업무변경시 영업비밀을 포함한 자료(파일/도면/서류/디스켓/CD/USB/HDD 등)를 회사에 반환하겠습니다.
2. 회사가 재직, 퇴사 시 영업비밀 포함자료를 즉시 반환, 또는 회사의 동의하에 폐기 요청시 이에 따르겠습니다.

제4조 (소유권의 귀속)
1. 재직 중 작성한 업무관련 그래픽, 문구, 보고서 등 문건 및 저술한 서적 등 저작물의 소유권, 저작권 등의 재산권 일체가 회사에 귀속됨을 확인합니다.
2. 회사 업무 관련하여 개발, 취득, 인지하게 된 모든 기술, 발명, 노하우, 고안 등에 대한 권리 및 작성된 일체의 문건 및 자료 등의 소유권 및 그와 관련된 저작권 등 일체의 지식재산권이 회사에 전적으로 귀속됨을 인정합니다.

제5조 (손해배상)
1. 본 서약서 상의 의무 또는 확약사항을 위반할 경우, 「부정경쟁방지 및 영업비밀보호에 관한 법률」에 규정된 손해배상 책임, 형법상의 업무상 배임 등의 죄책, 기타 제반 민·형사상의 책임을 질 것을 확인합니다.
2. 본인의 귀책사유로 영업비밀 및 그에 관한 자료 등을 분실, 도난 및 침해 당한 경우 본인의 비용과 책임으로 그 영업비밀을 회수하는 등 최선을 다하여 수습조치를 취할 것이며, 이로 인하여 회사에 발생하는 모든 손해(변호사비용 등 법률비용 포함)를 배상하겠습니다.


{{contract_date}}
회사명    (주)모티브이노베이션    생년월일    {{birth_date}}
직위/성명    대표 / 채희웅    성명    {{employee_name}}
서명(인)    {{company_seal}}    서명(인)    {{employee_seal}}`,
    },

    // ─── 5. 연봉계약서 ───
    {
      id: 'builtin-salary-contract',
      name: '연봉계약서',
      category: 'salary',
      required_variables: [
        'employee_name', 'start_date', 'end_date', 'salary_amount',
        'salary_breakdown_table', 'contract_date', 'birth_date',
      ],
      body: `연봉계약서

(주)모티브이노베이션(이하 'A')와(과) {{employee_name}}(이하 'B')은(는) 다음과 같이 연봉계약(이하 '본 계약'이라 한다.)을 체결하고, 이를 성실히 준수할 것을 약속하며 서명날인합니다.

제1조 (연봉계약기간)
연봉계약기간은 {{start_date}}부터 {{end_date}}까지로 하며, 연봉계약종료일 이후 연봉은 기존을 유지한다.

제2조 (연봉의 구성)
'B'의 임금은 매월 1일부터 말일까지 산정하여 매월 31일에 'B' 명의의 예금계좌로 지급한다.
'B'의 연봉은 퇴직금을 별도로 하여 {{salary_amount}}이며, 구성항목은 다음과 같다.

* 월 통상임금 산정 209시간 기준
{{salary_breakdown_table}}

제3조 (기타)
본 계약은 제1조의 계약기간의 임금에 적용하며, 기타 근로조건 관련사항은 입사 시 체결한 근로계약서에 의한다. 'B'는 위 계약서의 내용을 충분히 숙지하여 사본을 교부받았고, 본 계약서에 정하지 않은 사항은 '근로기준법' 및 사규에 따른다.

제4조 (연봉 미공개의 의무)
※별도작성 '비밀유지서약서' 참조
'B'는 연봉액수를 포함, 계약에 관한 모든 내용을 타인에게 알려서는 아니되며, 알려질 경우 징계 조치한다.


{{contract_date}}
회사명(A)    (주)모티브이노베이션    생년월일(B)    {{birth_date}}
직위/성명(A)    대표 / 채희웅    성명(B)    {{employee_name}}
서명(인)    {{company_seal}}    서명(인)    {{employee_seal}}`,
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

  // Probation dates (3 months from hire date)
  const hireDate = employee.hire_date ? new Date(employee.hire_date) : new Date();
  const probationEnd = new Date(hireDate);
  probationEnd.setMonth(probationEnd.getMonth() + 3);
  const probationEndStr = probationEnd.toISOString().slice(0, 10);

  // Birth date from resident number (YYMMDD)
  const rn = employee.resident_number || '';
  let birthDateStr = '';
  if (rn.length >= 6) {
    const yy = rn.slice(0, 2);
    const mm = rn.slice(2, 4);
    const dd = rn.slice(4, 6);
    const century = (rn.length >= 8 && (rn[7] === '3' || rn[7] === '4')) ? '20' : '19';
    birthDateStr = `${century}${yy}년 ${mm}월 ${dd}일`;
  }

  // Salary breakdown table for 연봉계약서
  const mealAllowance = 200000; // 식대 비과세
  const basePay209 = Math.round((monthlySalary - mealAllowance - otPay) > 0
    ? monthlySalary - mealAllowance - otPay : basePay);
  const salaryBreakdownTable = [
    `  기본급: ${fmt(basePay209)}원`,
    `  고정연장근로수당: ${fmt(otPay)}원`,
    `  식대: ${fmt(mealAllowance)}원`,
    `  월 합계: ${fmt(monthlySalary)}원`,
  ].join('\n');

  const vars: Record<string, string> = {
    // English keys (used in built-in templates)
    employee_name: employee.name || '',
    resident_number: employee.resident_number || '______-_______',
    department: employee.department || '',
    position: employee.position || '',
    address: employee.address || '',
    company_name: company.name || '(주)모티브이노베이션',
    representative_name: company.representative || company.ceo_name || '채희웅',
    company_address: company.address || '',
    start_date: employee.hire_date || today,
    end_date: nextYearStr,
    salary_amount: `${fmt(Number(employee.salary || 0))}원`,
    base_pay: fmt(basePay),
    overtime_pay: fmt(otPay),

    // Contract template variables
    contract_date: today,
    birth_date: birthDateStr || employee.birth_date || '',
    probation_start: employee.hire_date || today,
    probation_end: probationEndStr,
    probation_pay_rate: '100%',
    pay_basis: '연봉 지급기준',
    salary_breakdown_table: salaryBreakdownTable,
    company_seal: '',
    employee_seal: '',

    // Korean keys (for backward compatibility with custom templates)
    직원명: employee.name || '',
    주민등록번호: employee.resident_number || '______-_______',
    부서: employee.department || '',
    직급: employee.position || '',
    입사일: employee.hire_date || today,
    회사명: company.name || '(주)모티브이노베이션',
    대표자명: company.representative || company.ceo_name || '채희웅',
    계약시작일: employee.hire_date || today,
    계약종료일: nextYearStr,
    연봉: fmt(Number(employee.salary || 0)),
    월급여: fmt(monthlySalary),
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

  // Audit: document_created
  try {
    await logAuditTrail(pkg.id, {
      action: 'document_created',
      timestamp: new Date().toISOString(),
      actor: 'system',
      details: `계약 패키지 생성: ${title}, 문서 ${items.length}건`,
    });
  } catch (e) {
    console.error('Audit log error:', e);
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

  // Audit: email_sent
  try {
    await logAuditTrail(packageId, {
      action: 'email_sent',
      timestamp: new Date().toISOString(),
      actor: company?.name || 'system',
      details: `서명 요청 이메일 발송: ${pkg.employees.email}`,
    });
  } catch (e) {
    console.error('Audit log error:', e);
  }

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

  // Generate and store document hash for integrity verification
  try {
    const hash = await generatePackageHash(packageId);
    await storeDocumentHash(packageId, hash);
  } catch (e) {
    console.error('Hash generation failed:', e);
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
