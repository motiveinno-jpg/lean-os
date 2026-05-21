# AGENTS.md — OwnerView 프로젝트 (모든 AI 에이전트 공통 규칙)

> 이 파일은 OpenAI Codex, Anthropic Claude Code, Cursor, Cline, Aider, Gemini Code Assist,
> 그 외 모든 AI 코딩 에이전트가 공유하는 단일 진실의 원천이다.
> Claude 전용 상세 규칙은 `CLAUDE.md`, Cursor 는 `.cursorrules` 참조.

---

## 🚨 세션 시작 시 강제 실행 — 첫 응답 전

**아래 2개를 무조건 먼저 읽는다. 안 읽고 코드 변경 시작 = 룰 위반.**

```bash
cat ~/motive-brain/state/ownerview.md    # 프로젝트 현재 상태 (915줄, 풀로 읽기)
tail -80 ~/motive-brain/lessons.md       # 최근 교훈 (인시던트·회귀·해결책)
```

읽은 후 첫 응답에서 brain 상태 1줄 요약 → 작업 진행.

**이유**:
- OwnerView 는 48 테이블 / 30+ edge functions / 80+ RLS 정책 / Stripe Live / 100+ 마이그레이션을 가진 prod SaaS
- 매 인시던트(504·BOOT_ERROR·RLS 회귀) 의 80% 가 brain 상태 미파악 → 같은 실수 반복
- 토큰 비용보다 정합성·안전성 우선

---

## 🧠 brain 갱신 규칙 (작업 중·종료 시)

| 시점 | 파일 | 내용 |
|---|---|---|
| 중요 결정 직후 | `~/motive-brain/decisions.md` append | "왜 X 가 아니라 Y 인가" |
| 인시던트/회귀 직후 | `~/motive-brain/lessons.md` append | 진단·근본원인·해결책·재발방지 |
| 세션 종료 전 | `~/motive-brain/state/ownerview.md` 갱신 | 진행/완료/BLOCKED 토픽 |

---

## 📋 기술 스택
- Next.js 16 + React 19 + TypeScript + TailwindCSS
- Supabase (48 테이블, RLS, Realtime, Edge Functions)
- Stripe Live (구독 결제)
- Vercel SSR (자동배포: `git push origin main` → www.owner-view.com)
- Sentry (에러 모니터링)

## 🚫 절대 하지 말 것
- RLS 없이 테이블 생성 금지
- `console.log` 프로덕션에 남기지 않기
- 소스 코드에 API 키 하드코딩 금지
- curl/SQL 결과만으로 "완료" 보고 금지 (반드시 UI 또는 라이브 호출로 검증)
- RLS 정책 본문에 인라인 `users` / `employees` 서브쿼리 금지 → `SECURITY DEFINER` 헬퍼만 사용
- edge function PATCH 배포 금지 (Management API PATCH = metadata only, eszip 미반영). **반드시 `supabase functions deploy` CLI 정공 사용**
- prod DB 재시작은 사용자 명시 승인 후만
- 홈택스/현금영수증 CODEF 분기 미접촉 (CF-12200·CF-00007·CF-00000 우회 시도 금지 — 운영팀 답변 대기)

## ✅ 워크플로우
- 배포: `git push origin main` → Vercel 자동
- 마이그: `node scripts/apply-supabase-migration.mjs supabase/migrations/<file>.sql`
- edge deploy: `npx supabase functions deploy <slug> --project-ref njbvdkuvtdtkxyylwngn` (PAT 는 `.env.supabase.local`)
- 진단 SQL: `node scripts/apply-supabase-migration.mjs --query "SELECT ..."`

## 🤖 도메인 라우팅 (Claude Code 전용 — 다른 AI 는 메인 직접 작업)
- Claude 의 멀티 에이전트 라우팅 규칙은 `CLAUDE.md` 참조
- 기본은 메인 AI 직접 처리. 에이전트 위임은 L 트리거(3+ 도메인 동시·DB 마이그·결제/RLS) 명백할 때만

## 📞 사용자 핸드오프 형식
- 사용자는 "# [핸드오프·도메인·에이전트]" 형식으로 작업 던짐
- STEP 1 진단 → STEP 2 픽스 → STEP 3 라이브 스모크 패턴
- "절대 준수" 섹션은 글자 그대로 따르기 (회귀 0, 데이터 무변경 등)
