// 계정 일괄 지정 — 엑셀로 내려받아 계정과목만 채워 되올린다 (2026-08-13 사장님 승인)
//
//   왜 만드나: 통장 미처리 852건 중 계정이 아직 없는 줄이 526건이다. 화면에서 하나씩 고르는 것보다
//   엑셀에서 채우는 게 압도적으로 빠르다. **새로 만드는 게 아니라 있는 줄을 채우는 것**이라
//   중복 위험이 없다 — 이게 여러 올리기 후보 중 이걸 먼저 하는 이유다.
//
//   ★ 무엇을 기준으로 줄을 알아보나 = **id**. 그래서 파일 첫 칸이 id 이고, 그 칸은 건드리면 안 된다.
//     지우거나 고친 줄은 조용히 넘기지 않고 **실패로 보고**한다.
//   ★ 되올려도 **전표가 생기지는 않는다.** 화면의 계정 칸이 채워질 뿐이고, 확정은 사람이
//     '전표 만들기'를 눌러야 한다 (제안은 자동, 확정은 사람).
//
//   계정과목은 `830 소모품비` · `830` · `소모품비` 셋 다 받는다 — 사람은 셋 다 친다.

import * as XLSX from "xlsx";

export type AcctOpt = { code: string; name: string };

/** 파일에서 사람이 채울 칸 이름 — 내려받기와 올리기가 같은 이름을 봐야 한다 */
export const FILL_COL = "계정과목";
export const ID_COL = "id (건드리지 마세요)";

export type FillRow = {
  id: string;
  date: string;
  who: string;
  memo: string;
  amount: number;
  /** 이미 붙어 있는 계정 — 있으면 채워서 내려보낸다(바꾸고 싶을 때 참고) */
  acct?: string;
};

/**
 * 채우기 양식 내려받기 — 두 장짜리 파일.
 *   1장 '계정 채우기' : 채울 줄 + 빈 계정과목 칸
 *   2장 '계정과목'   : 코드·이름 전체 (복사해 붙이라고)
 */
export function downloadAccountFillSheet(rows: FillRow[], accounts: AcctOpt[], fileName: string) {
  const main = rows.map((r) => ({
    [ID_COL]: r.id,
    "일자": r.date,
    "거래처": r.who,
    "적요": r.memo,
    "금액": r.amount,
    [FILL_COL]: r.acct ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(main);
  //   칸 너비 — 안 주면 id 가 ###### 로 보여 "뭔가 잘못됐나" 하게 된다
  (ws as any)["!cols"] = [{ wch: 38 }, { wch: 12 }, { wch: 24 }, { wch: 28 }, { wch: 14 }, { wch: 20 }];
  //   ★ '붙여넣기용' 칸을 같이 준다 — 이 계정과목표에는 **같은 이름이 여럿**이다
  //     (소모품비 530·630·730·830 / 광고선전비 636·833 …). 이름만 적으면 어느 것인지 못 고른다.
  //     칸 하나를 통째로 복사하면 코드까지 딸려 가 헷갈릴 일이 없다.
  const ws2 = XLSX.utils.json_to_sheet(accounts.map((a) => ({
    "코드": a.code, "계정과목": a.name, "붙여넣기용": `${a.code} ${a.name}`,
  })));
  (ws2 as any)["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "계정 채우기");
  XLSX.utils.book_append_sheet(wb, ws2, "계정과목");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export type FillParsed = {
  /** id → 계정 코드 */
  picks: { id: string; code: string }[];
  /** 사람이 읽을 실패 사유 (줄 번호 포함) */
  fails: string[];
  /** 계정 칸이 비어 그냥 넘긴 줄 수 — 실패가 아니다 */
  blank: number;
};

/** 되올린 파일 읽기 — 무엇이 안 됐는지 **줄 번호로** 알려 준다 */
export async function parseAccountFill(file: File, accounts: AcctOpt[]): Promise<FillParsed> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets["계정 채우기"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  //   이름이 겹치는 계정이 있으면 이름만으로는 못 고른다 — 코드로 적어 달라고 해야 한다
  const byCode = new Map(accounts.map((a) => [String(a.code), a]));
  const nameCount = new Map<string, number>();
  for (const a of accounts) nameCount.set(a.name, (nameCount.get(a.name) ?? 0) + 1);
  const byName = new Map(accounts.filter((a) => nameCount.get(a.name) === 1).map((a) => [a.name, a]));

  const picks: { id: string; code: string }[] = [];
  const fails: string[] = [];
  let blank = 0;

  rows.forEach((raw, i) => {
    const line = i + 2;   // 엑셀 줄 번호 (머리글이 1줄)
    const id = String(raw[ID_COL] ?? raw["id"] ?? "").trim();
    const want = String(raw[FILL_COL] ?? "").trim();
    if (!want) { blank += 1; return; }
    if (!id) { fails.push(`${line}줄: id 칸이 비었습니다 (양식의 첫 칸은 지우면 안 됩니다)`); return; }
    //   `830 소모품비` · `830` · `소모품비` 셋 다 받는다
    const head = want.split(/\s+/)[0];
    const hit = byCode.get(head) ?? byName.get(want) ?? byCode.get(want);
    if (!hit) {
      fails.push(nameCount.get(want) && nameCount.get(want)! > 1
        ? `${line}줄: '${want}' 는 같은 이름이 여럿입니다 — 코드로 적어 주세요`
        : `${line}줄: '${want}' 라는 계정과목이 없습니다`);
      return;
    }
    picks.push({ id, code: hit.code });
  });

  return { picks, fails, blank };
}
