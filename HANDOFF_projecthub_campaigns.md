# 핸드오프 — 프로젝트 "캠페인 속 캠페인"(세부 프로젝트) 기능

> 작성일 2026-06-22 · 작업자 Claude(메인) · 대상: 다른 컴퓨터에서 이 변경을 배포하려는 사람

## 0. 한 줄 요약
프로젝트(`/projecthub`) 안에 **세부 프로젝트(캠페인)** 를 만들고, 각 캠페인마다 자체 **개요·견적서·전자계약·손익**을 관리하는 기능. 상위 프로젝트 금액/손익은 세부를 **합산(롤업)** 해서 보여준다.

---

## 1. 배포 전 반드시 알아야 할 것 ⚠️

### DB 마이그레이션은 **이미 프로덕션에 적용 완료**됨
- 프로젝트: Supabase **ownerview** (`njbvdkuvtdtkxyylwngn`)
- 마이그레이션명: `add_deals_parent_deal_id`
- **다시 적용하지 말 것.** (아래 SQL은 기록용. `if not exists`라 재실행해도 안전하긴 함)

```sql
-- 세부 프로젝트(캠페인 속 캠페인): deals 자기참조 부모. 2단계 중첩.
-- 부모 삭제 시 자식은 최상위로 승격(set null) — 자식 데이터(견적/계약/손익) 보존.
alter table public.deals
  add column if not exists parent_deal_id uuid references public.deals(id) on delete set null;

create index if not exists idx_deals_parent_deal_id
  on public.deals(parent_deal_id) where parent_deal_id is not null;

comment on column public.deals.parent_deal_id is
  '세부 프로젝트(캠페인)용 자기참조 부모 deal. NULL이면 최상위 프로젝트. 2단계만 사용(부모는 다시 부모를 갖지 않음).';
```

→ **즉, 다른 컴퓨터에서는 코드만 main에 올리면 배포 끝.** DB 작업 추가로 할 것 없음.

---

## 2. 변경된 파일 (코드 4개)

| 파일 | 내용 |
|---|---|
| `src/app/(app)/projecthub/page.tsx` | 목록: 최상위 프로젝트만 노출(세부 숨김), 세부 있으면 `캠페인 N` 배지 |
| `src/app/(app)/projecthub/[id]/page.tsx` | 상세: **세부 프로젝트 탭** 추가, 세부 생성 모달, 2단계 강제, 상위 브레드크럼, 손익/계약금액 롤업 |
| `src/types/database.ts` | deals 타입에 `parent_deal_id` 반영 |
| `src/types/database.generated.ts` | 동일 |

이 변경들은 로컬 **`feat/projecthub-campaigns` 브랜치**에 1개 커밋으로 들어 있음.

> ⚠️ **이 작업 컴퓨터에서는 GitHub push 권한이 없어 원격에 못 올림**(`junhoyeon55-creator` → `motiveinno-jpg/lean-os` 403).
> 그래서 코드를 **파일로 추출**해 두었음. 아래 두 파일 중 하나를 다른 컴퓨터로 복사해서 적용한다.
> - `handoff/projecthub-campaigns.bundle` (git 번들 — 권장, 커밋 그대로 이식)
> - `handoff/projecthub-campaigns.patch` (format-patch — 번들 안 되면 사용)
>
> 두 파일은 저장소 `handoff/` 폴더에 있음(전송용 산출물이라 git 추적 안 함). USB/드라이브/메신저 등으로 다른 컴퓨터에 전달.

---

## 3. 다른 컴퓨터에서 배포하는 절차

전제: **push 권한이 있는 계정**으로 설정된 OwnerView 저장소 클론이 있고, main push → Vercel 자동배포 구조. 그 클론의 main이 커밋 `5105af6e`(또는 그 이후)를 포함해야 함.

