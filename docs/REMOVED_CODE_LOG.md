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
