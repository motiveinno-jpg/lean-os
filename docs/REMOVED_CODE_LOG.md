# 제거된 코드 로그 (복구용)

> 미사용(아무 데서도 import 안 됨)으로 확인되어 제거한 파일 기록.
> **모든 코드는 git 이력에 남아있어 언제든 복구 가능.**
>
> **복구 방법:**
> ```bash
> # 특정 파일을 제거 직전 상태로 복원
> git log --all --full-history --oneline -- <파일경로>   # 제거 커밋 찾기
> git show <제거커밋>~1:<파일경로> > <파일경로>          # 그 직전 버전 복원
> # 또는 통째로
> git checkout <제거커밋>~1 -- <파일경로>
> ```

## 2026-06-04 — 미사용 파일 13개 제거 (속도 최적화 1차)
제거 사유: `src` 전체에서 import 0회 (grep + ts-prune 교차검증). 트리셰이킹으로 번들에는 원래 미포함이라 런타임 영향 없음 — 코드 정리 목적.
제거 커밋: (이 커밋) — 복구 시 `git show <이커밋>~1:<path>`

| 파일 | 줄수 | 용도(추정) |
|---|---|---|
| src/components/program-dashboard.tsx | 1884 | 프로그램(지원사업) 대시보드 위젯 — 미연결 |
| src/components/project-board.tsx | 962 | 구 프로젝트 보드 컴포넌트 |
| src/components/notification-center.tsx | 739 | 구 알림센터(헤더 종 아이콘) — /notifications 페이지로 대체됨 |
| src/lib/tax-forms.ts | 639 | 세무 서식 생성 유틸 — 미연결 |
| src/lib/auto-match.ts | 465 | 구 자동매칭 로직 — 현재 매칭은 다른 경로 |
| src/lib/quote-tracking.ts | 442 | 구 견적 추적 유틸 |
| src/lib/contract-renewal.ts | 398 | 계약 갱신 유틸 — 미연결 |
| src/lib/dashboard-widgets.ts | 259 | 구 대시보드 위젯 정의 |
| src/components/hr-my-allowance-card.tsx | 132 | 구 수당 카드 컴포넌트 |
| src/components/dashboard-financial-hero.tsx | 126 | 구 대시보드 재무 히어로 |
| src/lib/archiving.ts | 89 | 딜 아카이브 유틸 — 미연결 |
| src/components/ui/button.tsx | 44 | 미사용 버튼 컴포넌트 |
| src/lib/calculations.ts | 32 | profitMargin/survivalMonths/vatPreview/formatKRW 등 — 미사용 유틸 |

합계 ~6,311줄. siyan/index.ts 는 사용 중이라 유지.


## 2026-08-18 — 조회 표준(query-kit) 확산 Wave 1 · 거래처
화면 고유 툴바를 공용 부품으로 바꾸며 뺀 것 (다시 만들지 말 것 — 같은 일은 query-kit 이 한다):
- `src/app/(app)/partners/page.tsx`: 자체 검색칸(서버 ilike + 300ms 디바운스), 필터 팝오버(산업/지역/거래규모/태그 select), 더보기 메뉴(휴면 감지·CSV 템플릿·임포트·엑셀), 요약 띠(doc-summary-strip 렌즈), 처리할 것 띠, 다중선택 액션바, 자체 쪽 넘김(20/50/100)
- `globals.css`: `.partner-toolbar`, `.partner-kind-tabs`, `.partner-toolbar-right`, `.partner-search-input`, `.partner-filter-pop`, `.partner-filter-pop-row`, `.partner-filter-pop-row > span`, `.partner-filter-pop-row select`, `.partner-filter-pop-tags`, `.partner-filter-pop-tags > span`, `.partner-filter-pop-tags > div`, `.partner-tag-chip`, `.partner-tag-chip-on`, `.partner-filter-pop-reset`, `.partner-todo-band`, `.partner-todo-chip`, `.partner-todo-chip-on`, `.partner-todo-clear`, `.partner-list-table`, `.partner-bulk-action-bar`, `.partner-pagination-bar`, `.partner-lens-note`, `.partner-lens-note b`, `.partner-lens-note button`
대체: QueryBar+ConditionPanel(검색조건)+QuickSearch+AppliedChips+ResultStrip+SortableTh(≡·너비)+Pager(50)+SelectionBar+ExcelMenu+HelperMenu(AI 제안)+내 조건.

