# OwnerView 자동 QA 수정 에이전트

## 역할
GitHub 이슈 motiveinno-jpg/motive-team#3 에 올라오는 QA 코멘트를 읽고, 코드를 수정하고, 커밋/푸시하고, 결과를 GitHub 코멘트로 보고한다.

## 실행 순서

### 1. GitHub 코멘트 파싱
- `gh issue view 3 --repo motiveinno-jpg/motive-team --comments` 로 최근 코멘트 확인
- 마지막 수정 보고 코멘트 이후의 새 QA 코멘트만 처리
- 봇/자동 코멘트(author: motiveinno-jpg의 "수정 완료" 패턴) 제외

### 2. 이슈 분류 (섹션별)
각 코멘트에서 URL 또는 키워드로 섹션 분류:

| 섹션 | URL 패턴 | 페이지 파일 |
|------|----------|------------|
| 대시보드 | /dashboard | src/app/(app)/dashboard/page.tsx |
| 딜/프로젝트 | /deals | src/app/(app)/deals/page.tsx |
| 거래처 | /partners | src/app/(app)/partners/page.tsx |
| 결제관리 | /payments | src/app/(app)/payments/page.tsx |
| 세금계산서 | /tax-invoices | src/app/(app)/tax-invoices/page.tsx |
| 현금영수증 | /cash-receipts | src/app/(app)/cash-receipts/page.tsx |
| 거래내역 | /transactions | src/app/(app)/transactions/page.tsx |
| 대출 | /loans | src/app/(app)/loans/page.tsx |
| 입금매칭 | /matching | src/app/(app)/matching/page.tsx |
| 손익계산서 | /reports/pnl | src/app/(app)/reports/pnl/page.tsx |
| 재무상태표 | /reports/bs | src/app/(app)/reports/bs/page.tsx |
| 문서/계약 | /documents | src/app/(app)/documents/page.tsx |
| 전자서명 | /signatures | src/app/(app)/signatures/page.tsx |
| 결재 | /approvals | src/app/(app)/approvals/page.tsx |
| 인사/급여 | /employees | src/app/(app)/employees/page.tsx |
| 팀채팅 | /chat | src/app/(app)/chat/page.tsx |
| 구독/자산 | /vault | src/app/(app)/vault/page.tsx |
| 요금제 | /billing | src/app/(app)/billing/page.tsx |
| 설정 | /settings | src/app/(app)/settings/page.tsx |
| 마이페이지 | /mypage | src/app/(app)/mypage/page.tsx |

### 3. 수정 원칙
- 파일을 먼저 읽고 구조를 파악한 후 수정
- UI 관련: 스크린샷 설명과 코드를 대조하여 정확한 위치 수정
- DB 관련: Supabase MCP로 마이그레이션 (프로젝트 ID: njbvdkuvtdtkxyylwngn)
- 새 기능: 최소 범위로 구현, 기존 패턴 따르기
- 절대 하지 말 것:
  - console.log 남기기
  - 기존 기능 삭제
  - 새 패키지 추가 (기존 의존성으로 해결)
  - 테스트 없이 DB 스키마 변경

### 4. 빌드 검증
```bash
npm run build
```
빌드 실패 시 에러 수정 후 재빌드. 빌드 성공해야만 커밋.

### 5. 커밋 & 푸시
```bash
git add [변경파일들]
git commit -m "fix(qa): [요약] — GitHub QA 자동수정

[상세 수정 내역]

Relates to motiveinno-jpg/motive-team#3"
git push origin main
```

### 6. GitHub 보고
`gh issue comment 3 --repo motiveinno-jpg/motive-team` 로 결과 보고:

```markdown
## 자동 QA 수정 완료 (YYYY-MM-DD HH:MM)

커밋: `[hash]` — Vercel 자동 배포

### 수정 완료 (N건)

| # | 이슈 | 수정 내용 |
|---|------|----------|
| 1 | **[제목]** @[작성자] | [수정 내용] |

www.owner-view.com 에서 확인 가능합니다.
```

## 주요 패턴 참조

### 금액 포맷
```tsx
// 회계형식 (콤마)
Number(amount).toLocaleString()
// 축약형
fmtW(n) // 억/만 단위
```

### Supabase 쿼리
```tsx
const { data } = await supabase
  .from("table_name")
  .select("*")
  .eq("company_id", companyId);
```

### 상태 맵핑
```tsx
const STATUS: Record<string, { label: string; bg: string; text: string }> = {
  active: { label: "활성", bg: "bg-green-500/10", text: "text-green-400" },
};
```

### 모바일 대응
- `text-xs sm:text-sm` — 모바일에서 작은 텍스트
- `grid-cols-1 md:grid-cols-2` — 반응형 그리드
- `overflow-x-auto scrollbar-hide` — 가로 스크롤 탭

## 기술 스택
- Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
- Supabase (DB/Auth/Storage/Realtime)
- Vercel SSR (git push → 자동배포)
- Stripe (결제)
- 라이브: www.owner-view.com
