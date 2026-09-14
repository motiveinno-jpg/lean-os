//   공휴일 한 벌 — 근무일 판정(근태·급여·연차)이 보는 '쉬는 날'을 한 곳에서 정한다.
//
//   예전엔 회사 holidays 표만 봤다. 그 표는 사람이 손으로 넣어야 하고, '법정공휴일 일괄
//   추가' 버튼도 양력 8개(신정·삼일절·어린이날·현충일·광복절·개천절·한글날·성탄절)만
//   넣어서 추석·설날 같은 음력 명절과 대체휴일이 통째로 빠졌다. 그래서 회사가 손으로 안
//   넣으면 근태에서 추석이 근무일로 잡혔다.
//
//   이제 전국 공휴일은 national_holidays(공공데이터포털 특일정보, 매년 자동)가 채우고,
//   회사가 따로 지정한 임시휴무만 회사 holidays 표에 남는다. 이 함수가 둘을 합쳐
//   '쉬는 날' 집합을 준다 — 달력(useCompanyHolidays)과 같은 소스를 근무일 판정도 본다.

type Client = {
  from: (t: string) => {
    select: (c: string) => {
      gte: (k: string, v: string) => {
        lte: (k: string, v: string) => Promise<{ data: unknown; error: unknown }> & {
          eq: (k: string, v: string) => { gte: (k: string, v: string) => { lte: (k: string, v: string) => Promise<{ data: unknown; error: unknown }> } };
        };
      };
      eq: (k: string, v: string) => {
        gte: (k: string, v: string) => { lte: (k: string, v: string) => Promise<{ data: unknown; error: unknown }> };
      };
    };
  };
};

/** 회사 지정 휴일 + 전국 공휴일을 합쳐 "YYYY-MM-DD" 집합으로. 조회 실패는 빈 쪽으로 넘어간다. */
export async function fetchHolidayDates(
  client: Client,
  companyId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const set = new Set<string>();
  const [nat, comp] = await Promise.all([
    (client.from("national_holidays") as any).select("date").gte("date", lo).lte("date", hi),
    companyId
      ? (client.from("holidays") as any).select("date").eq("company_id", companyId).gte("date", lo).lte("date", hi)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of ((nat as { data?: { date: string }[] }).data) || []) set.add(String(r.date).slice(0, 10));
  for (const r of ((comp as { data?: { date: string }[] }).data) || []) set.add(String(r.date).slice(0, 10));
  return set;
}
