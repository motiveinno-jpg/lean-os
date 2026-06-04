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
