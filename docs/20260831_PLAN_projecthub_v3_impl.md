# 프로젝트 v3 — 구현 단계 기획 (2026-08-31, 사장님 방향 확정)

상위 기획: docs/20260831_PLAN_projecthub_v3_odoo.md (결정 109~130 — 사장님 확정 "방향 맞아").
이 문서는 **어떻게 만들 것인가**: 데이터 모델 · v2.6 관계 · 이관 · 구현 순서 · 게이트.

---

## 1. History — 이미 있는 자산 (버릴 게 생각보다 적다)

**v2.6(다른 PC, 2026-08-31 배포 중)이 핵심 기반을 이미 깔았다** — `20260831140000_project_items_v3.sql`:
- `project_items` 통합 항목 모델: kind(todo/money/note) · status · assignee · **followers** · start/due ·
  **tags** · **priority** · **is_milestone** · **parent_id(하위)** · plan_amount · partner · **fields jsonb** ·
  body · position · **source_item_id(이관 멱등 키)** + RLS + updated_at 트리거.
- `deals.item_stages` — 프로젝트별 단계 정의 [{id,label,color}].
- **유실 0 이관 완료**: 옛 project_board_items → project_items 백필(모티브 게이트, 118/135건),
  원본 표는 아카이브로 보존. 실측 규모(전사): 프로젝트 8 · 표 23 · 컬럼 213 · 항목 135 — 작다.
- 3단계 핑퐁(견적↔계약 왕복·서명 시 판매전표)은 money kind 위의 흐름 — 그대로 산다.

없는 것(=v3가 만드는 것): 커스텀 **컬럼 정의** 테이블, 먼데이식 **표 입력 UI**, 기록(채터)·체크리스트·
다음 활동·앞뒤 순서·반복, 상태 보고, 보기/저장 뷰/기능 토글, 자동화 규칙, 외부 공유, 예산.

## 2. 결정 (131~136)

### 결정 131 — 모델: v2.6 project_items 를 **확장**한다 (새 모델 금지)
- **규칙**: 항목의 단일 원천 = `project_items`. 이관·RLS·멱등 키를 다시 만들지 않는다.
- 신규 테이블(최소):
  - `project_item_columns` — 커스텀 컬럼 정의: deal_id·key·name·type(text/person/status_label/date/
    timeline/number/select/tag)·settings(라벨·색)·position·width. **내장 4컬럼(이름·담당·상태·마감)은
    정의 없이 코드가 안다** — 커스텀만 이 표에. 값은 기존 `project_items.fields[key]`.
  - `project_item_events` — 기록(채터): item_id·kind(comment/log)·body·meta·created_by. 댓글과 변경
    로그가 한 줄기(결정 113). 팔로워 알림은 기존 notify 트리거 확장.
  - `project_item_checks` — 체크리스트: item_id·name·done·position.
  - `project_status_reports` — 상태 보고(결정 114): deal_id·signal(라벨 id)·body·created_by.
  - `project_automations` — 규칙(결정 123): deal_id·trigger jsonb·action jsonb·enabled.
- 컬럼 추가(경량, project_items): `after_id`(앞 순서)·`recurrence jsonb`(반복)·
  `activity_what/activity_assignee/activity_due`(다음 활동 — 항목당 1건이므로 컬럼 3개면 된다).
- deals 컬럼 추가: `budget_amount`(예산)·`v3_views jsonb`(추가한 보기+저장 뷰 구성)·
  `v3_features jsonb`(기능 토글) — 전사 8프로젝트 규모라 jsonb로 시작, 커지면 표로 승격.
- **기존 데이터**: fields 에 이미 값이 있는 키들 → `project_board_columns`(213개)에서 이름·타입을 읽어
  `project_item_columns` 정의를 생성하는 백필 1회(값 이동 없음 — 정의만 만든다).

