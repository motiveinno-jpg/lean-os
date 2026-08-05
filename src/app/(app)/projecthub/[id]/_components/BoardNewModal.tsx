"use client";

// 템플릿 추가 — 기본 양식에서 고르거나, 직접 칸을 짜서 만든다 (2026-08-05 사장님 지시).
//
//   "기본 양식들을 제공하고, 우측에 ＋버튼으로 템플릿을 더 추가. ＋를 눌렀을 때는
//    텍스트·숫자·거래처·담당자 등 컬럼 형식을 고를 수 있고 라벨도 추가할 수 있게."
//
// 설계
//   · 처음 여는 자리(표가 하나도 없을 때)는 화면 안에 그대로 깔고(inline),
//     이미 표가 있는데 더 붙일 때는 팝업으로 띄운다 — 보던 표가 사라지면 안 된다.
//   · 만들기 전까지는 아무것도 저장하지 않는다. 취소하면 흔적이 남지 않는다.
//   · 형식 목록은 project-boards 의 COL_FORMATS 하나만 본다(표 머리의 ＋ 와 같은 목록).

import { useState } from "react";
import {
  BOARD_TEMPLATES, ITEM_LABEL, COL_FORMATS, DEFAULT_STATUS_OPTIONS, LABEL_COLORS, newOptionId,
  type ColumnDef, type ColType, type StatusOption,
} from "@/lib/project-boards";
import type { Preset } from "@/lib/board-presets";

type Draft = { key: string; name: string; type: ColType; unit: string; options: StatusOption[] };

let seq = 0;
const draftKey = () => `c${++seq}`;
const nameOfFormat = (t: ColType) => COL_FORMATS.find((f) => f.type === t)?.label || "칸";

function newDraft(type: ColType): Draft {
  return {
    key: draftKey(), name: nameOfFormat(type), type, unit: type === "number" ? "원" : "",
    options: type === "status" ? DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o })) : [],
  };
}

