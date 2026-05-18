# OwnerView — 프로젝트 규칙

## MOTIVE Brain (필수)
- **세션 시작**: `cat ~/motive-brain/state/ownerview.md` 읽고 현재 상태 파악 후 작업 시작
- **작업 중 중요 결정**: `~/motive-brain/decisions.md`에 추가
- **실패/성공 교훈**: `~/motive-brain/lessons.md`에 추가
- **세션 종료 또는 컨텍스트 소진 전**: state/ 파일 중 변경된 프로젝트 업데이트
- **잊지 말 것**: 이 규칙은 수동이 아님. 세션이 끝나기 전에 반드시 brain 상태를 갱신할 것

## 기술 스택
- Next.js 16 + React 19 + TypeScript + TailwindCSS
- Supabase (48 테이블, RLS, Realtime, Edge Functions)
- Stripe Live (구독 결제)
- Vercel SSR (호스팅, 자동배포)
- Sentry (에러 모니터링)

## 배포
- `git push origin main` → Vercel 자동 빌드+배포
- www.owner-view.com (프로덕션)

## 절대 하지 말 것
- RLS 없이 테이블 생성 금지
- `console.log` 프로덕션에 남기지 않기
- 소스 코드에 API 키 하드코딩 금지
- curl/SQL만으로 "완료" 보고 금지

---

## 🤖 멀티 에이전트 자동 라우팅 (필수)

이 프로젝트는 `.claude/agents/` 에 도메인별 8개 서브에이전트를 보유한다. 사용자 요청을 받으면 **메인 Claude는 직접 코드를 작성하기 전에 먼저 라우팅 판단**을 하고, 적합한 에이전트(들)에게 `Agent` 도구로 위임한다.

### 도메인 에이전트 (5)
| 키워드 | 에이전트 | 담당 라우트 |
|---|---|---|
| 통장·거래·카드·대출·CODEF(은행/카드)·이상거래·잔액·자동매칭·VAT 분류 | `finance-agent` | bank, transactions, cards, loans |
| 직원·근태·출퇴근·일정·캘린더·급여·명세서·연차·계약서·4대보험 | `hr-agent` | employees, attendance, schedule, my-contracts |
| 서명·전자계약·서식·템플릿·직인·PDF·문서함·보관함 | `docs-agent` | signatures, sign, documents, vault |
| 대시보드·게시판·공지·알림·리포트·결산·운영자·관리자·승인·감사 | `ops-agent` | dashboard, board, announcements, notifications, reports, admin, operator-users, approvals, error-logs |
| 영업·딜·파트너·매칭·구독·결제·Stripe·Toss·온보딩·초대·채팅 | `growth-agent` | deals, partners, matching, billing, payments, onboarding, chat |

### 횡단 게이트 (3)
| 에이전트 | 언제 호출 |
|---|---|
| `db-architect` | DB 스키마/RLS/RPC/마이그레이션 변경이 필요할 때 — **도메인 에이전트보다 먼저** |
| `qa-validator` | 도메인 작업 완료 후, 푸시 전 |
| `security-reviewer` | qa-validator 통과 후, 푸시 전 (변경이 RLS/시크릿/권한 건드릴 때 필수, 단순 UI 변경은 생략 가능) |

### 라우팅 절차
1. **단일 도메인 작업** (예: "통장 거래 정렬 버그 고쳐줘")
   → `finance-agent` 호출 → 완료 보고 → `qa-validator` → (필요시 `security-reviewer`) → 메인이 커밋·푸시
2. **다중 도메인 작업** (예: "댓글 + PDF 다운로드 같이")
   → `ops-agent` + `hr-agent` **병렬 호출** (한 응답에서 Agent 도구 두 번, `isolation: "worktree"` 사용)
   → 둘 다 완료 후 `qa-validator` → 메인이 머지·푸시
3. **DB 변경 포함** (예: "게시판에 댓글 테이블 추가")
   → `db-architect` 먼저 호출 → 마이그레이션 작성·적용·타입 재생성 → 결과를 도메인 에이전트에 전달 → 도메인 에이전트가 UI/로직 작성
4. **사소한 한 줄 수정 / 단순 질문**
   → 라우팅 생략, 메인이 직접 처리 (오버헤드 낭비 방지)

### Worktree 격리
- 다중 도메인 병렬 호출 시 `Agent` 도구의 `isolation: "worktree"` 옵션으로 폴더 자동 격리 (충돌 0)
- 변경 없으면 worktree 자동 정리, 변경 있으면 메인이 받아서 머지

### BLOCKED 영역 (모든 에이전트 금지)
- 홈택스 sync (`tax-invoices/`, `codef-sync` 안의 hometax/cash-receipt 분기)
- CF-12200, CF-00007, CF-00000 에러 우회 시도
- 사유: CODEF 운영팀 답변 대기 중 (자동 메모리 `project_hometax_blocked.md` 참조)

### 직접 작성이 정당한 경우
- 한 파일 한 줄 수정 (오타, 라벨 변경)
- 사용자가 "이 파일 직접 봐줘" 명시
- 라우팅 판단 자체에 필요한 탐색 (Read, Grep 등)
- `motive-brain` 상태 갱신 (메인 책임)