### 방법 A — 번들 적용 (권장)
```bash
cd <other-computer-의-lean-os>
git fetch origin && git checkout main && git pull origin main   # main 최신화

# 전달받은 번들에서 작업 브랜치 가져오기
git fetch /path/to/projecthub-campaigns.bundle feat/projecthub-campaigns:feat/projecthub-campaigns

git checkout feat/projecthub-campaigns
npm install            # node_modules 없으면
npx tsc --noEmit       # 타입 체크 통과 확인

# main 머지 → 푸시 (= 배포)
git checkout main
git merge feat/projecthub-campaigns
git push origin main   # ← Vercel 자동 빌드+배포
```

### 방법 B — 패치 적용 (번들이 안 될 때)
```bash
cd <other-computer-의-lean-os>
git checkout main && git pull origin main
git am /path/to/projecthub-campaigns.patch   # 커밋(메시지·작성자 포함) 그대로 재현
npx tsc --noEmit
git push origin main
```
> `git am` 충돌 시 `git apply --3way projecthub-campaigns.patch` 로 변경만 적용 후 직접 커밋.

- 배포 후 www.owner-view.com 에서 동작 확인(4번 체크리스트).
- PR 정책이면 push 대신 `feat/projecthub-campaigns` 푸시 → GitHub에서 main PR 머지.

---

## 4. 배포 후 동작 확인 체크리스트

OwnerView 로그인(owner/admin) → 좌측 **프로젝트** 메뉴(`/projecthub`):

- [ ] 목록에 최상위 프로젝트만 보이고, 세부 있는 항목은 이름 옆 `캠페인 N` 배지.
- [ ] 프로젝트 클릭 → 상세에 탭 **개요 / 견적서 / 전자계약 / 세부 프로젝트 / 운영** 노출.
- [ ] **세부 프로젝트** 탭 → `+ 세부 프로젝트 추가` → 캠페인명·계약금액 입력·생성 → 해당 캠페인 상세로 이동.
- [ ] 캠페인 상세에서 자체 **견적서 작성**, **전자계약** 연결이 동작(상위와 분리).
- [ ] 캠페인 상세 상단에 `← (상위 프로젝트명)` 브레드크럼 + `세부 프로젝트` 배지.
- [ ] 캠페인 안에서는 세부 추가 버튼 대신 "2단계까지만" 안내(중첩 차단).
- [ ] 상위 프로젝트 **개요/운영** 탭의 계약금액·비용·마진이 자기 자신 + 세부 합계로 표시되고 "합산(롤업)" 안내 문구 노출.

---

## 5. 설계 결정 / 주의점

- **세부 프로젝트 = `deals` 행** (자기참조 `parent_deal_id`). 그래서 documents/signature_requests/tax_invoices 등 기존 `deal_id` 연결 기능(견적·계약·손익)을 **자동 상속**. 별도 테이블 없음.
- 기존 **`sub_deals` 테이블은 외주/벤더 하도급용**(vendor 기반, 견적·계약 없음) — 이번 기능과 무관, 건드리지 않음.
- 중첩은 **2단계만**(프로젝트 → 세부). 코드/안내로 강제.
- 롤업: 상위 비용 쿼리를 `[자기id, ...자식ids]` 기준 `.in()` 으로 변경, 계약금액은 자기+자식 합.
- 세부 생성 시 거래처·담당자·분류는 상위에서 상속.

### 알려진 한계 / 후속 후보 (이번 범위 밖)
- 세부 프로젝트(캠페인)도 `deals`라서 **워크플로우 보드(`/projects`) 칸반에 별도 카드로 같이 노출**됨. 보드에서 숨기려면 추가 작업 필요(미진행).
- 목록(`/projecthub`)의 계약금액 컬럼은 각 프로젝트 **자체 값**(롤업 아님) — 합산은 상세에서 확인. (배지로 세부 존재는 표시)

---

## 6. 롤백 방법
- 코드: 해당 머지 커밋 revert 후 main 푸시.
- DB: 컬럼은 추가형(additive)이라 그대로 둬도 무해. 굳이 제거하려면
  `alter table public.deals drop column parent_deal_id;` (세부 프로젝트 행들이 최상위로 보이게 되니 주의).
