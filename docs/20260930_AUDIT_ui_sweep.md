# 전 메뉴 UI 전수 점검 (2026-09-30)

사장님 요청: "한번에 훑어서 목록으로 뽑아주고 우선작업 정해줘".
기준 = 오늘 이커머스·인사에서 고친 유형(CLAUDE.md 「조회 화면 표준」).
이커머스(/inventory/channels)·구성원(/employees)·근태(/attendance)는 오늘 정리해 제외. 코드만 읽음(파일:줄 근거).

유형: **A** 메뉴·탭 중복 / 기능 겹침 · **B** 본문 안 탭·두 층 탭 · **C** 상자 안 상자·KPI 카드 · **D** 자체 색 버튼·파란 버튼 2개+ ·
**E** 목록 화면에 설정 판 · **F** 로딩·오류가 '없음'으로 보임.
경로는 `src/app/(app)/` 기준(components/ 는 `src/components/`).

---

## 우선순위 (결정)

| 순위 | 묶음 | 유형 | 대상 | 이유 | 크기 |
|---|---|---|---|---|---|
| 1 | 로딩·오류 ≠ '없음' 일괄 | F | 근로계약·서식(중복 등록 위험) · 재고 doc-screen(주문·판매·구매·생산) · 품목 · 창고관리 · 통장 · 카드 · 알림 · 세금·증빙 · 수집·전표 · 정기 지출 · 일반/매입매출전표 · 계약 대장 · 분석 '불러오는 중 멈춤' 5곳 · 손익 현황 | 잘못된 판단(없다고 믿음)·**중복 등록 위험**, 한 패턴으로 여러 화면 | S×다수 |
| 2 | 매일 누르는 버튼 표준화 | D | 결재 허브 승인/반려(폭 전체 초록 알약) · 결재 의견·댓글 · 게시판 · 메신저 · 대시보드 · 설정 저장 버튼들 · 거래처·원장·정기 지출 직접 칠한 버튼 | 매일 누르는 버튼, 파란 버튼 1개 규칙 | S×다수 |
| 3 | 재무 첫 화면 상자 정리 | C | 통장 개요 glass-card 3장 · 카드 상세 pnl-panel(거래내역과 중복) · 빈 상태 카드 안 btn-primary | 재무에서 가장 자주 여는 두 화면 | M |
| 4 | 설정 5그룹 상자 → 선 | C·D | globals.css .stg-main .glass-card·.stg-card·.stg-sec + 저장 btn-sm | 오늘 근무 기준과 같은 유형이 설정 전 탭에(공용 CSS — 이 PC) | M |
| 5 | 회계 자료 허브·부가세 | A·B·C | statements 허브(카드 7장 = 탭 7개 중복) → 첫 화면으로 · VatReport seg-bar → 머리 칩 · KPI 카드 → stats | 메뉴 중복·두 층 | S |
| 6 | 프로젝트 상세 현황 보기 | B·C | TableV3 현황: 두 번째 탭 줄 + KPI 카드 6 + 판 | 매일 여는 화면(프로젝트 = 이 PC 전담) | M |
| 7 | 결재 허브 새 요청·양식 탭 | C·E | 새 요청 glass-card 폼·미리보기, 결재함 탭 줄에 설정 탭(양식 관리·결재선 관리) | | M |
| 8 | 거래처·원장 상세 팝업 | B·C·D | partners 상세 seg-bar·타일·직접 칠한 버튼, ledger 팝업 | | M |
| 9 | 나머지 C (옛 화면) | C | 마이페이지 설정 폼 · 이익관리 원가 이력 · SalesBoard · 재무상태표 · 비용 분석 · 인원별 급여 · 3-Way 매칭 · 고객센터 · 문서 상세 · 현금영수증 수동 등록 | | M~L |