export function BoardNewModal({ inline, busy, presets, onPick, onCustom, onUsePreset, onRemovePreset, onClose }: {
  /** 표가 하나도 없을 때 — 팝업이 아니라 화면에 그대로 깐다 */
  inline?: boolean;
  busy: boolean;
  /** 회사 양식 — 우리 회사가 저장해 둔 칸 구성 */
  presets: Preset[];
  onPick: (key: string) => void;
  onCustom: (name: string, columns: ColumnDef[], saveToCompany: boolean) => void;
  onUsePreset: (p: Preset) => void;
  onRemovePreset: (p: Preset) => void;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<"ready" | "custom">("ready");
  const [name, setName] = useState("");
  const [saveToCompany, setSaveToCompany] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft("status"), newDraft("person"), newDraft("date")]);

  const patch = (key: string, next: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...next } : d)));
  // 형식을 바꾸면 그 형식에 맞는 기본값으로 갈아끼운다 — 이름은 손대지 않은 경우에만
  const changeType = (d: Draft, type: ColType) =>
    patch(d.key, {
      type,
      name: d.name === nameOfFormat(d.type) ? nameOfFormat(type) : d.name,
      unit: type === "number" ? d.unit || "원" : "",
      options: type === "status" ? (d.options.length ? d.options : DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o }))) : [],
    });

  const build = () => {
    const columns: ColumnDef[] = drafts
      .map((d) => {
        const nm = d.name.trim() || nameOfFormat(d.type);
        if (d.type === "status") {
          const options = d.options.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() }));
          return { name: nm, type: d.type, settings: { options: options.length ? options : DEFAULT_STATUS_OPTIONS } };
        }
        if (d.type === "number") return { name: nm, type: d.type, settings: d.unit.trim() ? { unit: d.unit.trim() } : {} };
        return { name: nm, type: d.type };
      });
    onCustom(name.trim() || "새 템플릿", columns, saveToCompany);
  };

  const body = (
    <div className="pb-pick">
      <div className="pb-pick-head">
        <b>{inline ? "어떤 템플릿으로 시작할까요?" : "템플릿 추가"}</b>
        <span>부서가 아니라 <b>일의 형태</b>로 고릅니다 · 나중에 얼마든지 더 붙일 수 있어요</span>
        {onClose && <button type="button" className="pb-pick-close" onClick={onClose}>닫기</button>}
      </div>

      <div className="pb-pick-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "ready"}
          className={`pb-pick-tab ${tab === "ready" ? "pb-pick-tab-on" : ""}`} onClick={() => setTab("ready")}>
          기본 양식
        </button>
        <button type="button" role="tab" aria-selected={tab === "custom"}
          className={`pb-pick-tab ${tab === "custom" ? "pb-pick-tab-on" : ""}`} onClick={() => setTab("custom")}>
          직접 만들기
        </button>
      </div>

      {tab === "ready" ? (<>
        {presets.length > 0 && (
          <div className="pb-presets">
            <b className="pb-presets-h">회사 양식 <em>우리 회사가 저장해 둔 구성</em></b>
            <div className="pb-tpls">
              {presets.map((p) => (
                <div key={p.id} className="pb-tpl pb-tpl-preset">
                  <button type="button" className="pb-tpl-main" disabled={busy} onClick={() => onUsePreset(p)}>
                    <b>{p.name}</b>
                    <span>{(p.payload?.columns || []).length}칸</span>
                    <span className="pb-tpl-cols">
                      {["이름", ...(p.payload?.columns || []).map((c: ColumnDef) => c.name)].slice(0, 6).map((n: string, i: number) => (
                        <i key={`${n}-${i}`}>{n}</i>
                      ))}
                      {(p.payload?.columns || []).length + 1 > 6 && (
                        <i className="pb-tpl-more">+{(p.payload?.columns || []).length + 1 - 6}</i>
                      )}
                    </span>
                  </button>
                  <button type="button" className="pb-tpl-del" title="회사 양식에서 빼기"
                    onClick={() => onRemovePreset(p)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="pb-tpls">
          {BOARD_TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="pb-tpl" disabled={busy} onClick={() => onPick(t.key)}>
              <b>{t.name}</b>
              <span>{t.desc}</span>
              <em>{t.uses}</em>
              {/* 무슨 칸이 생기는지 미리 보여준다 — 이름보다 이게 고르는 기준이다 */}
              <span className="pb-tpl-cols">
                {[ITEM_LABEL[t.key] || "이름", ...t.columns.map((c) => c.name)].slice(0, 6).map((n) => (
                  <i key={n}>{n}</i>
                ))}
                {t.columns.length + 1 > 6 && <i className="pb-tpl-more">+{t.columns.length + 1 - 6}</i>}
              </span>
            </button>
          ))}
          <button type="button" className="pb-tpl pb-tpl-blank" disabled={busy} onClick={() => onPick("blank")}>
            <b>빈 템플릿</b>
            <span>컬럼을 직접 만들어 씁니다</span>
            <em>위 형태에 안 맞는 일</em>
          </button>
        </div>
      </>) : (
        <div className="pb-build">
          <label className="pb-build-name">
            <span>템플릿 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 시공 관리 · 재고 실사" />
          </label>

          <div className="pb-build-cols">
            <b className="pb-build-h">칸 <em>첫 칸(이름)은 자동으로 생깁니다</em></b>
            {drafts.map((d) => (
              <div key={d.key} className="pb-build-row">
                <div className="pb-build-line">
                  <input className="pb-build-cname" value={d.name} placeholder="칸 이름"
                    onChange={(e) => patch(d.key, { name: e.target.value })} />
                  <select className="pb-build-type" value={d.type} aria-label="형식"
                    onChange={(e) => changeType(d, e.target.value as ColType)}>
                    {COL_FORMATS.map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
                  </select>
                  {d.type === "number" && (
                    <input className="pb-build-unit" value={d.unit} placeholder="단위"
                      onChange={(e) => patch(d.key, { unit: e.target.value })} />
                  )}
                  <button type="button" className="pb-build-x" title="이 칸 빼기"
                    onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}>✕</button>
                </div>
                <em className="pb-build-hint">{COL_FORMATS.find((f) => f.type === d.type)?.hint}</em>
                {d.type === "status" && (
                  <LabelEditor options={d.options} onChange={(options) => patch(d.key, { options })} />
                )}
              </div>
            ))}
            <div className="pb-build-add">
              {COL_FORMATS.map((f) => (
                <button key={f.type} type="button" title={f.hint}
                  onClick={() => setDrafts((prev) => [...prev, newDraft(f.type)])}>＋ {f.label}</button>
              ))}
            </div>
          </div>

          <div className="pb-build-foot">
            {/* 회사 양식으로 남겨 두면 다른 프로젝트에서도 이 구성으로 시작할 수 있다 */}
            <label className="pb-build-save">
              <input type="checkbox" checked={saveToCompany} onChange={(e) => setSaveToCompany(e.target.checked)} />
              회사 양식으로 저장
            </label>
            {onClose && <button type="button" className="pb-build-cancel" onClick={onClose}>취소</button>}
            <button type="button" className="pb-build-go" disabled={busy || drafts.length === 0} onClick={build}>
              이 템플릿 만들기
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (inline) return body;
  return (
    <div className="pb-doc-modal" onClick={onClose}>
      <div className="pb-doc-box pb-pick-box" onClick={(e) => e.stopPropagation()}>{body}</div>
    </div>
  );
}

/** 라벨 편집 — 상태 칸이 무엇 중에서 고르는 칸인지 정한다. 이름·색·순서를 여기서 다 만진다. */
export function LabelEditor({ options, onChange, note }: {
  options: StatusOption[]; onChange: (next: StatusOption[]) => void; note?: string;
}) {
  const [openColor, setOpenColor] = useState<string | null>(null);
  const set = (id: string, next: Partial<StatusOption>) =>
    onChange(options.map((o) => (o.id === id ? { ...o, ...next } : o)));

  return (
    <div className="pb-labels">
      {options.map((o, i) => (
        <div key={o.id} className="pb-label">
          <span className="pb-label-color">
            <button type="button" style={{ background: o.color }} title="색 바꾸기" aria-label={`${o.label} 색`}
              onClick={() => setOpenColor((v) => (v === o.id ? null : o.id))} />
            {openColor === o.id && (<>
              <span className="pb-menu-veil" onClick={() => setOpenColor(null)} />
              <span className="pb-label-colors">
                {LABEL_COLORS.map((c) => (
                  <button key={c} type="button" style={{ background: c }} aria-label={c}
                    onClick={() => { set(o.id, { color: c }); setOpenColor(null); }} />
                ))}
              </span>
            </>)}
          </span>
          <input value={o.label} placeholder="라벨 이름" onChange={(e) => set(o.id, { label: e.target.value })} />
          <button type="button" className="pb-label-move" title="위로" disabled={i === 0}
            onClick={() => { const n = [...options]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>↑</button>
          <button type="button" className="pb-label-x" title="이 라벨 빼기"
            onClick={() => onChange(options.filter((x) => x.id !== o.id))}>✕</button>
        </div>
      ))}
      <button type="button" className="pb-label-add"
        onClick={() => onChange([...options, { id: newOptionId(options), label: "", color: LABEL_COLORS[0] }])}>
        ＋ 라벨 추가
      </button>
      {note && <em className="pb-label-note">{note}</em>}
    </div>
  );
}
