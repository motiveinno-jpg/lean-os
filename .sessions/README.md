# 오너뷰 멀티세션 공유 히스토리

## 구조
- `shared-state.md` — 전체 진행 상황 (모든 세션이 읽고 씀)
- `session-1-finance.md` — 재무/세무 세션 로그
- `session-2-sales.md` — 영업/CRM 세션 로그  
- `session-3-hr.md` — HR/운영 세션 로그
- `session-4-infra.md` — 대시보드/인프라 세션 로그

## 규칙
1. 작업 시작 전: `shared-state.md` 읽기
2. 작업 완료 후: 자기 세션 로그 + shared-state.md 업데이트
3. 다른 세션 로그 읽어서 충돌 방지
4. 커밋은 하지 않음 — 통합 세션(세션1)이 일괄 커밋