### 사장님 결정 필요
1. **전표처리 입구**: 통장·카드·현금영수증 선택 바의 「전표처리」를 없애고 수집·전표 하나로(세금·증빙은 이미 그렇게 뺌 — tax-invoices:1726).
2. **재무 현황·세무 신고의 pnl-panel 카드 격자**: 분석 화면 표준(판 허용)으로 볼지, 조회 화면 표준으로 바꿀지.
3. **일반전표 입력**: 목록과 같은 상자에 펼쳐진 ERP식 입력(voucher-entry:912-1086)을 '폼은 팝업' 예외로 둘지.
4. **숨은 화면** `/cash-receipts`·`/e-invoices`: 메뉴로 들어가는 길을 만들지(지금은 주소·수집 링크로만).
5. **양식 화면 4곳**(설정›회사 양식, 결재 허브 양식 관리, 근로계약·서식, 전자계약 양식 관리) 통합 여부 · 결재 허브의 양식·결재선 관리 탭을 설정으로 옮길지.
6. **3-Way 매칭**: 후보 줄 클릭 = 즉시 확정(확정 버튼 없음) — '확정은 사람 버튼' 원칙과 어긋남. 확정 버튼 추가 여부.

#### 2026-10-06 사장님 결정 — "추천대로 진행"
1. 통장·카드·현금영수증 선택 바 「전표처리」 삭제 → 수집·전표 하나. 통장·카드는 선택 바에 「수집·전표에서 전표 만들기 →」(secondary), 현금영수증은 고를 일이 전표뿐이라 체크 칸·선택 바째 빼고 결과 줄 「전표 안 된 건 N건 → 수집·전표」. 한 줄씩 처리하는 팝업(통장 줄 처리·카드 줄 전표처리)은 그대로.
2. 재무 현황·세무 신고의 pnl-panel 격자 = **분석 화면 표준으로 보고 유지**(숫자를 읽는 화면, 목록 고르기 아님). 코드 변경 없음.
3. 일반전표 입력의 펼친 ERP식 입력 = **'폼은 팝업' 규칙의 예외로 인정**(여러 줄 연속 입력 — 팝업이면 장마다 열고 닫아야 함). 코드 변경 없음.
4. `/e-invoices`·`/cash-receipts` 는 메뉴를 늘리지 않고 세금·증빙 「+ 발행 ▾」 안에(권한 있는 종류만).
5. 결재 허브 양식·결재선 관리 탭 → 설정으로. 양식 4곳 통합은 하지 않음(데이터 구조가 다름).
6. 3-Way 후보 줄 클릭 = 고르기, 확정은 선택 바 「매칭 확정」.

---

## 홈·재고·재무·분석 상세

### 홈
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 대시보드 | dashboard/page.tsx:444 | D | 오류 「새로고침」 버튼 직접 칠함 | S |
| 대시보드 | dashboard/page.tsx:2566, 2610 | D | 사업자번호·권한 알림이 같이 뜨면 btn-primary 2개 | S |
| 대시보드(파트너) | dashboard/page.tsx:2772, 2801, 2814 | C | 옛 glass-card 타일 격자(참고) | M |
| 마이페이지 · 급여·계약·증명 | mypage/page.tsx:593-609 ↔ _components/MyContractsCard.tsx:24-29 | A·C | 같은 hr_contract_packages 목록 두 번, 줄마다 파란 서명 버튼 | S |
| 마이페이지 · 내 정보·설정 | settings/_components/NotificationsTab.tsx:316,423,560,672 / AccountTab.tsx:82,95 | C·E | 설정 폼이 glass-card째 펼쳐짐 | M |
| 〃 | AccountTab.tsx:163, NotificationsTab.tsx:634,402,606 | D | btn-sm 없는 큰 버튼, 파란 버튼 최대 4개 | S |
| AI 참모 | copilot/page.tsx:796, 648 | D | 취소·전송 자체 스타일(전송은 채팅 관례상 허용 여지) | S |
| 지원사업추천 | support-programs/page.tsx:99-102, 399-407 | F | 오류가 '없습니다'로 | S |
| 알림 | notifications/page.tsx:54, 206-207 | F | 실패 시 '아직 알림이 없습니다' | S |
| 마스터 | master/page.tsx:48-54,108,187-213 | F·D | 로딩·오류 중 '샘플 데이터 생성' 권함, CTA 타일 직접 칠함 | S |
| 마스터 | components/closing-checklist-widget.tsx:272,282,187 · owner-command-center.tsx:302 | D | w-full·bg-success 버튼, 파란 버튼 여러 개 | S |

