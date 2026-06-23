"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDealClassifications, upsertDealClassification, deleteDealClassification } from "@/lib/queries";
import { useToast } from "@/components/toast";

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
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold">프로젝트 분류 관리</h2>
          <p className="text-xs text-[var(--text-dim)] mt-0.5">B2B/B2C/B2G + 커스텀 카테고리</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: '', color: '#3b82f6' }); }}
          className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
        >
          + 분류 추가
        </button>
      </div>

      {showForm && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">분류명 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: Enterprise"
                className="field-input-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">색상</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer"
                />
                <span className="text-xs text-[var(--text-dim)] font-mono">{form.color}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => form.name && upsertMut.mutate()}
              disabled={!form.name || upsertMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {editId ? '수정' : '추가'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-xs">
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
          프로젝트 분류가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {allCls.map((cls: any) => (
            <div
              key={cls.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
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
