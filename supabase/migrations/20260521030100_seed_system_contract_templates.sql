-- L 견적/계약 — 시스템 계약서 양식 3종 seed (서비스/공급/컨설팅)
-- is_system=true, company_id NULL — 모든 회사가 SELECT 가능, INSERT/UPDATE/DELETE 차단 (RLS).
-- 멱등 — ON CONFLICT (code) WHERE is_system DO NOTHING (UNIQUE 인덱스로 보장).

SET lock_timeout = '4000';

INSERT INTO public.contract_templates
  (company_id, name, code, body_html, variables, is_system, is_active, sort_order, file_type)
VALUES
(
  NULL,
  '서비스 계약서 (소프트웨어/SaaS/용역)',
  'service',
  $$<div class="contract">
<h1 style="text-align:center;margin:0 0 24px;font-size:22px;font-weight:bold">서비스 계약서</h1>
<p>본 계약은 <strong>{갑사명}</strong>(이하 "갑")과 <strong>{을사명}</strong>(이하 "을")이 다음과 같이 체결한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제1조 (목적)</h2>
<p>본 계약은 갑이 을에게 서비스 제공을 의뢰하고, 을이 이를 수행함에 있어 필요한 사항을 정함을 목적으로 한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제2조 (계약기간)</h2>
<p>계약기간은 <strong>{계약기간_시작}</strong>부터 <strong>{계약기간_종료}</strong>까지로 한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제3조 (계약금액 및 지급조건)</h2>
<p>계약금액은 총 <strong>{계약금액}</strong>원 (VAT 별도)으로 하며, 지급조건은 다음과 같다:</p>
<p style="white-space:pre-wrap;margin-left:16px;color:#374151">{지급조건}</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제4조 (을의 의무)</h2>
<p>을은 계약 내용에 따라 성실히 서비스를 제공하고, 갑의 합리적 요청에 응한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제5조 (기밀유지)</h2>
<p>양 당사자는 본 계약 수행 중 알게 된 상대방의 영업비밀 및 기밀정보를 제3자에게 누설하지 아니하며, 계약 종료 후에도 동일하다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제6조 (계약 해지)</h2>
<p>일방이 본 계약의 중대한 사항을 위반한 경우, 상대방은 14일 전 서면 통지로 본 계약을 해지할 수 있다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제7조 (분쟁해결)</h2>
<p>본 계약과 관련된 분쟁은 양 당사자가 협의로 해결하며, 협의되지 않을 경우 갑의 본점 소재지를 관할하는 법원을 합의관할로 한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제8조 (특약)</h2>
<p style="white-space:pre-wrap;margin-left:16px;color:#374151">{특약}</p>

<div style="margin-top:40px;display:flex;justify-content:space-between;gap:24px">
  <div style="flex:1">
    <p style="font-weight:bold">갑</p>
    <p>회사명: {갑사명}</p>
    <p>대표자: {대표자_갑} (인)</p>
  </div>
  <div style="flex:1">
    <p style="font-weight:bold">을</p>
    <p>회사명: {을사명}</p>
    <p>대표자: {대표자_을} (인)</p>
  </div>
</div>
</div>$$,
  '["갑사명","을사명","대표자_갑","대표자_을","계약금액","계약기간_시작","계약기간_종료","지급조건","특약"]'::jsonb,
  true, true, 10, 'html'
),
(
  NULL,
  '공급 계약서 (물품/제품)',
  'supply',
  $$<div class="contract">
<h1 style="text-align:center;margin:0 0 24px;font-size:22px;font-weight:bold">물품 공급 계약서</h1>
<p>본 계약은 <strong>{갑사명}</strong>(이하 "갑", 매수인)과 <strong>{을사명}</strong>(이하 "을", 매도인)이 물품 공급에 관하여 다음과 같이 체결한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제1조 (목적)</h2>
<p>을은 갑에게 본 계약서에 명시된 물품을 공급하고, 갑은 이에 대한 대금을 지급한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제2조 (공급 기간)</h2>
<p>공급 기간은 <strong>{계약기간_시작}</strong>부터 <strong>{계약기간_종료}</strong>까지로 한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제3조 (대금 및 지급조건)</h2>
<p>총 대금은 <strong>{계약금액}</strong>원 (VAT 별도)으로 하며, 지급조건은 다음과 같다:</p>
<p style="white-space:pre-wrap;margin-left:16px;color:#374151">{지급조건}</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제4조 (납품 및 검수)</h2>
<p>을은 정해진 일정에 따라 물품을 납품하며, 갑은 납품 후 7일 이내에 검수를 완료한다. 검수 결과 하자가 있는 경우 을은 즉시 재공급 또는 수정한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제5조 (소유권 이전 및 위험부담)</h2>
<p>물품의 소유권은 검수 완료 시점에 갑에게 이전되며, 그 이전까지의 위험은 을이 부담한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제6조 (하자담보책임)</h2>
<p>을은 납품일로부터 1년간 물품의 하자에 대한 담보책임을 진다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제7조 (계약 해지 및 분쟁해결)</h2>
<p>일방이 본 계약의 중대한 사항을 위반한 경우, 상대방은 14일 전 서면 통지로 본 계약을 해지할 수 있다. 본 계약 관련 분쟁은 갑의 본점 소재지 관할 법원을 합의관할로 한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제8조 (특약)</h2>
<p style="white-space:pre-wrap;margin-left:16px;color:#374151">{특약}</p>

<div style="margin-top:40px;display:flex;justify-content:space-between;gap:24px">
  <div style="flex:1">
    <p style="font-weight:bold">갑 (매수인)</p>
    <p>회사명: {갑사명}</p>
    <p>대표자: {대표자_갑} (인)</p>
  </div>
  <div style="flex:1">
    <p style="font-weight:bold">을 (매도인)</p>
    <p>회사명: {을사명}</p>
    <p>대표자: {대표자_을} (인)</p>
  </div>
</div>
</div>$$,
  '["갑사명","을사명","대표자_갑","대표자_을","계약금액","계약기간_시작","계약기간_종료","지급조건","특약"]'::jsonb,
  true, true, 20, 'html'
),
(
  NULL,
  '컨설팅 계약서 (전문 서비스)',
  'consulting',
  $$<div class="contract">
<h1 style="text-align:center;margin:0 0 24px;font-size:22px;font-weight:bold">컨설팅 계약서</h1>
<p>본 계약은 <strong>{갑사명}</strong>(이하 "갑")과 <strong>{을사명}</strong>(이하 "을", 컨설턴트)이 컨설팅 서비스 제공에 관하여 다음과 같이 체결한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제1조 (컨설팅 범위)</h2>
<p>을은 갑에게 합의된 분야에 대한 전문 자문, 분석, 보고서 작성 및 권고 사항 제공을 수행한다. 세부 범위는 특약 또는 별첨 RFP/제안서에 따른다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제2조 (계약기간)</h2>
<p>계약기간은 <strong>{계약기간_시작}</strong>부터 <strong>{계약기간_종료}</strong>까지로 한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제3조 (보수 및 지급조건)</h2>
<p>총 보수는 <strong>{계약금액}</strong>원 (VAT 별도)으로 하며, 지급조건은 다음과 같다:</p>
<p style="white-space:pre-wrap;margin-left:16px;color:#374151">{지급조건}</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제4조 (산출물 및 지적재산권)</h2>
<p>계약 수행 결과로 작성된 보고서, 분석자료 등 산출물의 지적재산권은 갑에게 귀속되며, 을은 갑의 사전 서면 동의 없이 제3자에게 제공하거나 사용하지 아니한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제5조 (기밀유지 의무)</h2>
<p>을은 본 계약 수행 중 알게 된 갑의 영업비밀, 고객정보 등 모든 비공개 정보를 제3자에게 누설하거나 자기 또는 제3자의 이익을 위해 사용하지 아니한다. 본 의무는 계약 종료 후 3년간 유지된다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제6조 (책임 제한)</h2>
<p>을의 권고 및 자문에 따라 갑이 의사결정 하여 발생한 결과에 대한 책임은 갑이 부담하며, 을의 손해배상 책임은 본 계약 총액을 초과하지 아니한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제7조 (계약 해지 및 분쟁해결)</h2>
<p>일방이 본 계약의 중대한 사항을 위반한 경우, 상대방은 14일 전 서면 통지로 본 계약을 해지할 수 있다. 본 계약 관련 분쟁은 갑의 본점 소재지 관할 법원을 합의관할로 한다.</p>

<h2 style="font-size:14px;margin:20px 0 8px;font-weight:bold">제8조 (특약)</h2>
<p style="white-space:pre-wrap;margin-left:16px;color:#374151">{특약}</p>

<div style="margin-top:40px;display:flex;justify-content:space-between;gap:24px">
  <div style="flex:1">
    <p style="font-weight:bold">갑</p>
    <p>회사명: {갑사명}</p>
    <p>대표자: {대표자_갑} (인)</p>
  </div>
  <div style="flex:1">
    <p style="font-weight:bold">을 (컨설턴트)</p>
    <p>회사명: {을사명}</p>
    <p>대표자: {대표자_을} (인)</p>
  </div>
</div>
</div>$$,
  '["갑사명","을사명","대표자_갑","대표자_을","계약금액","계약기간_시작","계약기간_종료","지급조건","특약"]'::jsonb,
  true, true, 30, 'html'
)
ON CONFLICT (code) WHERE is_system = true DO NOTHING;
