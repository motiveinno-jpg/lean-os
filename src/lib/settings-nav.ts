// ── 회사 설정 IA 한 벌 (2026-08-24 사장님 지시: "좌측 사이드바로 메뉴화") ──
//   History: 2026-08-13 사장님이 좌측 네비를 기각했다. 다만 사유는 '왼쪽'이 아니라 **'왼쪽이 두 개'**
//     — 설정 화면 **안에** 또 패널을 두니 앱 사이드바와 겹쳤다(그래서 상단 밴드 → 8-19 상자 안 탭 한 줄).
//     이번엔 화면 안이 아니라 **앱 사이드바 그 자체**에 펴므로 그 사유에 걸리지 않는다.
//   무엇을 기준으로 펴는가 = **그룹 5개**(leaf 13개가 아니라). 사장님이 분석 그룹에서 이미 정한
//     "5개까지만 편다 — 8개를 다 펴면 사이드바가 길어져 오히려 못 찾는다"를 그대로 따른다.
//   그룹 구성은 2026-08-21 사장님 확정판을 그대로 옮긴 것이다(이번에 다시 흔들지 않는다).
//
//   ⚠️ 이 파일이 원본이다. 사이드바(components/sidebar.tsx)·설정 화면(_components/SettingsShell)·
//      옛 주소 리다이렉트(settings/page.tsx)가 전부 여기서 읽는다. 세 곳에 따로 적으면 반드시 어긋난다.
//      lib/permissions.ts(부여 키)·lib/route-labels.ts(제목)만 순환 import 회피용 독립 사전으로 남는다.

export type SettingsLeafKey =
  | "company-info" | "forms"
  | "team"
  | "cash" | "chart" | "closing" | "tax-partner"
  | "api-keys" | "bank"
  | "security" | "delete-company";

export type SettingsGroupKey = "company" | "people" | "finance" | "integration" | "system";

//   perms — 이 항목을 보여주는 부여 키들(구 키 포함 OR). 이미 부여된 옛 세부탭 권한을 계속 존중한다.
//   icon  — 옛 허브 행 아이콘(stroke path). 지금 화면은 쓰지 않지만 지우지 않고 보존한다.
//   title/desc — 화면 설명 줄.
export type SettingsLeaf = {
  key: SettingsLeafKey;
  label: string;
  perms: string[];
  icon: string;
  title: string;
  desc: string;
  masterOnly?: boolean;
  danger?: boolean;
};

