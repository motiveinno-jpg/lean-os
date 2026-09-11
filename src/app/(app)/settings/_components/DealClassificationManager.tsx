"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDealClassifications, upsertDealClassification, deleteDealClassification } from "@/lib/queries";
import { useToast } from "@/components/toast";

//   미리 고르는 색 — 기본 3종(B2B 파랑·B2C 초록·B2G 주황)과 눈에 구분되는 색들
const DEAL_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#64748b"];

export function DealClassificationManager({ companyId }: { companyId: string | null }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: '#3b82f6' });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: classifications = [] } = useQuery({
    queryKey: ['deal-classifications', companyId],
    queryFn: () => getDealClassifications(companyId!),
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: () => upsertDealClassification({
      id: editId || undefined,
      companyId: companyId!,
      name: form.name,
      color: form.color,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-classifications'] });
      setShowForm(false);
      setEditId(null);
      setForm({ name: '', color: '#3b82f6' });
    },
    onError: (err: any) => toast("분류 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteDealClassification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deal-classifications'] }),
    onError: (err: any) => toast(`삭제 실패: ${err.message || err}`, "error"),
  });

  if (!companyId) return null;

  return (
    <div className="settings-deal-classification stg-sec">
      <div className="stg-sec-head mb-4">
        <div>
          <h2 className="stg-sec-title">딜 분류</h2>
          <p className="stg-sec-desc">거래 장부와 프로젝트에서 쓰는 분류입니다.</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: '', color: '#3b82f6' }); }}
          className="btn-secondary btn-sm shrink-0"
        >
          + 분류 추가
        </button>
      </div>

      {showForm && (
        <div className="deal-classification-form">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">분류명 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: Enterprise"
                className="field-input-sm"
              />
            </div>
            <div>
              {/*   색은 대시보드 '분류별 현황'과 월간 보고서가 실제로 읽어 점을 그린다
                    (lib/queries.ts 의 classificationColors → lib/engines.ts). 2026-09-08 에 "쓰이지 않는다"는
                    판단으로 고르는 칸을 뺐는데 사실이 아니었고, 그 뒤로 모든 분류가 같은 파란 점이 됐다.
                    2026-09-11 되살림 — 미리 고른 색 + 직접 고르기. */}
              <label className="field-label">색상<span className="ui-sub">대시보드 분류별 현황의 점 색</span></label>
              <div className="deal-classification-colors">
                {DEAL_COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`색상 ${c}`} onClick={() => setForm({ ...form, color: c })}
                    className={form.color.toLowerCase() === c ? "deal-color-dot is-on" : "deal-color-dot"}
                    style={{ background: c }} />
                ))}
                <input type="color" value={form.color} aria-label="직접 고르기"
                  onChange={(e) => setForm({ ...form, color: e.target.value })} className="deal-color-input" />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => form.name && upsertMut.mutate()}
              disabled={!form.name || upsertMut.isPending}
              className="btn-primary"
            >
              {editId ? '수정' : '추가'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="btn-ghost">
              취소
            </button>
          </div>
        </div>
      )}

      {(() => {
        const defaults = ['B2B', 'B2C', 'B2G'];
        const defaultColors: Record<string, string> = { B2B: '#3b82f6', B2C: '#22c55e', B2G: '#f59e0b' };
        const customNames = classifications.map((c: any) => c.name);
        const allCls = [
          ...defaults.filter(d => !customNames.includes(d)).map(d => ({ id: `default-${d}`, name: d, color: defaultColors[d], is_system: true })),
          ...classifications,
        ];
        return allCls.length === 0 ? (
        <div className="text-center py-6 text-sm text-[var(--text-muted)]">
          아직 딜 분류가 없습니다.
        </div>
      ) : (
        <div className="deal-classification-list">
          {allCls.map((cls: any) => (
            <div
              key={cls.id}
              className="deal-classification-row"
            >
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cls.color || '#3b82f6' }} />
                <span className="text-sm font-medium">{cls.name}</span>
                {cls.is_system && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">시스템</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditId(String(cls.id).startsWith('default-') ? null : cls.id); setForm({ name: cls.name, color: cls.color || '#3b82f6' }); setShowForm(true); }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition"
                >
                  수정
                </button>
                {!String(cls.id).startsWith('default-') && (
                  <button
                    onClick={() => deleteMut.mutate(cls.id)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )
      })()}
    </div>
  );
}
