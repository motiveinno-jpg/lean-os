-- 시스템 양식 3종 (service / supply / consulting) 의 갑/을 하단 영역에 서명 박스 명시.
--   기존: 회사명·사업자번호·대표자 (인) 텍스트만 → 서명 위치 모호.
--   변경: sig-box span (data-role="갑|을") 추가 — 비어있을 땐 점선 박스, 합성 후 이미지 삽입.
--   서명 합성 로직 (composeSignedHtml) 이 셀렉터로 찾아 채움.
--
-- 영향:
--   - is_system=true 인 양식 3개만 UPDATE (회사 커스텀 양식 미터치)
--   - variables jsonb 변경 0 (기존 변수명 그대로 — {갑_회사명}, {을_사업자번호} 등)
--   - 마이그 멱등: 새 HTML 덮어쓰기. 반복 실행 OK.
--   - 기존 발송된 계약서(template_snapshot_html 에 옛 HTML 저장된 행)는 영향 0 — 신규 발송부터 적용.

DO $$
DECLARE
  new_block text := E'<div style="margin-top:48px;display:flex;justify-content:space-between;gap:48px">
  <div style="flex:1">
    <p style="font-weight:bold;margin-bottom:8px">갑</p>
    <p style="margin:2px 0">회사명: {갑_회사명}</p>
    <p style="margin:2px 0">사업자등록번호: {갑_사업자번호}</p>
    <p style="margin:2px 0;display:flex;align-items:center;gap:12px">
      <span>대표자: {갑_대표자} (인)</span>
      <span class="sig-box" data-role="갑" style="display:inline-block;width:90px;height:90px;border:1px dashed #cbd5e1;border-radius:8px;background:#f9fafb;flex-shrink:0"></span>
    </p>
  </div>
  <div style="flex:1">
    <p style="font-weight:bold;margin-bottom:8px">을</p>
    <p style="margin:2px 0">회사명: {을_회사명}</p>
    <p style="margin:2px 0">사업자등록번호: {을_사업자번호}</p>
    <p style="margin:2px 0;display:flex;align-items:center;gap:12px">
      <span>대표자: {을_대표자} (인)</span>
      <span class="sig-box" data-role="을" style="display:inline-block;width:90px;height:90px;border:1px dashed #cbd5e1;border-radius:8px;background:#f9fafb;flex-shrink:0"></span>
    </p>
  </div>
</div>';
BEGIN
  -- regexp_replace: 기존 갑/을 블록(<div style="margin-top:40px;display:flex...">) 통째로 교체.
  --   's' flag = . matches newline. 'g' = global (한 양식 안 1번이지만 안전).
  --   greedy 회피: `</div>\\s*</div>` 까지 비탐욕 매칭 후, 마지막 </div> (본문 wrapper 닫음) 은 별도 추가.
  UPDATE public.contract_templates
  SET body_html = regexp_replace(
        body_html,
        '<div style="margin-top:40px;display:flex;justify-content:space-between;gap:24px">.*?</div>\s*</div>\s*</div>',
        new_block || E'\n</div>',
        'sg'
      ),
      updated_at = now()
  WHERE is_system = true AND code IN ('service', 'supply', 'consulting');

  RAISE NOTICE 'Updated % system templates with signature boxes', (SELECT count(*) FROM public.contract_templates WHERE is_system=true AND code IN ('service','supply','consulting'));
END $$;