export type SettingsGroup = {
  key: SettingsGroupKey;
  label: string;
  route: string;
  icon: string;        // 사이드바 NavIcon 이름
  leaves: SettingsLeaf[];
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    key: "company", label: "회사 기초정보", route: "/settings/company", icon: "settings",
    leaves: [
      { key: "company-info", label: "회사정보", perms: ["company-info"],
        title: "회사정보", desc: "사업자 정보와 직인·로고, 회사 문서를 관리합니다.",
        icon: "M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h2M9 11h2M9 15h2M13 7h2M13 11h2M13 15h2" },
      { key: "forms", label: "회사 양식", perms: ["forms"],
        title: "회사 양식", desc: "회사 공용 PDF 양식을 등록하고 관리합니다.",
        icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6" },
    ],
  },
  {
    //   2026-08-24 사장님 지시 — '근태·가산수당' 을 인사관리로 내보내고 이 그룹은 '구성원·초대' 하나가 됐다.
    //   그래서 그룹 이름도 남은 것과 같게 바꿨다(그릇과 안이 같으면 이름을 두 번 읽히게 하지 않는다).
    //     · 근무시간·휴일 → 근태 관리 › 근무 기준 / 가산수당·수당 카탈로그 → 구성원 › 급여
    //     · 옮긴 이유는 그 값을 읽는 화면이 거기라서다(근태 판정 / 급여대장 금액). TAB_MOVED 가 옛 주소를 받는다.
    key: "people", label: "구성원·초대", route: "/settings/people", icon: "user-cog",
    leaves: [
      { key: "team", label: "구성원·초대", perms: ["team", "departments"],
        title: "구성원·초대", desc: "구성원 초대·합류 요청 승인과 부서를 관리합니다. 메뉴 권한 부여는 구성원 화면에서 합니다.",
        icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
    ],
  },
  {
    key: "finance", label: "회계·세무", route: "/settings/finance", icon: "book",
    leaves: [
      { key: "cash", label: "자금·통장", perms: ["cash"],
        title: "자금·통장", desc: "가용 현금 집계와 미연동 통장, 비용 유형별 지급 통장을 설정합니다.",
        icon: "M2 9h20M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zM6 14h4" },
      { key: "chart", label: "계정과목·분류", perms: ["chart", "deal"],
        title: "계정과목·분류", desc: "장부의 계정과목 체계와 거래 장부의 딜 분류를 관리합니다.",
        icon: "M9 7h6m-6 4h6m-6 4h4M5 3h14a1 1 0 011 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 011-1z" },
      { key: "closing", label: "회계마감", perms: ["closing", "tax"],
        title: "회계마감", desc: "회계 마감시점·기초잔액과 장부 매칭 규칙을 관리합니다.",
        icon: "M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" },
      //   세무 파트너 (2026-08-21) — 회사정보 잡화점에서 떼어 냈다. 장부를 함께 보는 사람이라 회계·세무 그룹.
      //   perms 에 옛 "company-info" 를 함께 둔다 — 회사정보 권한자가 내일 이 화면을 잃지 않게.
      { key: "tax-partner", label: "세무 파트너", perms: ["tax-partner", "company-info"],
        title: "세무 파트너", desc: "제휴 세무사를 연결하고, 우리 장부에서 무엇까지 볼 수 있는지 정합니다.",
        icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
    ],
  },
  {
    //   연동은 **붙이는 방식**으로 가른다 — 인증서(은행연동) / 키(API 키). 2026-08-24.
    key: "integration", label: "연동·API 키", route: "/settings/integration", icon: "link",
    leaves: [
      //   연동·API 키 (2026-08-21 사장님 지시) — 회사가 자기 이름으로 발급받은 인증키를 넣는 곳.
      //   perms 에 기존 "ads" 를 함께 둔다 — 연동 성격 권한을 이미 받은 사람이 내일 못 보는 일이 없게.
      //   탭 이름은 'API 키' — 그릇(그룹)이 이미 '연동·API 키'다. 같은 말을 두 번 읽히게 하지 않는다
      //   (2026-08-13 사장님 원칙: 그릇에 적혀 있으면 안에서는 뺀다). 2026-08-24.
      { key: "api-keys", label: "API 키", perms: ["api-keys", "ads"],
        title: "API 키", desc: "광고 매체·공공기관에서 회사 이름으로 발급받은 키를 등록합니다. 넣는 순간 실제로 한 번 불러 보고, 키는 암호화되어 화면에 다시 나오지 않습니다.",
        icon: "M15 7a5 5 0 11-4.9 6H7v3H4v-3H2l3-3h5.1A5 5 0 0115 7z" },
      { key: "bank", label: "은행연동", perms: ["bank"],
        title: "은행연동", desc: "공동인증서로 은행·카드·홈택스 자동 수집을 연결합니다.",
        icon: "M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" },
      //   광고 계정은 2026-08-24 **API 키 탭으로 합쳤다** (사장님: "광고 계정도 API인데 앞에 API 탭이랑
      //   다른 것도 사용자가 혼동될 수가 있음"). 맞는 말이다 — 광고도 매체에서 받은 키를 넣는 일이다.
      //   이제 이 그룹은 **붙이는 방식**으로 둘로 갈린다: 인증서로 붙이는 것(은행연동) · 키로 붙이는 것(API 키).
      //   옛 주소 ?tab=ads 는 아래 TAB_COMPAT 가 API 키 탭으로 보낸다.
    ],
  },
  {
    //   '시스템' ▶ '보안·시스템' (2026-08-24) — 안에 든 것이 접속 IP·결재 알림·회사 삭제뿐이라
    //   '시스템'만으로는 무엇을 정하는 곳인지 안 읽힌다.
    key: "system", label: "보안·시스템", route: "/settings/system", icon: "shield",
    leaves: [
      //   보안·알림 (2026-08-21) — 접속 허용 IP + 결재 총괄 알림. 둘 다 회사 전체에 걸리는 운영 설정이다.
      //   ※ 결재 총괄 알림은 결재 허브(정책)로 옮기는 것이 더 맞다 — 이번 범위 밖이라 후속으로 남긴다.
      { key: "security", label: "보안·알림", perms: ["security", "company-info"],
        title: "보안·알림", desc: "접속을 허용할 IP와 결재 상신을 받아 볼 총괄 이메일을 정합니다.",
        icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
      //   회사 자체를 지우는 항목 — 권한을 부여받은 멤버에게도 절대 노출하지 않는다(마스터 전용).
      //   되돌릴 수 없는 파괴 동작이라 사이드바에는 올리지 않고 이 화면 맨 끝 붉은 탭으로만 둔다.
      { key: "delete-company", label: "회사 삭제", perms: [], masterOnly: true, danger: true,
        title: "회사 삭제", desc: "회사와 모든 데이터를 영구 삭제합니다. 되돌릴 수 없습니다.",
        icon: "M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m-1 0v14a1 1 0 01-1 1H9a1 1 0 01-1-1V6" },
    ],
  },
];

export const SETTINGS_LEAVES: SettingsLeaf[] = SETTINGS_GROUPS.flatMap((g) => g.leaves);

export function settingsGroup(key: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((g) => g.key === key);
}

export function groupOfLeaf(leaf: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((g) => g.leaves.some((l) => l.key === leaf));
}

//   사이드바 노출 판정용 — 그룹 안 leaf 부여 키 전부(중복 제거).
//   ★ 새 권한 키를 만들지 않는 이유: 새 키는 member_permissions 에 행이 없어 백필 전까지
//     마스터 외 아무에게도 안 보인다(2026-08-21에 실제로 밟은 함정). 그래서 그룹은
//     "안의 leaf 중 하나라도 부여됐으면 보인다"로 판정한다 — 백필 0건.
export function groupPermKeys(g: SettingsGroup): string[] {
  return [...new Set(g.leaves.flatMap((l) => l.perms))].map((p) => `/settings:${p}`);
}

// 옛 ?tab= 딥링크 호환 — 재편 전 키를 leaf 로 매핑. 지우지 않는다(사장님 즐겨찾기·알림 주소가 산다).
export const TAB_COMPAT: Record<string, SettingsLeafKey> = {
  general: "team", company: "company-info", certificate: "bank",
  danger: "delete-company", data: "delete-company",
  departments: "team", deal: "chart", tax: "closing",   // 2026-08-13 탭 통합
  ads: "api-keys",                                      // 2026-08-24 광고 계정 → API 키 탭으로 합침
};

// 다른 화면으로 이관된 옛 키 — 그 주소로 보낸다.
export const TAB_MOVED: Record<string, string> = {
  account: "/mypage", notifications: "/mypage",          // 개인 설정 — 마이페이지로 이관(2026-07-08)
  approval: "/approvals?tab=policies",                    // 결재 정책 — 결재 허브로 일원화(2026-08-12)
  //   근태·가산수당 — 2026-08-24 인사관리로 이관. 출퇴근 기준을 찾아온 사람은 근무 기준으로 보낸다
  //   (가산수당은 구성원 › 급여로 갔지만, 옛 탭 하나를 두 곳으로 보낼 수는 없어 더 자주 찾는 쪽으로 보낸다).
  attendance: "/attendance?view=rules",
  hr_attendance: "/attendance?view=rules",
};

//   옛 /settings?tab=X → 새 /settings/<group>?tab=X. 못 알아보는 값이면 undefined.
export function settingsHrefForTab(rawTab: string): string | undefined {
  const leaf = (SETTINGS_LEAVES.some((l) => l.key === rawTab) ? rawTab : TAB_COMPAT[rawTab]) as SettingsLeafKey | undefined;
  if (!leaf) return undefined;
  const g = groupOfLeaf(leaf);
  return g ? `${g.route}?tab=${leaf}` : undefined;
}