### 거래 대사 (`/partners/reconciliation`)
- 자체 툴바(seg-bar 탭·DateField 기간·이 기간 매칭/AI 전체 매칭/홈택스 거래처 연결 버튼·원장 링크), 정리율 프로그레스 카드, 확인 큐 일괄 바(전체 선택/선택 확정·반려/고신뢰 일괄 확정), 수동 매칭 툴바(설명·검색칸), 정리 내역 설명 카드, 바닥 안내문, ResizableTh(ledger/shared) 사용
- `globals.css`: `.partner-reconciliation-toolbar`, `.partner-reconciliation-tabs`, `.partner-reconciliation-progress-card`, `.partner-queue-tab`, `.partner-queue-bulk-bar`, `.partner-queue-table`, `.partner-manual-match-tab`, `.partner-manual-toolbar`, `.partner-manual-match-table`, `.partner-confirmed-tab`, `.partner-confirmed-table`
대체: 탭 collect-tabs · QueryBar(기간 segments + 검색조건[구분·신뢰도·유형·계산서 거래처] + 빠른검색) · ResultStrip(정리율·대기·높음·기간 밖·확정) · AI 제안(규칙 매칭[장부 대조]·AI 전체 매칭[AI 추천]·고신뢰 고르기·홈택스 거래처 연결[국세청 조회]) · SortableTh 표 3종 · Pager · SelectionBar(선택 확정/반려)

### 거래처 원장 (`/partners/ledger`)
- 자체 툴바(seg-bar 탭·연도 select·회계기간·검색칸·정렬 select·거래처/홈택스 연결/거래 매칭 버튼), KPI 카드 3장, 좌측 카드형 거래처 목록(체크·엑셀 바), 바닥 안내문
- `globals.css`: `.ledger-toolbar`, `.ledger-period-picker`, `.ledger-toolbar-actions`, `.ledger-kpi-row`, `.ledger-kpi-total`, `.ledger-kpi-count`, `.ledger-kpi-other`, `.ledger-partner-list-header`, `.ledger-partner-list-export-bar`, `.ledger-partner-row`
대체: collect-tabs · QueryBar(회계기간 segments + 검색조건[회계기간 달력·연도 지름길·잔액] + 빠른검색) · ResultStrip(총액·곳 수·반대편 전환) · ExcelMenu(선택/전체 원장) · AI 제안(홈택스 거래처 연결[국세청 조회]) · 좌 목록 = ev-table+SortableTh · SelectionBar(엑셀 내보내기)

### 매입매출전표 (`/partners/reconciliation/sale-purchase`) — B형
- 자체 갈래 탭(spv-tabs)·툴바(spv-toolbar: 기간·힌트·엑셀 버튼) → collect-tabs · QueryBar(기간+검색조건[구분·거래처]+빠른검색) · ResultStrip · ExcelMenu. 입력 격자·저장·불러오기는 그대로.
- `globals.css`: `.spv-tabs`, `.spv-tab`, `.spv-tab-on`, `.spv-toolbar`

### 현금영수증 (`/cash-receipts`)
- 화면 머리(seg-bar 탭·발행 한도 배지·기간·가져오기·+발행 한 줄), doc-summary-strip 요약, 선택 액션바, 목록 카드 머리(제목·SortToolbar 정렬), 자체 표 → collect-tabs · QueryBar(기간+검색조건[달력·빠른 기간·상태·용도·거래처·금액]+빠른검색 ‖ 가져오기·+발행) · ResultStrip(건수·합계·매출/매입/공제·발행 한도) · ev-table+SortableTh · Pager · SelectionBar(전표처리)
- `globals.css`: `.cash-receipt-bulk-action-bar`, `.cash-receipt-table` · SortToolbar import 제거