### 결정 132 — 상태 = 단계 = 색 라벨 하나 (결정 126 개정)
- 목업 3~5차에서 '단계(칸반 열)'와 '상태(색 라벨)'를 두 축으로 뒀었는데, **하나로 합친다**:
  `project_items.status` + `deals.item_stages`(색 라벨 커스텀, 기본 = 사장님 monday 5색)가 유일한 축.
  표의 상태 셀 = 이 라벨, 표의 기본 그룹핑 = 이 라벨, 칸반 열 = 이 라벨.
- **왜**: monday 원형이 그렇고(칸반은 상태 컬럼으로 묶은 보기), 사장님 실보드도 상태 컬럼 하나로 산다.
  v2.6 모델과도 정확히 일치 — 마이그레이션 0. 두 축은 "다 펼쳐놓는" 복잡성이었다.
- 그룹 축(결정안 127 — 팀원별 KPI/마일스톤 같은 성격 묶음)은 **3단계의 선택 기능**으로:
  `project_items.group_key` + `deals.item_groups jsonb` 추가는 그때.

### 결정 133 — v2.6 관계: 모델은 승계, 화면은 교체
- 승계: project_items·이관·RLS·item_stages·핑퐁(견적↔계약↔전표)·시작 꾸러미 데이터.
- 교체: v2.6 1단계 UI(상세 '한 장'·탭 4·입력줄) → **v3 표 UI**(결정 130). v2.6 화면은 v3 게이트가
  켜진 회사에서 숨긴다(코드 삭제는 전체 오픈 뒤).
- **⚠️ 두 PC 조율(사장님 결정 필요)**: v2.6 은 다른 PC 가 오늘도 배포 중이다. 같은 파일
  (projecthub/[id]·project_items 마이그레이션)을 두 PC 가 동시에 만지면 사고다.
  제안 — 이 시점부터 **프로젝트 도메인은 한 PC 로 몰고**, 다른 PC 는 다른 도메인으로. 사장님이 정한다.

### 결정 134 — 게이트·라우트·권한
- feature_on(**'projecthub_v3'**) — 모티브 먼저, 사장님 "문제 없다" 후 null 행 전체 오픈(기존 규칙).
- 라우트 유지: /projecthub(전체 카드) · /projecthub/[id](기본=표). **권한 키 불변**(/projecthub,
  mine/all 탭 키 유지) — member_permissions 백필 0건.
- 광고 표(ads)는 v3 밖 — 지금처럼 대시보드로 산다(아드리엘 연동).

### 결정 135 — 구현 순서 (한 단계 = 배포 한 번, 각 단계 실측 검증)
| 단계 | 내용 | DB | 완료 기준(실측) |
|---|---|---|---|
| **1** | **표 입력** — /projecthub/[id] 기본 화면을 먼데이식 표로: 내장 4컬럼+커스텀 컬럼 렌더, 인라인 ＋줄, 셀 즉시 편집, 상태 색 팔레트, 컬럼 ＋(7타입), 상태 그룹핑·합계 줄. 전체 카드 화면(결정 110 최소형: 이름·진행·아바타). 만들기 한 장 폼(빈 표/회사 양식) | project_item_columns + 컬럼 정의 백필 | 모티브에서 A커머스를 표로 열고 줄 추가→셀 수정→상태 변경이 DB 왕복으로 동작 |
| **2** | **서랍 + 기록** — 줄 클릭 서랍(속성·체크리스트·기록 채터·팔로워), 다음 활동, ＋보기 프레임 + 칸반·캘린더 | item_events·item_checks + activity 컬럼 | 댓글 달면 팔로워 알림, 칸반 끌기 = status 변경 |
| **3** | **기능 토글** — 마일스톤(is_milestone 활용)·예산/돈 패널(견적·계약·전표 연결 = 기존 로직 이식)·상태 보고(신호등)·반복·앞뒤 순서 + 간트·현황 보기 + 저장 뷰 | status_reports + after_id·recurrence·budget | 전체 카드가 켠 기능만큼 자람, 보고가 신호등 원천 |
| **4** | **자동화 규칙 + 외부 공유 + 회사 양식** 저장/사용 | project_automations + share 토큰 | 태그 트리거→팔로워 추가 동작, 외부 링크 보기 전용 |
| **5** | **전체 오픈 + 정리** — null 행 배포, 구 화면(project_boards UI·v2.6 한 장) 제거, 옛 표 읽기 전용 진입로('옛 표 보기') 한 분기 유지 후 제거 | — | 전 회사 전환, 회귀 0 |
- 매 단계: tsc + 프로드 실측(로컬 prod 화면) + 권한 비마스터 계정 확인. DB 는 db-architect,
  3·4단계(권한·공유) 후 security-reviewer.

