"use client";

// 템플릿 추가 — 기본 양식에서 출발해 **우리 회사에 필요한 칸을 계속 붙인다** (2026-08-05 사장님 지시).
//
//   "우리가 템플릿을 기본으로 제공하고, 필요한 컬럼이 있을 수 있으니 계속 추가하는 형태.
//    할 일·진행을 선택하면 라벨 옆에 ＋버튼을 둬서 계속 컬럼을 추가할 수 있게,
//    그걸 회사 커스터마이징 양식으로 저장하고 다른 프로젝트에서 또 쓸 수 있게."
//
// 설계
//   · 기본 양식은 **누르면 바로 만든다**(2026-08-07 사장님 점검: 그대로 쓸 사람이 대부분인데
//     늘 칸 편집 화면을 지나 스크롤 끝의 버튼을 눌러야 했다). 칸을 다듬고 싶으면 카드 안의
//     '＋ 칸 추가' 를 눌러 편집기로 간다 — 다듬기는 선택이지 관문이 아니다.
//   · 회사 양식(이미 다듬어 둔 구성)은 눌러서 바로 만들고, 거기서 더 붙이고 싶으면 '다듬기'.
//   · 어디서 출발했는지(template_key)를 들고 다닌다 — 칸반·타임라인·행 이름 같은 그 양식의 성격이
//     칸을 더 붙여도 그대로 따라온다.
//   · 만들기 전까지는 아무것도 저장하지 않는다. 취소하면 흔적이 남지 않는다.
//   · 형식 목록은 project-boards 의 COL_FORMATS 하나만 본다(표 머리의 ＋ 와 같은 목록).

import { useState } from "react";
import {
  BOARD_TEMPLATES, ITEM_LABEL, COL_FORMATS, DEFAULT_STATUS_OPTIONS, LABEL_COLORS, newOptionId,
  TEMPLATE_SAMPLE, MODE_LABEL,
  type BoardTemplate, type ColumnDef, type ColType, type InputMode, type StatusOption,
} from "@/lib/project-boards";
import type { Preset } from "@/lib/board-presets";

/** 편집 중인 한 칸. flow 는 칸반이 열로 쓰는 단계 칸인지 — 기본 양식에서 물려받으면 유지한다 */
type Draft = { key: string; name: string; type: ColType; unit: string; options: StatusOption[]; flow: boolean;
  /** 광고 표처럼 '이 칸에 무엇을 채울지'가 정해진 칸 — 다듬는 화면을 지나도 안 잃게 그대로 들고 간다
   *  (2026-08-06: 여기서 떨어뜨리면 마케팅 표가 저절로 안 채워진다) */
  ad?: string };
/** 어디서 출발했는지 — 기본 양식 key(없으면 처음부터 짠 것) */
type Base = { key: string | null; name: string };

let seq = 0;
const draftKey = () => `c${++seq}`;
const nameOfFormat = (t: ColType) => COL_FORMATS.find((f) => f.type === t)?.label || "칸";

function newDraft(type: ColType): Draft {
  return {
    key: draftKey(), name: nameOfFormat(type), type, unit: type === "number" ? "원" : "",
    options: type === "status" ? DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o })) : [], flow: false,
  };
}

/** 이미 있는 칸 구성을 편집기로 — 기본 양식·회사 양식 둘 다 이 길로 들어온다 */
function draftsOf(columns: ColumnDef[]): Draft[] {
  return columns.map((c) => ({
    key: draftKey(), name: c.name, type: c.type,
    unit: c.settings?.unit || (c.type === "number" ? "원" : ""),
    options: (c.settings?.options || []).map((o) => ({ ...o })),
    flow: !!c.settings?.flow,
    ad: c.settings?.ad,
  }));
}