## 2026-08-18 — 조회 표준 확산 Wave 2 · 자금
- 대출·자산: seg-bar 탭 → collect-tabs, 표 머리단 → ev-table+SortableTh(정적). 카드·차트·입력은 그대로(관리 화면).
- 정기 지출: seg-bar 탭 → collect-tabs, 상태 seg-bar → ChipGroup, 벌크 액션바 → SelectionBar(거부·승인·실행[파란]), 표 4종 → ev-table+SortableTh. `globals.css`: `.payment-bulk-action-bar`

## 2026-08-18 — 조회 표준 확산 Wave 3 · 워크스페이스
### 프로젝트 (`/projecthub`)
- 자체 툴바(검색칸·내담당 토글·정렬 select·성과 대시보드·생성), 한 문장 요약(ph-brief), 상태 칩 바(ph-statusbar/ph-stchip)·보기 버튼(ph-viewpick), 보기 localStorage 기억, 바닥 안내문
- `globals.css`: `.projecthub-toolbar` `.search-input-wrap` `.mine-scope-toggle` `.sort-control` `.ph-brief*` `.ph-statusbar` `.ph-stchips*` `.ph-stchip*` `.ph-viewpick` `.ph-view-btn*` `.ph-table thead th`
대체: collect-tabs(목록/담당별) · QueryBar(검색조건[담당·거래처·템플릿] + 빠른검색 + 내 담당/전체 ChipGroup + 상태 칩(qk-chip)) · ResultStrip · ev-table+SortableTh · Pager · 내 조건('projecthub')
### 견적 (`/projecthub/quotes`)
- 자체 툴바·표·빈 상태 → QueryScreen(QueryBar[빠른검색·상태 ChipGroup] · ResultStrip · ev-table+SortableTh · Pager). `globals.css`: `.quotes-toolbar` `.quotes-table-wrap` `.quotes-empty-state` `.quotes-table-scroll`
### 전자계약 (`/signatures`)
- 자체 툴바(seg-bar 탭·한도 칩·새 계약 요청), 상태 카운트 카드 7장, 검색바+일괄 액션(전체선택·PDF·리마인더·삭제), 기간·그룹·담당자 바(select 2 + 기간 2), 자체 정렬 머리(▲▼↕), 페이지네이션 바(10/25/50), 발송 실패 큰 배너, **user_preferences.signature_list_prefs 자동 기억**(조회값 자동 기억 금지 → 내 조건으로)
- `globals.css`: `.signature-dashboard-toolbar` `.signature-toolbar-actions` `.signature-templates-panel` `.signature-failure-alert` `.signature-status-cards` `.signature-status-chip*` `.signature-search-bar` `.signature-search-input-wrap` `.signature-request-list` `.signature-period-*` `.signature-table-wrap` `.signature-table-scroll` `.signature-table thead th` `.signature-table-sort*` `.signature-empty-state` `.signature-pagination-bar`
대체: collect-tabs(계약 요청 N/양식 관리) · QueryBar(요청일 segments[전체 기간 가능] + 검색조건[요청일 달력·서명완료일·그룹·담당자] + 빠른검색 + 상태 칩) · ResultStrip(건수·서명완료 + 서명완료 고르기·발송 실패 칩·발송 한도) · ev-table+SortableTh · Pager · SelectionBar(리마인더·삭제·PDF 저장[파란]) · 내 조건('signatures')
### 내 서명 요청 (`/my-contracts`)
- 자체 머리(seg-bar 필터·새로고침)·카드 목록 → collect-tabs · QueryBar(빠른검색) · ResultStrip · ev-table+SortableTh · Pager. `globals.css`: `.mycontracts-header`, `.mycontracts-empty`, `.mycontracts-list`, `.mycontracts-row`
### 결재 허브 (`/approvals`)
- 아이콘 seg-bar 탭 바, KPI 카드 4장(approval-summary-stats), 필터 바 2곳(seg-bar + 유형 select + 검색칸 + 건수), 표 3곳 자체 머리단
- `globals.css`: `.approval-toolbar` `.approval-tab-item` `.approval-tab-bar*` `.approval-summary-stats` `.approval-stat-card` `.approval-filters` `.approval-type-select` `.approval-search-*`
대체: QueryScreen(collect-tabs 7개 + 결과줄 통계 버튼 4개) · 본문 스크롤 상자 · QueryBar(보기/상태 칩 + 유형 칩 + 빠른검색 + 건수) · ev-table+SortableTh(정적)
남긴 것(범위 밖): 표 정렬·쪽 넘김·SelectionBar 일괄 승인/반려 — 탭별 하위 컴포넌트가 커서(4,600줄) 다음 차수.
### 파일보관함 (`/documents`, files 탭)
- 우측 툴바(list-tab 갈래·검색칸·정렬 select·올리기), 중복 파일 띠, FileList(리스트/그리드 카드) → QueryScreen(collect-tabs · QueryBar[빠른검색 ‖ 올리기] · ResultStrip[건수·용량·중복 안내] · ev-table+SortableTh[파일명·종류·크기·올린 사람·올린 날짜·버전·관리] · Pager · SelectionBar[삭제]). 폴더 트리·드롭존은 그대로.
- `globals.css`: `.vault-file-list` `.doc-toolbar` `.doc-cat-tabs` `.doc-toolbar-right` `.doc-search-input` `.doc-sort-select` `.doc-dup-band` `.doc-dup-names` · FileList import 제거(부품 자체는 다른 화면이 쓴다)
### D형(게시판·구성원 디렉토리)
- 검색줄만 QueryBar(ChipGroup·QuickSearch)로. 나머지 피드/카드는 그대로. `globals.css`: `.board-filter-bar` `.board-toolbar-actions`