### 재고(이커머스 제외)
주문·판매·구매·생산·품목의 B·C·D 이상 없음(doc-screen 공용).
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 주문·판매·구매·생산 | inventory/_components/doc-screen.tsx:142, 325-328 | F | 로딩·오류에 '저장된 … 없습니다' (4메뉴 공통) | S |
| 품목 | inventory/products/page.tsx:70-74, 147-150 | F | 로딩 중 '없음', 0건 안내 없음 | S |
| 창고관리 | inventory/stock/page.tsx:434, 771-777 | E | 창고 탭 조회 줄에 이름 입력+파란 추가(표준은 팝업) | S |
| 창고관리 | inventory/stock/page.tsx:398-401 | 값 필터 | 수불부 창고 select 가 조회 줄 | S |
| 창고관리 | inventory/stock/page.tsx:486-489,541,639,667 | F | 4탭 로딩 미구별 | S |
| 현황 | inventory/status/page.tsx:488-492, 541-545 | B | 판매·구매현황 판 안 collect-tabs(두 층) | S |
| 현황 | inventory/status/page.tsx:444-468 | 목록 | 주문별 진행 표 Pager 없음 | M |
| 이익관리 | inventory/profit/page.tsx:450-480 | E·C | 원가 이력 위 설정·필터·재평가 폼 상자 3개 | M |
| 이익관리 | inventory/profit/page.tsx:341-344,498,508 | 목록·F | 300줄 말없이 자름 | S |
| 이익관리 | reports/_components/SalesBoard.tsx:192-274 | C | KPI 현황판 팝업 카드+판 5 | M |
| 이익관리 | inventory/profit/page.tsx:76, 312 | F | 원가 로딩 중 '판매가 없습니다' | S |

