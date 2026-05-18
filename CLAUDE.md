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

이 프로젝트는 `.claude/agents/` 에 도메인별 10개 서브에이전트를 보유한다. 사용자 요청을 받으면 **메인 Claude는 직접 코드를 작성하기 전에 먼저 라우팅 판단**을 하고, 적합한 에이전트(들)에게 `Agent` 도구로 위임한다.

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
| `qa-validator` | 도메인 작업 완료 후, 푸시 전. **티어별 검증 강도 다름 (아래 티어링 표 참조)** |
| `security-reviewer` | RLS/시크릿/권한/결제 변경 시 필수. **S·M 티어(단순 UI·단일 도메인 로직)는 생략** |

### 컨설팅 / 운영 에이전트 (2) — 코드 변경 안 함
| 에이전트 | 언제 호출 |
|---|---|
| `pm-agent` | 가격 책정·수익구조·유지비·기능 로드맵·경쟁사 비교·UI/UX 개선·보안 강화 등 **PM/사업/디자인 관점 분석·추천**이 필요할 때. 코드 변경은 하지 않고 옵션·근거·트레이드오프만 보고. |
| `notion-agent` | **Notion QA 추적**. "모티브이노베이션_오너뷰" 페이지의 개선요청 완료 토글, 진행요약 갱신, 작업로그·추천 카드 append, 직원 원문 백업 보존. 코드 푸시 완료 후 QA 완료 표시, Notion 페이지 수정·재구성 요청. DB/표 사용 가능하나 "표 떡칠" 금지 — 레이아웃 품질 기준 충족(heading+callout+표+toggle 혼합, 속성·색상 일관). 직원 원문 파괴 금지. |

### 🚦 작업 티어링 (속도 최적화 — 먼저 티어 판정 후 라우팅)

요청을 받으면 **코드 탐색 전에 S/M/L 티어부터 판정**한다. 에이전트 콜드스타트(매번 CLAUDE.md 재독 + 코드베이스 재탐색)가 가장 큰 지연 원인이므로, **불필요한 에이전트 스폰을 최소화**한다.

| 티어 | 판정 기준 | 처리 방식 | 검증 |
|---|---|---|---|
| **S** | 오타·라벨·문구·CSS·한 줄 수정·단순 질문 | **메인이 직접 처리. 에이전트 0개.** | 메인이 `tsc --noEmit` 만 (또는 생략) |
| **M** | 단일 도메인 기능/버그. DB·RLS·시크릿·결제 **무관** | **도메인 에이전트 1개. worktree 안 씀.** | `qa-validator` **fast 모드** (tsc + lint + grep, 풀빌드·Playwright 생략). security 생략 |
| **L** | 다중 도메인 / DB 스키마·RLS / 시크릿·권한 / 결제(Stripe·Toss) | 도메인 병렬 + `isolation: "worktree"` | `qa-validator` **full 모드** (풀빌드 + Playwright) → `security-reviewer` 필수 |

- 에이전트 호출 시 **정확한 파일 경로·함수명을 프롬프트에 명시**해 탐색 콜드스타트를 줄인다 ("X를 고쳐줘"가 아니라 "`src/app/bank/page.tsx`의 `sortTx`를 …").
- 빌드 실패는 Vercel 자동 빌드에서도 잡히므로, M 티어는 타입·린트만 통과하면 푸시한다.
- 애매하면 한 단계 위 티어로(안전 우선). 단 S↔M 경계는 속도 우선으로 S 선택.

**DB 변경 포함 시**: 티어 무관 `db-architect` 먼저 → 마이그레이션 적용·타입 재생성 → 결과를 도메인 에이전트에 전달 (이 경우 자동 L 티어).

**Notion QA 후처리** (코드 푸시 완료 후, S/M/L 공통): 메인이 commit hash + 변경 파일 + 화면위치를 정리해 `notion-agent` 호출 → 완료 토글 + 진행요약 + 작업로그 갱신. **단, 세션 중 여러 건 푸시 시 건건이 부르지 말고 세션 끝에 1회 배치 호출** (notion-agent 콜드스타트 절감). Notion 단독 요청은 코드 무관 즉시 `notion-agent`.

### Worktree 격리
- **L 티어(다중 도메인 병렬)에서만** `Agent` 도구의 `isolation: "worktree"` 사용. S·M 티어는 worktree 금지 (생성/정리 + 컨텍스트 재구성 오버헤드).
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
