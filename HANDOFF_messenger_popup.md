# 핸드오프/제안 — "팀 채팅" → "메신저" 개명 + 플로팅 팝업 메신저

> 작성 2026-06-22 · 작성자 Claude(메인) · 기준 `origin/main` (`ee656050`)
> ⚠️ 이 문서는 **제안·구현 명세만**입니다. 작성자는 커밋/푸시/DB를 하지 않았습니다. 실제 적용은 push 권한 있는 PC에서 진행하세요.

## 0. 목표
1. 사이드바 메뉴 **"팀 채팅" → "메신저"** 로 개명.
2. **플로팅 팝업 메신저** 추가 — 다른 메뉴로 이동해도 메신저가 팝업(우하단 떠 있는 창)으로 계속 유지·사용 가능.

---

## 1. 현재 구조 (기준 코드 확인 결과)

- **영속 셸**: `src/app/(app)/app-shell.tsx`의 `AppContent`가 `Sidebar` + `main(children)` + `MobileBottomNav` + `GlobalSearch`를 렌더. Next.js App Router에서 **이 셸은 라우트 이동 시 언마운트되지 않음** → 여기에 글로벌 위젯을 두면 페이지를 옮겨도 상태(열림/선택 채널)가 유지됨. (`GlobalSearch`가 바로 그 패턴의 선례)
- **채팅 화면**: `src/app/(app)/chat/page.tsx` (1655줄). 내부 컴포넌트:
  - `ChatRoomView({ channelId, onBack, embedded })` (387행) — **이미 `embedded` 프롭 보유** → 팝업에 그대로 끼우기 좋음.
  - `ChatWorkspace`(1440), `ChannelRow`(1402), `SidebarSection`(1422), `ChatPageInner`(1381), `export default ChatPage`(1649).
  - 보조: `FilesGalleryView`(20), `FilePreviewModal`(199), `EditInline`(368) — `ChatRoomView`가 사용.
- **데이터/실시간**: `@/lib/queries`(getChannels, getMessages, getUnreadCounts 등), `@/lib/chat`(sendMessage 등), `@/lib/realtime`(subscribeToMessages 등). 전부 재사용 가능.
- **미읽음 뱃지**: 사이드바가 `badgeKey:"chat"`로 미읽음 표시 — 소스는 `getUnreadCounts`. 런처 FAB 뱃지에 동일 재사용.
- **개명 대상 위치**:
  - `src/components/sidebar.tsx` **48행, 115행**: `label: "팀 채팅"` → `"메신저"` (icon `message-circle` 유지).
  - (선택) `src/app/(app)/app-shell.tsx` 모바일 하단탭 `PARTNER_TABS/EMPLOYEE_TABS/OWNER_TABS`의 `label:"채팅"` → `"메신저"`.

---

## 2. Part A — 개명 (간단, 저위험)
`src/components/sidebar.tsx`:
```
- { href: "/chat", label: "팀 채팅", icon: "message-circle", badgeKey: "chat" },
+ { href: "/chat", label: "메신저",  icon: "message-circle", badgeKey: "chat" },
```
2곳(48·115행) 동일 변경. 모바일탭도 통일하려면 app-shell의 `"채팅"` 3곳도 `"메신저"`로.

> 라우트(`/chat`)·badgeKey는 그대로 — 링크/뱃지/딥링크 안 깨짐.

---

## 3. Part B — 플로팅 팝업 메신저 (핵심)

### 3-1. 아키텍처
- 새 컴포넌트 `src/components/floating-messenger.tsx` 생성 → `app-shell.tsx`의 `AppContent` 안, `<GlobalSearch />` 옆에 `<FloatingMessenger />` 1줄 마운트.
- 영속 셸에 마운트되므로 **열림 상태·선택 채널·스크롤이 페이지 이동에도 유지**(컴포넌트가 언마운트되지 않음). 별도 전역 상태관리 불필요 — 컴포넌트 내부 `useState`로 충분. (새로고침까지 유지하려면 `localStorage`에 open/channelId 저장 — 선택)
- 구성:
  - **런처 FAB**: 우하단 고정 원형 버튼(💬) + 미읽음 뱃지(`getUnreadCounts` 재사용). 클릭 시 팝업 토글.
  - **팝업 패널**: 기본 우하단 카드(약 380×560). 헤더(제목 "메신저" + 채널명 + 최소화/닫기/‘전체화면(/chat 이동)’ 버튼) + 본문.
  - 본문 2-뷰: ① 채널 목록(미선택 시) ② 선택 시 메시지 뷰.