### 재무
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 통장·카드·수집 | collect/page.tsx:223-240 ↔ bank:1230, cards:1418, cash-receipts:1148 | A | 「전표처리」 선택 바 중복(tax-invoices:1726 은 이미 뺌) | M |
| 세금·증빙 | components/sidebar.tsx:118 | A(참고) | /cash-receipts·/e-invoices 들어가는 메뉴 없음 | M |
| 통장 | bank/page.tsx:893-895 (upcoming-auto-transfers:161, auto-transfer-history:132, top-expenses-month:91) | C | 개요 탭 glass-card 3장 | M |
| 통장 | bank/page.tsx:939-950, 785+831 vs 1230 | C·D | 빈 상태 카드 안 btn-primary, 파란 버튼 2개(카드 976/1418 동일) | S |
| 통장 | bank/page.tsx:334,372,941,1144 | F | 로딩·실패 = '연동된 통장 없음' | S |
| 카드 | cards/page.tsx:1116-1130 | C·A | 카드 누르면 표 아래 pnl-panel(자체 검색·표) — 거래내역과 중복 | M |
| 카드 | cards/page.tsx:285,379,1039-1045 / 1492-1493,1485,1523 | F·C·D | 로딩 미구별, 빈 상태 glass-card, 직접 칠한 버튼 | S |
| 거래처 | partners/page.tsx:1282 | B | 상세 팝업 seg-bar | S |
| 거래처 | partners/page.tsx:1316,1322,1332,1366,1397,1592 / 1520-1570 | C·E | 팝업 타일, 커뮤니케이션 탭 폼+목록 | M |
| 거래처 | partners/page.tsx:1272,1748,1878,1934,1947 (+1570,1681,1752,1882,1950) | D | 직접 칠한 버튼·btn-sm 없음 | S |
| 수집·전표 | collect/_components/BankTab.tsx:1151 | D | 매칭 제안 줄마다 btn-primary | S |
| 수집·전표 | EvidenceTab.tsx:223,1059-1064 · ExpenseClaimTab.tsx:109,265-272 · collect/page.tsx:106,274 | F | 오류 = '없음' | S |
| 세금·증빙 | tax-invoices/page.tsx:1756-1771 / 1777,1802 / 1524-1530 | C·D·F | 빈 상태 안 btn-primary, 0건 안내 없음, 로딩 때 상자 통째 교체 | S |
| 세금·증빙 | tax-invoices/page.tsx:1777 | C | QueryBody 안 max-h 스크롤 한 겹 더, ev-table 아님 | M |
| 현금영수증 | cash-receipts/page.tsx:784-969,793-798,967,1172 | E·D | 수동 등록 탭 상자 폼, 색 토글, w-full, 버튼 격자 | M |
| 일반전표 | partners/reconciliation/voucher-entry/page.tsx:237,1254 | F | 로딩 중 '저장된 전표 없음' | S |
| 매입매출전표 | partners/reconciliation/sale-purchase/page.tsx:258,1068,1070 | F·C | 로딩 없음, 좁은 화면 glass-card 카드 | M |
| 고정자산 | finance/assets/page.tsx:64,249 / 146-147 | F | 상각 이력·목록 로딩/실패 = '없음' | S |
| 세무 신고 | finance/tax-filing/page.tsx:566-568 | B | 지급명세서 안 ChipGroup 두 층 | S |
| 세무 신고 | finance/tax-filing/page.tsx:597-622 · reports/vat/_components/VatReturn.tsx:176,202,215 | C | pnl-grid2 카드 격자(결정 필요) | M |
| 세무 신고 ↔ 부가세 | components/sidebar.tsx:137,205 | A(참고) | 사이드바 '부가세' 두 번(내용 다름) | S |
| 정기 지출 | payments/layout.tsx:3 | A | 브라우저 탭 제목 '결제관리' ≠ 메뉴 '정기 지출' | S |
| 정기 지출 | payments/page.tsx:1238,1249,540-584,874-919 | D | 직접 칠한 버튼, btn-sm 없음 | S |
| 정기 지출 | payments/page.tsx:752,780-798,1421-1460 | C | 배치 상세 glass-card 요약 격자, 추천 타일 7 | S |
| 정기 지출 | payments/page.tsx:195/449,607/658,976/1190 | F | 3탭 로딩 중 '없음' | S |
| 재무 현황 | finance/status/page.tsx:305-480 | C | pnl-grid2 카드 격자(의도한 설계 — 결정 필요) | M |
| 재무 현황 | finance/status/page.tsx:244-247,333,357,479 / 472 | C·D | 앞 300줄 자름·Pager 없음, 줄마다 btn-primary 확정 | M |
| 재무 현황 | finance/status/page.tsx:435-444 | E | 처리할 것 탭 안 결산 초안 만들기 판 | M |
| 재무 현황 | finance/status/page.tsx:50 | A(참고) | 탭 이름이 사이드바 메뉴와 같음(일반전표·매입매출전표) | S |