## 2026-08-18 — 조회 표준 확산 Wave 4 · 인사
### 구성원 (`/employees`)
- 화면 머리(seg-bar 탭 + 개수 배지), KPI 타일 4장(employees-summary-stats), 초대 섹션 툴바(초대 대기 배지·엑셀 대량 초대·+ 직원 초대), 디렉토리 필터 바(검색칸·팀 select·재직/전체/퇴사 seg-bar·카드/리스트 seg-bar), 리스트 표 자체 머리단, 급여·증명서 히어로 카드(PayrollHero·CertificatesHero — 지표만 payrollStats/useCertificateStats 로 남김), 휴가 서브탭 pill(leave-subtab*), 휴가 상태 필터 버튼, 휴가 신청 내역·증명서 발급 이력·급여 명세 표 자체 머리단(table-head-row/th-cell), flex-skin 보라 머리단
- `globals.css`: `.flex-people-directory` `.flex-people-filter-bar` `.flex-people-list` `.flex-people-list-row` `.employees-page-toolbar` `.employees-summary-stats` `.employee-toolbar` `.leave-subtab-group` `.leave-subtab` `.leave-subtab-on`
대체: qk-shell > QueryScreen(collect-tabs 인력관리·급여·휴가·증명서) · 인력관리 = QueryBar(검색조건[상태·부서·직책·고용형태·입사일] + 빠른검색 + 카드/리스트 칩 ‖ 초대 버튼) · AppliedChips · ResultStrip(재직·연 인건비·퇴직충당금·미결 경비 · 표시 N) · 카드 격자/ev-table+SortableTh(정렬·≡·너비) · Pager · 초대 폼은 표 위 안쪽 판 / 급여·증명서 = ResultStrip 지표 + emp-scroll 본문 · 표는 ev-table 머리단 / 휴가 = ChipGroup 서브탭·상태 칩, 직원별 연차 표(카드 껍데기 제거), 신청 내역 ev-table+SortableTh(정렬·≡·너비)
