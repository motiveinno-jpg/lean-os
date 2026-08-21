"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { friendlyError } from "@/lib/friendly-error";
import { DateField } from "@/components/date-field";
import {
  loadProfileExt, saveProfileExt, CARD_TOTAL,
  SIZE_CLASSES, CERTIFICATIONS, INTERESTS, KSIC_MAIN,
  type ProfileExtInput,
} from "@/lib/support-programs";

/**
 * 회사 카드 7문항 — 우리 DB로 알 수 없는 축만 묻는다 (2026-08-21).
 *   업종·소재지·규모·고용 4축은 companies·employees 에서 이미 나온다.
 *   ★ 강제하지 않는다. 안 채워도 화면은 돌고, 미입력 조건은 목록에서 `?` 로 보인다.
 *   ★ 추가·수정 폼은 팝업 (목록 줄이 밀리지 않게).
 */
export function SupportCompanyCard({
  companyId, userId, open, onClose,
}: { companyId: string; userId: string | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: saved } = useQuery({
    queryKey: ["support-profile-ext", companyId],
    queryFn: () => loadProfileExt(companyId),
    enabled: !!companyId && open,
  });

  const [form, setForm] = useState<ProfileExtInput>({
    open_date: null, size_class: null, certifications: [],
    has_export: null, ksic_main: null, prior_grants: [], interests: [],
  });
  //   팝업을 열 때마다 저장값으로 되돌린다 — 지난번에 쓰다 만 값이 남아 있으면 헷갈린다
  useEffect(() => { if (open && saved) setForm(saved); }, [open, saved]);

  const [grantYear, setGrantYear] = useState("");
  const [grantName, setGrantName] = useState("");

  const mut = useMutation({
    mutationFn: () => saveProfileExt(companyId, userId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-profile-ext", companyId] });
      qc.invalidateQueries({ queryKey: ["support-profile", companyId] });
      toast("회사 카드를 저장했습니다", "success");
      onClose();
    },
    onError: (e: unknown) => toast(friendlyError(e, "저장하지 못했습니다"), "error"),
  });

  useModalKeys(open, onClose);
  if (!open) return null;

  const filled = [
    !!form.open_date, !!form.size_class, form.certifications.length > 0,
    form.has_export !== null, !!form.ksic_main,
    form.prior_grants.length > 0, form.interests.length > 0,
  ].filter(Boolean).length;

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div className="sp-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp-modal" role="dialog" aria-label="회사 카드">
        <div className="sp-modal-head">
          <div>
            <b className="sp-modal-title">회사 카드</b>
            <p className="sp-modal-desc">
              우리 자료로 알 수 없는 것만 묻습니다. 채운 만큼 판정이 정확해지고, 비워 두면 그 조건이 <b>?</b> 로 남습니다.
            </p>
          </div>
          <span className="sp-card-count">{filled} / {CARD_TOTAL}</span>
        </div>

        <div className="sp-modal-body">
          {/* ① 개업일 */}
          <div className="sp-q">
            <div className="sp-q-label"><em>1</em> 개업일</div>
            <div className="sp-q-body">
              <DateField value={form.open_date ?? ""} onChange={(e) => setForm({ ...form, open_date: e.target.value || null })} />
              <p className="sp-q-hint">창업 3년 · 7년 이내를 따지는 사업이 많습니다. 사업자등록증의 개업연월일을 넣어 주세요.</p>
            </div>
          </div>

          {/* ② 기업 규모 */}
          <div className="sp-q">
            <div className="sp-q-label"><em>2</em> 기업 규모</div>
            <div className="sp-q-body">
              <div className="sp-pick-row">
                {SIZE_CLASSES.map((s) => (
                  <button key={s.value} type="button" title={s.desc}
                    onClick={() => setForm({ ...form, size_class: form.size_class === s.value ? null : s.value })}
                    className={form.size_class === s.value ? "sp-pick sp-pick-on" : "sp-pick"}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="sp-q-hint">규모 제한이 걸린 공고가 대부분입니다. 모르면 비워 두세요.</p>
            </div>
          </div>

          {/* ③ 보유 인증 */}
          <div className="sp-q">
            <div className="sp-q-label"><em>3</em> 보유 인증</div>
            <div className="sp-q-body">
              <div className="sp-pick-row">
                {CERTIFICATIONS.map((c) => (
                  <button key={c.value} type="button"
                    onClick={() => setForm({ ...form, certifications: toggle(form.certifications, c.value) })}
                    className={form.certifications.includes(c.value) ? "sp-pick sp-pick-on" : "sp-pick"}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="sp-q-hint">가점이 붙거나, 아예 이것이 있어야 신청되는 사업이 있습니다. 여러 개 고를 수 있습니다.</p>
            </div>
          </div>

          {/* ④ 수출 실적 */}
          <div className="sp-q">
            <div className="sp-q-label"><em>4</em> 수출 실적</div>
            <div className="sp-q-body">
              <div className="sp-pick-row">
                {([[true, "있음"], [false, "없음"]] as const).map(([v, label]) => (
                  <button key={label} type="button"
                    onClick={() => setForm({ ...form, has_export: form.has_export === v ? null : v })}
                    className={form.has_export === v ? "sp-pick sp-pick-on" : "sp-pick"}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="sp-q-hint">수출바우처 계열의 자격 요건입니다.</p>
            </div>
          </div>

          {/* ⑤ 주력 업종 */}
          <div className="sp-q">
            <div className="sp-q-label"><em>5</em> 주력 업종</div>
            <div className="sp-q-body">
              <select className="field-input sp-select" value={form.ksic_main ?? ""}
                onChange={(e) => setForm({ ...form, ksic_main: e.target.value || null })}>
                <option value="">고르지 않음</option>
                {KSIC_MAIN.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <p className="sp-q-hint">회사 정보의 업태·종목이 자유 글이라 그대로는 업종 제한을 판단하기 어렵습니다.</p>
            </div>
          </div>

          {/* ⑥ 최근 3년 수혜 이력 */}
          <div className="sp-q">
            <div className="sp-q-label"><em>6</em> 최근 3년 수혜 이력</div>
            <div className="sp-q-body">
              {form.prior_grants.length > 0 && (
                <div className="sp-chip-row">
                  {form.prior_grants.map((g, i) => (
                    <span key={`${g.year}-${g.name}-${i}`} className="sp-chip">
                      {g.year ? `${g.year}년 ` : ""}{g.name}
                      <button type="button" aria-label="빼기"
                        onClick={() => setForm({ ...form, prior_grants: form.prior_grants.filter((_, k) => k !== i) })}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="sp-grant-add">
                <input className="field-input sp-grant-year" placeholder="연도" inputMode="numeric"
                  value={grantYear} onChange={(e) => setGrantYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
                <input className="field-input sp-grant-name" placeholder="사업명 (예: 수출바우처)"
                  value={grantName} onChange={(e) => setGrantName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGrant(); } }} />
                <button type="button" className="btn-secondary btn-sm" onClick={addGrant}>추가</button>
              </div>
              <p className="sp-q-hint">같은 사업을 연달아 받지 못하게 막는 곳이 있어, 적어 두면 &apos;재신청 제한 확인&apos;으로 걸러 드립니다.</p>
            </div>
          </div>

          {/* ⑦ 관심 분야 */}
          <div className="sp-q">
            <div className="sp-q-label"><em>7</em> 관심 분야</div>
            <div className="sp-q-body">
              <div className="sp-pick-row">
                {INTERESTS.map((it) => (
                  <button key={it.value} type="button"
                    onClick={() => setForm({ ...form, interests: toggle(form.interests, it.value) })}
                    className={form.interests.includes(it.value) ? "sp-pick sp-pick-on" : "sp-pick"}>
                    {it.label}
                  </button>
                ))}
              </div>
              <p className="sp-q-hint">추천 순서에만 씁니다 — 고르지 않은 분야를 숨기지는 않습니다.</p>
            </div>
          </div>
        </div>

        <div className="sp-modal-foot">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );

  function addGrant() {
    const name = grantName.trim();
    if (!name) return;
    setForm((f) => ({ ...f, prior_grants: [...f.prior_grants, { year: grantYear ? Number(grantYear) : undefined, name }] }));
    setGrantYear("");
    setGrantName("");
  }
}