### 3-2. 채팅 UI 재사용 방법 — ★ 결정 필요 (아래 4번)
**권장(A안): `ChatRoomView` 추출 후 공유.**
- `ChatRoomView`(+ 의존 `FilesGalleryView/FilePreviewModal/EditInline`)를 `chat/page.tsx`에서 **새 파일 `src/components/chat-room-view.tsx`로 이동·export**. `chat/page.tsx`는 import만.
- 팝업은 `채널 목록`(getChannels + `ChannelRow` 유사 경량) + 선택 시 `<ChatRoomView channelId embedded onBack=... />` 렌더.
- 장점: 메시지/실시간/리액션/파일 로직을 한 벌로 공유(중복 0). /chat 풀페이지와 팝업이 동일 동작.
- 비용: 1655줄 파일에서 컴포넌트 이동(중간 규모 리팩터) + 회귀 테스트.

**대안(C안): 경량 전용 메신저.** 팝업 안에 채널목록+메시지+입력만 `lib/chat`·`ChatBubble`·`ChatInput`로 새로 구성(파일갤러리·검색 등 고급기능 제외). 풀페이지는 그대로. 리팩터 작지만 일부 로직 중복.

### 3-3. 런처 뱃지(미읽음)
- `getUnreadCounts(companyId/userId)` 재사용해 총 미읽음 합을 FAB에 표시. 사이드바와 동일 소스라 일관.

### 3-4. 반응형/UX
- **데스크톱**: 우하단 고정 팝업. (드래그·리사이즈는 선택 — 1차는 고정 크기 권장, 과설계 지양.)
- **모바일**: 팝업이 좁아 부적합 → 런처는 숨기고 기존 하단탭 "메신저"(/chat)로. 또는 풀스크린 시트. (결정 필요)
- 역할: `/chat` 접근 가능한 역할(현재 전원) 동일 노출. partner/employee 포함 여부 확인.

### 3-5. 추가/변경 파일 요약
| 파일 | 변경 |
|---|---|
| `src/components/sidebar.tsx` | 라벨 2곳 개명 |
| `src/app/(app)/app-shell.tsx` | `<FloatingMessenger/>` 마운트 (+ 모바일탭 라벨 선택) |
| `src/components/floating-messenger.tsx` | **신규** — 런처 FAB + 팝업 패널 + 채널목록 |
| `src/components/chat-room-view.tsx` | **신규(A안)** — `chat/page.tsx`에서 `ChatRoomView` 추출·export |
| `src/app/(app)/chat/page.tsx` | (A안) `ChatRoomView`를 import로 교체 |

DB 변경 없음. 신규 RLS/테이블 없음(기존 채팅 그대로 사용).

---

## 4. 진행 전 확인할 결정 (제안 + 추천)
1. **재사용 방식**: A안(ChatRoomView 추출·공유) ✅추천 / C안(경량 전용).
2. **모바일**: 팝업 숨기고 /chat 링크 ✅추천 / 풀스크린 시트.
3. **드래그·리사이즈**: 1차 고정크기 ✅추천 / 드래그+리사이즈 포함.
4. **노출 역할**: 전원(현 /chat과 동일) ✅추천 / 내부직원만.
5. **개명 범위**: 사이드바만 / 사이드바+모바일탭 ✅추천(일관).

→ 위 5개 정해주시면, 그에 맞춰 **미커밋 코드 변경 + 적용 diff/handoff**를 만들어 드립니다. (제가 직접 커밋/푸시는 안 함)

---

## 5. 검증 기준 (적용 PC에서)
- 사이드바·모바일탭 라벨이 "메신저"로 표기.
- 임의 페이지(예: /bank)에서 런처 클릭 → 팝업 열림 → 채널 선택·메시지 전송 동작.
- 팝업 연 상태로 **다른 메뉴 이동 → 팝업·스크롤·선택 채널 유지**.
- 런처 미읽음 뱃지가 사이드바 뱃지와 일치.
- 새 메시지 실시간 수신(팝업/페이지 동시).
- `npx tsc --noEmit` 통과, /chat 풀페이지 회귀 없음(A안 추출 후).

## 6. 리스크
- A안: 1655줄 파일에서 컴포넌트 이동 시 의존(상태/헬퍼) 누락 주의 → 추출 후 /chat 풀페이지 정상 동작 회귀 필수.
- 실시간 구독 중복: 팝업과 /chat 동시 오픈 시 같은 채널 구독 2회 — 정상(각자 cleanup)이나 부하 점검.
- 영속 마운트로 항상 채널목록 쿼리가 돎 → 닫혀 있을 땐 데이터 fetch 지연(open 시 enable)로 비용 최소화.
