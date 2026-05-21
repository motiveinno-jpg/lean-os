-- L 계약: 외부 서명자 회사 정보 3종(회사명/사업자번호/대표자) RPC 파라미터 추가
-- + 시스템 양식 3종 본문 갱신 — 갑/을 사업자등록번호 줄 + 신규 변수 형식
--
-- 변경:
--   1) submit_quote_decision 9-arg DROP → 12-arg CREATE OR REPLACE
--      (p_signer_company_name, p_signer_business_number, p_signer_representative 추가)
--      본문에서 quote_approvals.payload 에 jsonb merge 저장 (다른 컬럼 무영향)
--   2) 시스템 양식 3종(service/supply/consulting) body_html UPDATE
--      - 갑/을 영역에 사업자등록번호 줄 추가
--      - 신규 변수 형식 {갑_회사명}/{갑_사업자번호}/{갑_대표자}/{을_*} 사용
--      - variables 배열도 함께 갱신

SET lock_timeout = '4000';
SET statement_timeout = '60000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) submit_quote_decision RPC 12-arg 확장
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.submit_quote_decision(text, text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_quote_decision(
  p_token                  text,
  p_decision               text,
  p_note                   text DEFAULT NULL,
  p_signature_method       text DEFAULT NULL,
  p_signature_data_url     text DEFAULT NULL,
  p_signed_contract_url    text DEFAULT NULL,
  p_signed_contract_html   text DEFAULT NULL,
  p_signer_ip              text DEFAULT NULL,
  p_signer_user_agent      text DEFAULT NULL,
  p_signer_company_name    text DEFAULT NULL,
  p_signer_business_number text DEFAULT NULL,
  p_signer_representative  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row quote_approvals%ROWTYPE;
  v_next_stage text;
  v_company_id uuid;
  v_sig_method text;
  v_signer_patch jsonb;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  SELECT * INTO v_row FROM quote_approvals WHERE approval_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  IF v_row.status IN ('approved','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_decided', 'status', v_row.status);
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  v_sig_method := COALESCE(p_signature_method, 'none');
  IF v_sig_method NOT IN ('draw','type','upload','seal','none') THEN
    v_sig_method := 'none';
  END IF;

  -- 외부 서명자 회사 정보 (을) — payload jsonb 에 merge 저장
  v_signer_patch := jsonb_strip_nulls(jsonb_build_object(
    'signer_company_name',    p_signer_company_name,
    'signer_business_number', p_signer_business_number,
    'signer_representative',  p_signer_representative
  ));

  UPDATE quote_approvals
     SET status = p_decision,
         decided_at = now(),
         decision_note = p_note,
         signature_method     = CASE WHEN p_decision='approved' THEN v_sig_method ELSE signature_method END,
         signature_data_url   = CASE WHEN p_decision='approved' THEN p_signature_data_url ELSE signature_data_url END,
         signed_contract_url  = CASE WHEN p_decision='approved' THEN p_signed_contract_url ELSE signed_contract_url END,
         signed_contract_html = CASE WHEN p_decision='approved' THEN p_signed_contract_html ELSE signed_contract_html END,
         signer_ip            = CASE WHEN p_decision='approved' THEN p_signer_ip ELSE signer_ip END,
         signer_user_agent    = CASE WHEN p_decision='approved' THEN p_signer_user_agent ELSE signer_user_agent END,
         signed_at_external   = CASE WHEN p_decision='approved' THEN now() ELSE signed_at_external END,
         payload              = CASE
                                  WHEN p_decision='approved' AND v_signer_patch <> '{}'::jsonb
                                  THEN COALESCE(payload, '{}'::jsonb) || v_signer_patch
                                  ELSE payload
                                END
   WHERE id = v_row.id;

  v_company_id := v_row.company_id;

  IF p_decision = 'approved' THEN
    v_next_stage := CASE v_row.stage
      WHEN 'estimate'         THEN 'contract'
      WHEN 'contract'         THEN 'in_progress'
      WHEN 'progress_report'  THEN 'completed'
      WHEN 'completion'       THEN 'settlement'
      WHEN 'settlement'       THEN NULL
      ELSE NULL
    END;
    IF v_next_stage IS NOT NULL THEN
      UPDATE deals SET stage = v_next_stage WHERE id = v_row.deal_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO audit_logs(company_id, action, entity_type, entity_id, user_id, metadata)
    VALUES (v_company_id,
      CASE p_decision WHEN 'approved' THEN 'approve' ELSE 'reject' END,
      'quote_approval', v_row.id, NULL,
      jsonb_build_object('stage', v_row.stage, 'next_stage', v_next_stage, 'note', p_note,
        'signature_method', v_sig_method, 'signer_ip', p_signer_ip,
        'signer_company_name', p_signer_company_name));
  EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END;

  BEGIN
    INSERT INTO notifications(company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    SELECT v_company_id, u.id, 'approval',
           CASE p_decision WHEN 'approved' THEN '거래처 승인 — ' || v_row.stage ELSE '거래처 거절 — ' || v_row.stage END,
           COALESCE(p_note, ''), 'quote_approval', v_row.id, false
      FROM users u WHERE u.company_id = v_company_id AND u.role IN ('owner','admin');
  EXCEPTION WHEN undefined_table THEN NULL; WHEN check_violation THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', p_decision, 'deal_stage_after', v_next_stage,
    'stage', v_row.stage, 'signature_method', v_sig_method);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quote_decision(text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quote_decision(text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated, anon, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 시스템 양식 3종 body_html UPDATE — 사업자번호 줄 + 신규 변수 형식
--    (기존 {갑사명} 등은 alias 로 lib 에서 자동 매핑 — 양식 자체는 신규 형식)
-- ─────────────────────────────────────────────────────────────────────────

-- service
UPDATE public.contract_templates SET
  body_html = $$<div class="contract">
<h1 style="text-align:center;margin:0 0 24px;font-size:22px;font-weight:bold">서비스 계약서</h1>
<p>본 계약은 <strong>{갑_회사명}</strong>(이하 "갑")과 <strong>{을_회사명}</strong>(이하 "을")이 다음과 같이 체결한다.</p>
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
  <div style="flex:1"><p style="font-weight:bold">갑</p><p>회사명: {갑_회사명}</p><p>사업자등록번호: {갑_사업자번호}</p><p>대표자: {갑_대표자} (인)</p></div>
  <div style="flex:1"><p style="font-weight:bold">을</p><p>회사명: {을_회사명}</p><p>사업자등록번호: {을_사업자번호}</p><p>대표자: {을_대표자} (인)</p></div>
</div>
</div>$$,
  variables = '["갑_회사명","갑_사업자번호","갑_대표자","을_회사명","을_사업자번호","을_대표자","계약금액","계약기간_시작","계약기간_종료","지급조건","특약"]'::jsonb,
  updated_at = now()
WHERE is_system = true AND code = 'service';

-- supply
UPDATE public.contract_templates SET
  body_html = $$<div class="contract">
<h1 style="text-align:center;margin:0 0 24px;font-size:22px;font-weight:bold">물품 공급 계약서</h1>
<p>본 계약은 <strong>{갑_회사명}</strong>(이하 "갑", 매수인)과 <strong>{을_회사명}</strong>(이하 "을", 매도인)이 물품 공급에 관하여 다음과 같이 체결한다.</p>
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
  <div style="flex:1"><p style="font-weight:bold">갑 (매수인)</p><p>회사명: {갑_회사명}</p><p>사업자등록번호: {갑_사업자번호}</p><p>대표자: {갑_대표자} (인)</p></div>
  <div style="flex:1"><p style="font-weight:bold">을 (매도인)</p><p>회사명: {을_회사명}</p><p>사업자등록번호: {을_사업자번호}</p><p>대표자: {을_대표자} (인)</p></div>
</div>
</div>$$,
  variables = '["갑_회사명","갑_사업자번호","갑_대표자","을_회사명","을_사업자번호","을_대표자","계약금액","계약기간_시작","계약기간_종료","지급조건","특약"]'::jsonb,
  updated_at = now()
WHERE is_system = true AND code = 'supply';

-- consulting
UPDATE public.contract_templates SET
  body_html = $$<div class="contract">
<h1 style="text-align:center;margin:0 0 24px;font-size:22px;font-weight:bold">컨설팅 계약서</h1>
<p>본 계약은 <strong>{갑_회사명}</strong>(이하 "갑")과 <strong>{을_회사명}</strong>(이하 "을", 컨설턴트)이 컨설팅 서비스 제공에 관하여 다음과 같이 체결한다.</p>
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
  <div style="flex:1"><p style="font-weight:bold">갑</p><p>회사명: {갑_회사명}</p><p>사업자등록번호: {갑_사업자번호}</p><p>대표자: {갑_대표자} (인)</p></div>
  <div style="flex:1"><p style="font-weight:bold">을 (컨설턴트)</p><p>회사명: {을_회사명}</p><p>사업자등록번호: {을_사업자번호}</p><p>대표자: {을_대표자} (인)</p></div>
</div>
</div>$$,
  variables = '["갑_회사명","갑_사업자번호","갑_대표자","을_회사명","을_사업자번호","을_대표자","계약금액","계약기간_시작","계약기간_종료","지급조건","특약"]'::jsonb,
  updated_at = now()
WHERE is_system = true AND code = 'consulting';

NOTIFY pgrst, 'reload schema';