### 결정 136 — 이관 잔여분
- 항목 값: v2.6 이 완료(유실 0, 원본 보존). 남은 것 = **컬럼 정의 백필**(결정 131)과
  **모티브 외 회사**(항목 17건) — 전체 오픈 시 같은 백필 마이그레이션으로.
- 다중 표(한 프로젝트에 표 여러 개)였던 것: v2.6 이 kind(todo/money/note)로 접었다 — v3 표에서
  kind 는 컬럼이 아니라 **탭이 아닌 필터 칩**(할 일/돈/메모)으로 노출. 돈 항목은 3단계 돈 패널과 연동.

## 3. 파급 (구현 때 같이 봐야 하는 곳)
projecthub/* 전체 · ProjectBoards.tsx(1~4단계 병행, 5단계 제거) · 대시보드 위젯(프로젝트 카드·내 할 일
원천 교체) · schedule(할 일 연동) · BoardDocModal(견적·계약 — money 항목으로 연결 유지) · 어제 넣은
프로젝트 엑셀 내려받기/올리기(표 문법에 맞게 이식) · board_presets(회사 양식 승계) · menu-guides ·
release-log. 권한·라벨은 불변.

## 4. 사장님 컨펌 포인트 (착수 전)
1. **두 PC 조율**(결정 133) — 프로젝트 도메인을 어느 PC 로 몰지.
2. 상태=단계 통일(결정 132) — 목업과 한 축 다름(화면은 동일하게 보임).
3. 1단계 착수 승인 — 이후는 단계마다 배포·보고.

### 결정 137 — 템플릿: 가로형·카테고리 8종·26템플릿 (2026-08-31 사장님 지시 3건 반영)
- **규칙**: 템플릿은 항목(세로)이 아니라 **컬럼 정의(가로)** 를 시드한다 — "한 태스크당 업무처리는
  가로로". 그룹은 시드하지 않는다(그룹은 사용자 영역: 한 그룹 시작 → 이름 인라인 수정 → ＋ 새 그룹).
  내장 열(담당·상태·마감·금액)과 겹치는 열은 만들지 않는다. 같은 이름 열은 건너뛴다(멱등).
- **AS_IS ▶ TO_BE**: 생성 폼 꾸러미 6종(세로 시드) ▶ 표 머리단 [템플릿] 팝업 —
  monday 템플릿 센터 실사(2026-08-31, 사장님 계정) 기반 카테고리 8종
  (프로젝트 관리·마케팅·콘텐츠 제작·디자인·소프트웨어 개발·영업·고객·인사·운영·구매) × 26템플릿.
  원본 대응: Social media planner→SNS 게시 일정, Content Planning→콘텐츠 기획·발행,
  Design weekly tasks→디자인 요청·작업, 제품 로드맵/IT 서비스 데스크→로드맵/버그 접수,
  Recruitment pipeline→채용 파이프라인, Purchase Orders/Vendor Evaluation→구매·발주/업체 평가 등.
  monday 전용·대기업용(Enterprise product, Jira 연동, GDPR 등)은 제외 — 소상공인 용어로 덜어냄.
- **적용 시점**: 즉시(모티브 게이트 안). **기존 데이터**: 열 이름 충돌 시 skip, 예시 줄은 빈 표에만.
- 남은 것: '우리 회사 양식' 저장(monday '만든 사람: {회사}' 대응, board_presets 승계)은 4단계.