export function BoardNewModal({ inline, busy, presets, onCustom, onUsePreset, onRemovePreset, onClose }: {
  /** 표가 하나도 없을 때 — 팝업이 아니라 화면에 그대로 깐다 */
  inline?: boolean;
  busy: boolean;
  /** 회사 양식 — 우리 회사가 저장해 둔 칸 구성 */
  presets: Preset[];
  onCustom: (name: string, columns: ColumnDef[], saveToCompany: boolean, baseKey: string | null) => void;
  onUsePreset: (p: Preset) => void;
  onRemovePreset: (p: Preset) => void;
  onClose?: () => void;
}) {
  // null 이면 고르는 화면, 값이 있으면 다듬는 화면 — 한 흐름의 두 걸음이라 탭이 아니라 단계로 둔다
  const [base, setBase] = useState<Base | null>(null);
  const [name, setName] = useState("");
  const [saveToCompany, setSaveToCompany] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  //   마우스를 올린 템플릿의 예시 화면 — 카드 옆에 띄운다(2026-08-07 사장님 지시).
  //   위치를 그때그때 재서 화면 밖으로 안 나가게 한다(모달 안이라 잘릴 수 있다).
  const [peek, setPeek] = useState<{ t: BoardTemplate; x: number; y: number; flip: boolean } | null>(null);
  const showPeek = (t: BoardTemplate, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const W = 420, GAP = 12;
    const flip = r.right + GAP + W > window.innerWidth;         // 오른쪽이 좁으면 왼쪽에 띄운다
    setPeek({
      t,
      x: flip ? Math.max(GAP, r.left - GAP - W) : r.right + GAP,
      y: Math.min(Math.max(GAP, r.top), Math.max(GAP, window.innerHeight - 320)),
      flip,
    });
  };

  const startFrom = (b: Base, columns: ColumnDef[]) => {
    setBase(b);
    setName(b.name);
    setDrafts(draftsOf(columns));
    setSaveToCompany(false);
    setAddOpen(false);
  };
  const startBlank = () => {
    setBase({ key: null, name: "직접 만들기" });
    setName("");
    setDrafts([newDraft("status"), newDraft("person"), newDraft("date")]);
    setSaveToCompany(false);
    setAddOpen(false);
  };

  const patch = (key: string, next: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...next } : d)));
  // 형식을 바꾸면 그 형식에 맞는 기본값으로 갈아끼운다 — 이름은 손대지 않은 경우에만
  const changeType = (d: Draft, type: ColType) =>
    patch(d.key, {
      type,
      name: d.name === nameOfFormat(d.type) ? nameOfFormat(type) : d.name,
      unit: type === "number" ? d.unit || "원" : "",
      options: type === "status" ? (d.options.length ? d.options : DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o }))) : [],
      flow: type === "status" ? d.flow : false,   // 상태가 아니면 단계 칸일 수 없다
    });

  const build = () => {
    const columns: ColumnDef[] = drafts.map((d) => {
      const nm = d.name.trim() || nameOfFormat(d.type);
      const ad = d.ad ? { ad: d.ad } : {};
      if (d.type === "status") {
        const options = d.options.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() }));
        return {
          name: nm, type: d.type,
          settings: { options: options.length ? options : DEFAULT_STATUS_OPTIONS, ...(d.flow ? { flow: true } : {}), ...ad },
        };
      }
      if (d.type === "number") return { name: nm, type: d.type, settings: { ...(d.unit.trim() ? { unit: d.unit.trim() } : {}), ...ad } };
      return { name: nm, type: d.type, settings: ad };
    });
    onCustom(name.trim() || base?.name || "새 템플릿", columns, saveToCompany, base?.key ?? null);
  };

  const head = (
    <div className="pb-pick-head">
      <b>{base ? "칸을 다듬고 만듭니다" : inline ? "어떤 템플릿으로 시작할까요?" : "템플릿 추가"}</b>
      <span>
        {base
          ? <>필요한 칸을 <b>＋</b>로 계속 붙이세요 · 그대로 써도 됩니다</>
          : <>부서가 아니라 <b>일의 형태</b>로 고릅니다 · 누르면 바로 만들어져요(칸을 먼저 다듬으려면 <b>＋칸</b>)</>}
      </span>
      {onClose && <button type="button" className="pb-pick-close" onClick={onClose}>닫기</button>}
    </div>
  );

  const pickBody = (
    <>
      {presets.length > 0 && (
        <div className="pb-presets">
          <b className="pb-presets-h">회사 양식 <em>우리 회사가 저장해 둔 구성 — 다른 프로젝트에서도 그대로</em></b>
          <div className="pb-tpls">
            {presets.map((p) => {
              const pcols = (p.payload?.columns || []) as ColumnDef[];
              const from = BOARD_TEMPLATES.find((t) => t.key === p.template_key);
              return (
                <div key={p.id} className="pb-tpl pb-tpl-preset">
                  <button type="button" className="pb-tpl-main" disabled={busy} onClick={() => onUsePreset(p)}>
                    <b>{p.name}</b>
                    <span>{pcols.length}칸{from ? ` · ${from.name} 기반` : ""}</span>
                    <span className="pb-tpl-cols">
                      {["이름", ...pcols.map((c) => c.name)].slice(0, 6).map((n: string, i: number) => (
                        <i key={`${n}-${i}`}>{n}</i>
                      ))}
                      {pcols.length + 1 > 6 && <i className="pb-tpl-more">+{pcols.length + 1 - 6}</i>}
                    </span>
                  </button>
                  {/* 회사 양식에도 칸을 더 붙일 수 있다 — 다듬어 만들면 원본은 그대로 남는다 */}
                  <button type="button" className="pb-tpl-edit" title="칸을 더 붙여서 만들기"
                    onClick={() => startFrom({ key: p.template_key || null, name: p.name }, pcols)}>＋칸</button>
                  <button type="button" className="pb-tpl-del" title="회사 양식에서 빼기"
                    onClick={() => onRemovePreset(p)}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="pb-presets">
        <b className="pb-presets-h">기본 양식 <em>고르면 칸을 다듬는 화면으로 갑니다</em></b>
        <div className="pb-tpls">
          {BOARD_TEMPLATES.map((t) => (
            <div key={t.key} className="pb-tpl pb-tpl-pick"
              onMouseEnter={(e) => showPeek(t, e.currentTarget)}
              onMouseLeave={() => setPeek((p) => (p?.t.key === t.key ? null : p))}>
              {/*  누르면 바로 만든다 — 그대로 쓰는 게 대부분이다 */}
              <button type="button" className="pb-tpl-main" disabled={busy}
                onFocus={(e) => showPeek(t, e.currentTarget.parentElement as HTMLElement)}
                onBlur={() => setPeek(null)}
                onClick={() => onCustom(t.name, t.columns, false, t.key)}>
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
              {/*  다듬고 싶을 때만 편집기로 — 광고 표는 칸을 다듬어도 쓰이지 않으므로 아예 안 띄운다
                   (값을 사람이 넣지 않고 매체에서 받아 온다) */}
              {t.key !== "ads" && (
                <button type="button" className="pb-tpl-edit" title="칸을 더 붙여서 만들기" disabled={busy}
                  onClick={() => startFrom({ key: t.key, name: t.name }, t.columns)}>＋칸</button>
              )}
            </div>
          ))}
          <button type="button" className="pb-tpl pb-tpl-blank" disabled={busy} onClick={startBlank}>
            <b>직접 만들기</b>
            <span>빈 칸에서 시작해 하나씩 붙입니다</span>
            <em>위 형태에 안 맞는 일</em>
          </button>
        </div>
      </div>
      {peek && <TemplatePeek t={peek.t} x={peek.x} y={peek.y} />}
    </>
  );

  const editBody = base && (
    <div className="pb-build">
      <div className="pb-build-from">
        <button type="button" className="pb-build-back" onClick={() => setBase(null)}>← 다른 양식 고르기</button>
        <b>{base.name}</b>
        {base.key && <em>이 양식의 성격(칸반·행 이름)은 그대로 따라옵니다</em>}
      </div>

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
              {d.flow && <em className="pb-build-flow" title="칸반이 이 칸의 라벨을 열로 씁니다">단계</em>}
              <button type="button" className="pb-build-x" title="이 칸 빼기"
                onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}>✕</button>
            </div>
            <em className="pb-build-hint">{COL_FORMATS.find((f) => f.type === d.type)?.hint}</em>
            {d.type === "status" && (
              <LabelEditor options={d.options} onChange={(options) => patch(d.key, { options })} />
            )}
          </div>
        ))}
        {/* 칸 추가 — 라벨(칸 목록) 바로 아래 ＋ 하나. 누르면 형식을 고른다 */}
        <div className="pb-build-addwrap">
          <button type="button" className="pb-build-addbtn" aria-expanded={addOpen}
            onClick={() => setAddOpen((v) => !v)}>＋ 칸 추가</button>
          {addOpen && (<>
            <span className="pb-menu-veil" onClick={() => setAddOpen(false)} />
            <span className="pb-build-formats">
              {COL_FORMATS.map((f) => (
                <button key={f.type} type="button"
                  onClick={() => { setDrafts((prev) => [...prev, newDraft(f.type)]); setAddOpen(false); }}>
                  <b>{f.label}</b>
                  <em>{f.hint}</em>
                </button>
              ))}
            </span>
          </>)}
        </div>
      </div>

      <div className="pb-build-foot">
        {/* 회사 양식으로 남겨 두면 다른 프로젝트에서도 이 구성으로 시작할 수 있다 */}
        <label className="pb-build-save">
          <input type="checkbox" checked={saveToCompany} onChange={(e) => setSaveToCompany(e.target.checked)} />
          회사 양식으로 저장 <em>다른 프로젝트에서도 이 구성으로</em>
        </label>
        {onClose && <button type="button" className="pb-build-cancel" onClick={onClose}>취소</button>}
        <button type="button" className="pb-build-go" disabled={busy || drafts.length === 0} onClick={build}>
          이 구성으로 만들기
        </button>
      </div>
    </div>
  );

  const body = <div className="pb-pick">{head}{base ? editBody : pickBody}</div>;

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

/** 템플릿 예시 화면 — 마우스를 올리면 "이게 무슨 표인지"를 글이 아니라 **모양**으로 보여 준다
 *  (2026-08-07 사장님 지시). 자리는 부모가 재서 넘긴다(모달 안에서 잘리지 않게 화면 좌표로).
 *
 *  ⚠️ 첫 화면과 **같은 모양**이어야 한다. 템플릿마다 첫 화면이 달라졌으므로(회의록·접수함·만기·
 *     지출 입력·건별·캘린더) 예시도 그 모양으로 그린다 — "회의록으로 열려요" 라고 적어 놓고
 *     표를 보여 주면 그 자체가 거짓말이다(2026-08-07 사장님: "예시가 안 바뀌었다").
 */
function TemplatePeek({ t, x, y }: { t: BoardTemplate; x: number; y: number }) {
  const rows = TEMPLATE_SAMPLE[t.key] || [];
  const heads = [ITEM_LABEL[t.key] || "이름", ...t.columns.map((c) => c.name)];
  const mode: InputMode = t.input || "grid";
  //   조사 — 받침이 있으면 '으로'(회의록**으로**), 없거나 ㄹ 받침이면 '로'(캘린더**로**)
  const ro = (w: string) => {
    const c = w.charCodeAt(w.length - 1);
    if (Number.isNaN(c) || c < 0xac00 || c > 0xd7a3) return "로";
    const jong = (c - 0xac00) % 28;
    return jong === 0 || jong === 8 ? "로" : "으로";
  };
  //   상태 칸은 그 템플릿에 정의된 라벨 색을 그대로 찾아 쓴다 — 예시가 실제와 같은 색이어야 한다
  const colorOf = (colIdx: number, text: string) => {
    const col = t.columns[colIdx - 1];
    if (!col || col.type !== "status") return null;
    const opt = ((col.settings?.options || []) as StatusOption[]).find((o) => o.label === text);
    return opt?.color || null;
  };
  const isNum = (colIdx: number) => t.columns[colIdx - 1]?.type === "number";
  //   예시 값은 **칸 형식**으로 집는다 — 회사가 칸 이름을 바꿔도 예시가 안 깨진다
  const idxOf = (pred: (c: ColumnDef) => boolean) => {
    const i = t.columns.findIndex(pred);
    return i < 0 ? -1 : i + 1;                    // 0 번 자리는 행 이름
  };
  const flowIdx = idxOf((c) => c.type === "status" && !!c.settings?.flow);
  const personIdx = idxOf((c) => c.type === "person");
  const dateIdx = idxOf((c) => c.type === "date");
  const lastDateIdx = (() => {
    const ds = t.columns.map((c, i) => (c.type === "date" ? i + 1 : -1)).filter((i) => i > 0);
    return ds.length ? ds[ds.length - 1] : -1;
  })();
  const textIdx = idxOf((c) => c.type === "text");
  const moneyIdx = idxOf((c) => c.type === "number" && (c.settings?.unit || "") === "원");
  const partnerIdx = idxOf((c) => c.type === "partner");
  const cell = (r: string[], i: number) => (i > 0 ? r[i] || "" : "");
  const flowColor = (label: string) => (flowIdx > 0 ? colorOf(flowIdx, label) : null) || "var(--text-dim)";

  const body = (() => {
    if (t.key === "ads") {
      return (
        <div className="pb-peek-ads">
          {[["노출", "21,588회"], ["클릭", "365회"], ["광고비", "678,184원"], ["전환", "66건"]].map(([k, v]) => (
            <div key={k} className="pb-peek-kpi"><span>{k}</span><b>{v}</b></div>
          ))}
          <div className="pb-peek-bars">
            {[38, 62, 45, 80, 55, 92, 70].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          </div>
          <p className="pb-peek-note">광고 계정을 연결하면 캠페인·광고그룹·소재까지 저절로 채워집니다.</p>
        </div>
      );
    }

    if (mode === "board" && flowIdx > 0) {
      return (
        <div className="pb-peek-kan">
          {((t.columns[flowIdx - 1].settings?.options || []) as StatusOption[]).map((o) => {
            const cards = rows.filter((r) => r[flowIdx] === o.label);
            return (
              <div key={o.id} className="pb-peek-kcol">
                <div className="pb-peek-khead"><i style={{ background: o.color }} />{o.label}<em>{cards.length}</em></div>
                {cards.map((r, i) => (
                  <div key={i} className="pb-peek-kcard">
                    <b>{r[0]}</b>
                    <span>{cell(r, personIdx)}{cell(r, dateIdx) ? ` · ${cell(r, dateIdx)}` : ""}</span>
                  </div>
                ))}
                {cards.length === 0 && <div className="pb-peek-kempty">＋</div>}
              </div>
            );
          })}
        </div>
      );
    }

    if (mode === "minutes") {
      return (
        <div className="pb-peek-min">
          <div className="pb-peek-minhead"><b>8/7 주간회의</b><em>안건 {rows.length}건</em></div>
          {rows.slice(0, 2).map((r, i) => (
            <div key={i} className="pb-peek-mincard">
              <div className="pb-peek-mint">
                <span className="pb-peek-chip" style={{ background: flowColor(cell(r, flowIdx)) }}>{cell(r, flowIdx)}</span>
                <b>{r[0]}</b>
              </div>
              <p>{cell(r, textIdx)}</p>
              <div className="pb-peek-minfoot">
                <span className="pb-peek-minwho">
                  {cell(r, personIdx)}{cell(r, lastDateIdx) ? ` · ${cell(r, lastDateIdx)}까지` : ""}
                </span>
                <span className="pb-peek-minsend">할 일로 보내기</span>
              </div>
            </div>
          ))}
          <div className="pb-peek-addline">＋ 안건을 적고 Enter</div>
        </div>
      );
    }

    if (mode === "inbox") {
      const dues = ["오늘까지", "D-2", "D-6"];
      const dots = ["var(--danger)", "var(--warning)", "var(--text-dim)"];
      return (
        <div className="pb-peek-inbox">
          <div className="pb-peek-itabs">
            <span className="on">내게 온 요청 {rows.length}</span><span>내가 낸 요청</span><span>끝난 요청</span>
          </div>
          {rows.slice(0, 3).map((r, i) => (
            <div key={i} className="pb-peek-irow">
              <i style={{ background: dots[i] }} />
              <span className="pb-peek-it">
                <b>{r[0]}</b>
                <em>{cell(r, personIdx)} 요청 · {cell(r, flowIdx)}</em>
              </span>
              <span className="pb-peek-idue">{dues[i]}</span>
              <span className="pb-peek-iact">넘기기</span>
            </div>
          ))}
          <div className="pb-peek-addline">＋ 요청 넣기 — 담당·기한만 고르면 끝</div>
        </div>
      );
    }

    if (mode === "calendar") {
      const bars = [
        { row: 0, from: 1, to: 4, label: rows[0]?.[0] || "일정", color: "var(--viz-1)" },
        { row: 1, from: 2, to: 6, label: rows[1]?.[0] || "일정", color: "var(--viz-3)" },
      ];
      return (
        <div>
          <div className="pb-peek-cal">
            {["월", "화", "수", "목", "금", "토", "일"].map((w) => <span key={w} className="pb-peek-cdow">{w}</span>)}
            {Array.from({ length: 21 }, (_, i) => {
              const row = Math.floor(i / 7), col = i % 7;
              const bar = bars.find((b) => b.row === row && col === b.from);
              return (
                <span key={i} className="pb-peek-cday">
                  {i + 3}
                  {bar && (
                    <i className="pb-peek-cbar" style={{ background: bar.color, width: `calc(${bar.to - bar.from + 1}00% + ${(bar.to - bar.from) * 3}px)` }}>
                      {bar.label}
                    </i>
                  )}
                </span>
              );
            })}
          </div>
          <p className="pb-peek-note">빈 칸을 끌면 그 자리에 일정이 생깁니다 — 이름만 적으면 끝</p>
        </div>
      );
    }

    if (mode === "expiry") {
      const ddays = ["D-21 · 갱신 결정 필요", "D-96"];
      return (
        <div className="pb-peek-exp">
          {rows.slice(0, 2).map((r, i) => (
            <div key={i} className={`pb-peek-expcard ${i === 0 ? "pb-peek-urgent" : ""}`}>
              <span className={`pb-peek-dday ${i === 0 ? "pb-peek-dday-warn" : ""}`}>{ddays[i]}</span>
              <b>{r[0]}</b>
              <em>{cell(r, partnerIdx)} · {cell(r, lastDateIdx)} 만기</em>
              <span className="pb-peek-expamt">{cell(r, moneyIdx)}원</span>
              <span className="pb-peek-expgo">{i === 0 ? "계약서 만들기" : "계약서 열기"}</span>
            </div>
          ))}
        </div>
      );
    }

    if (mode === "expense") {
      return (
        <div className="pb-peek-exn">
          <div className="pb-peek-gauge">
            <span>예산 <b>10,200,000원</b> 중 <b>7,480,000원</b> 집행</span>
            <i><em style={{ width: "73%" }} /></i>
            <span>남은 <b>2,720,000원</b> · 73%</span>
          </div>
          <div className="pb-peek-exnquick">
            <span>무엇에 썼나요</span><span>거래처</span><span>구분</span><span className="pb-peek-n">금액</span>
            <b>적기</b>
          </div>
          {rows.slice(0, 2).map((r, i) => (
            <div key={i} className="pb-peek-exnrow">
              <b>{r[0]}</b>
              <span className="pb-peek-chip" style={{ background: colorOf(1, cell(r, 1)) || "var(--text-dim)" }}>{cell(r, 1)}</span>
              <em>{cell(r, moneyIdx + 1)}원</em>
            </div>
          ))}
        </div>
      );
    }

    if (mode === "deals") {
      const r = rows[0] || [];
      const stages = ((t.columns[flowIdx - 1]?.settings?.options || []) as StatusOption[]);
      const curIdx = stages.findIndex((o) => o.label === cell(r, flowIdx));
      return (
        <div className="pb-peek-deal">
          <div className="pb-peek-dtop">
            <b>{r[0]}</b><em>{cell(r, partnerIdx)}</em><span>{cell(r, moneyIdx)}원</span>
          </div>
          <div className="pb-peek-dsteps">
            {stages.map((o, i) => (
              <span key={o.id} className={`pb-peek-dstep ${i < curIdx ? "pb-peek-done" : i === curIdx ? "pb-peek-now" : ""}`}>
                <i />{o.label}
              </span>
            ))}
          </div>
          <div className="pb-peek-dpay">
            <i><em style={{ width: "33%" }} /></i>
            <span>입금 <b>4,000,000</b> · 잔금 <b>8,000,000</b></span>
          </div>
          <div className="pb-peek-ddocs">
            <span>견적서</span><span className="pb-peek-docon">계약서 만들기</span><span>발행</span>
          </div>
        </div>
      );
    }

    //   표 — 그대로 격자를 채우는 템플릿
    return (
      <div className="pb-peek-tablewrap">
        <table className="pb-peek-table">
          <thead>
            <tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={isNum(i) ? "pb-peek-n" : ""}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {heads.map((_, ci) => {
                  const v = r[ci] || "";
                  const c = colorOf(ci, v);
                  return (
                    <td key={ci} className={isNum(ci) ? "pb-peek-n" : ""}>
                      {c ? <span className="pb-peek-chip" style={{ background: c }}>{v}</span>
                        : ci === 0 ? <b>{v}</b> : v || <span className="pb-peek-dim">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  })();

  return (
    <div className="pb-peek" style={{ left: x, top: y }} role="tooltip" aria-hidden="true">
      <div className="pb-peek-head">
        <b>{t.name}</b>
        <em>{t.key === "ads" ? "입력 없이 대시보드만" : `${MODE_LABEL[mode]}${ro(MODE_LABEL[mode])} 열려요 · 예시`}</em>
      </div>
      {body}
    </div>
  );
}