### 분석
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 회계 자료 | reports/statements/page.tsx:31-43 | A·C | 허브 카드 7장 = 머리 탭 7개(ReportsTabs.tsx:115-124) 중복, 켜진 탭 없음 | S |
| 부가세 | reports/vat/_components/VatReport.tsx:27-40 | B | 월별·분기별·연간 본문 seg-bar | S |
| 부가세 | VatReport.tsx:225-253,357-367 / vat/page.tsx:69-76 | C | KPI glass-card 3장, 안내 판, 직접 색 | S |
| 부가세 | VatReport.tsx:43-48 | F | 로딩 중 '데이터가 없습니다' | S |
| 재무상태표 | reports/bs/page.tsx:591-605, 850-870 | C | 합계 타일이 Stat 과 겹침, 비율 KPI 카드 | M |
| 손익계산서 | reports/pnl/page.tsx:615-621 / 575-592 | D·F | 전기 비교 토글 btn-primary, 로딩·오류 때 ReportHead 사라짐(bs 475-501 동일) | S |
| 비용 분석 | reports/costs/page.tsx:234,249,309,351 | C | glass-card 판 4, 인라인 style, 이모지 빈 상태 | M |
| 인원별 급여 | reports/by-person/page.tsx:231-266 | C | 표 아닌 glass-card 랭크 바 목록 | M |
| 3-Way 매칭 | reports/three-way-match/page.tsx:125,164,232,193-196 | C·D | 카드 버튼 목록, **줄 클릭 = 즉시 확정** | L |
| 경영 요약·자금 전망·예정 항목·월별 흐름 | summary:132, outlook:204,280, upcoming:105, flow:210 | F | 실패해도 '불러오는 중…' 계속 | S |
| 손익 현황 | reports/_components/PnlStatusKit.tsx:35, monthly/page.tsx:210 | F | 실패 = '확정 전표가 없습니다' | S |
| 손익 현황 ↔ 회계 자료 | ReportsTabs.tsx:93 vs 121, summary/page.tsx:187 | A(참고) | 「비용」과 「비용 분석」 둘 다, 링크가 엇갈림 | S |
| 거래처 원장 | partners/ledger/shared.tsx:243 + page.tsx:521 | D | 체크하면 파란 버튼 2개 | S |
| 거래처 원장 | partners/ledger/shared.tsx:1043-1056, 795-796 | C·D | 팝업 필터 탭 직접 칠함, 요약 타일, btn-sm 없음 | S |
| 거래처 원장 | partners/ledger/page.tsx:~421-428 | F | 실패 = '거래 없음' | S |

이상 없음: 전자계산서, 주문·판매·구매·생산 B·C·D, 경영 요약·손익 현황·자금 전망 본문 구조, 계정별 원장, 현금흐름표.

---

## 업무·인사(근로계약·서식)·설정·도움말 상세
A(사이드바·화면 탭 같은 이동 두 번) 없음 — 설정은 사이드바 5그룹 + 화면 하위 탭(SettingsShell.tsx:357).

### 업무
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 일정 / 할 일 | schedule/page.tsx:225-232 | 값 필터 | 달력 조회 줄 부서 select, 검색조건 패널 없음 | S |
| 일정 / 할 일 | schedule/page.tsx:57-62 | 참고 | 달력/목록(보기)이 갈래 탭 | S |
| 프로젝트 목록 | projecthub/page.tsx:1007-1010 | C | 전체 현황판 팝업 KPI 카드 4 + 판 | S |
| 프로젝트 목록 | projecthub/page.tsx:349,825 · ListViews.tsx:77,181-228,280 | 참고 | listView 가 table 뿐 — 타임라인·차트·달력 죽은 코드(언급만) | — |
| 프로젝트 상세 | projecthub/[id]/_v3/TableV3.tsx:1725-1765 | B | QueryScreen 아닌 자체 머리·보기 칩·툴바, 검색 즉시 반영 | L |
| 프로젝트 상세 | TableV3.tsx:1771-1776 · 1778-1790 · 1796-1866 | B·C | 현황 보기 안 두 번째 탭 줄 + KPI 카드 6 + 판 | M |
| 결재 허브 | approvals/page.tsx:1297-1309, 2744-2756 | D | 승인/반려 폭 전체 알약, 승인 bg-success | S |
| 결재 허브 | approvals/page.tsx:3393 · 4050,4056,4071 | C | 새 요청 glass-card 폼 + 미리보기 2~3 | M |
| 결재 허브 | approvals/page.tsx:3735 | 참고 | 경비 폼 안 seg-bar 2택 | S |
| 결재 허브 | approvals/page.tsx:4920,4943,5082 | D | 결재자 변경·의견·댓글 버튼 직접 칠함 | S |
| 결재 허브 | approvals/page.tsx:802-809 | E | 결재함 탭 줄에 양식 관리·결재선 관리·새 요청 | M |
| 게시판 | board/page.tsx:1080,1117,1586,1663 | D | btn-primary 에 btn-sm 없음, 댓글·답글 파란 버튼 여러 개 | S |
| 메신저 | chat/page.tsx:583, 690 | D | + 버튼 직접 칠함, 만들기 창 btn-primary w-full | S |
| 메신저 | chat/page.tsx:566-567, 594-649 | A(참고) | 레일 '일정'·'구성원'이 사이드바 메뉴와 같은 기능 | — |
| 전자계약 | signatures/page.tsx:562-568 | 참고 | 양식 관리 탭 — 양식 화면 4곳 흩어짐 | — |
| 계약 대장 | contracts/page.tsx:169-186 | 참고 | 상태 탭 숫자와 요약 숫자 중복 | S |
| 계약 대장 | contracts/page.tsx:88, 190-194 | F | 조회 오류 = '아직 계약 문서가 없습니다' | S |
| 파일보관함 | documents/_components/VaultExplorer.tsx:380-440 | 참고 | 자체 탐색기 디자인(의도) | — |
| 문서 상세(?id=) | documents/page.tsx:1075-1087 · 1105,1154,1218,1298,1372,1457,1486 · 1128,1385 | B·C·D | 본문 seg-bar, glass-card 쌓기, 발행 w-full 직접 칠함 | M |
| 구성원 디렉토리 | — | — | 이상 없음 | — |

### 인사
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 근로계약·서식 | hr-templates/page.tsx:47-51,117-126 → components/templates-tab.tsx:400-405 | F | **로딩 중 '아직 양식이 없습니다 + 기본 양식 등록하기' → 누르면 중복 등록 위험** | S |
| 근로계약·서식 | hr-templates/page.tsx:53-57 → _components/ContractAdminPanel.tsx:608-610 | F | 계약 목록 로딩 중 '없음' | S |
| 근로계약·서식 | components/hr-form-manager.tsx:255,276,351 | C·D | 서식 탭 glass-card 상자, 업로드·출력 직접 칠함 | S |
| 근로계약·서식 | ContractAdminPanel.tsx:356-358, 360-366 | 값 필터·C | 상태 ChipGroup(값 필터) 조회 줄, 같은 숫자 요약 반복 | S |
| 근로계약·서식 | ContractAdminPanel.tsx:670-677, 766 | D | 임시저장 줄마다 파란 서명 요청 + 선택 바 파란 버튼 | S |
| 근로계약·서식 | ContractAdminPanel.tsx:370-371, 597 | 참고 | showTemplateEditor 켜는 곳 없음(언급만) | — |

### 설정
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 설정 5그룹 전체 | globals.css:7751-7752, 7761, 7775-7776 | C | .stg-main .glass-card·.stg-card·.stg-sec 둥근 상자(오늘 근무 기준과 같은 유형) | M (공용 CSS — 이 PC) |
| 자금·통장 | settings/_components/SettingsShell.tsx:392-418 · 468,596,692 | C·D | KPI 타일 4(stg-statband), btn-sm 없는 파란 저장 3 | S |
| 회사정보 | CompanyInfoTab.tsx:310,318 · 491,618,938,979,1162 | C·D | 로딩 glass-card, 파란 버튼 5(2개 btn-sm 없음) | S |
| 회계마감 | AccountingClosingTab.tsx:383 · 212,339 · SettingsShell.tsx:852 | D | 저장 w-full, 토글 직접 칠함, btn-sm 없음 | S |
| 구성원·초대 | DepartmentsTab.tsx:110,144 · TeamManagement.tsx:412 | D | btn-primary h-9, 직접 칠함 | S |
| 계정과목·분류 | DealClassificationManager.tsx:98 | D | btn-sm 없음 | S |
| 요금제 | billing/_components/TossCardSection.tsx:126 · billing/page.tsx:1339 | C·D | 카드 등록 glass-card, 팝업 버튼 직접 칠함 | S |

### 도움말
| 메뉴 | 파일:줄 | 유형 | 문제 | 크기 |
|---|---|---|---|---|
| 공지사항 | — | — | 이상 없음 | — |
| 사용 가이드 | guide/page.tsx:719-721,740-748,707-708 | C·참고 | 카드 그리드, 자체 검색(즉시 반영). 콘텐츠라 경미 | S |
| 고객센터 | support/page.tsx:244,335 · 247-259 · 328 · 357-362 | C | glass-card 2, 유형 카드 격자, 내역 카드 목록, 폼이 본문 | M |
