# Scrapling 적용 계획 — MOTIVE 프로젝트

## 적용 가능 영역

### 1. Whistle AI (최우선)

| 기능 | 현재 | Scrapling 도입 후 |
|------|------|-----------------|
| **제조사 분석** | URL 입력 → Claude Vision만 | URL 크롤링 → 제품/가격/카테고리 자동 수집 → AI 분석 |
| **HS코드 분류** | 수동 입력 | 유사 상품 크롤링 → 기존 HS코드 매핑 (85% 자동화) |
| **경쟁사 분석** | 없음 | 경쟁 제품 자동 수집 → 가격/사양 비교표 생성 |
| **바이어 발굴** | 수동 | 해외 B2B 플랫폼 크롤링 → 잠재 바이어 리스트 |

### 2. LeanOS/OwnerView (중기)

| 기능 | 현재 | Scrapling 도입 후 |
|------|------|-----------------|
| **거래처 등록** | 수동 입력 | 회사명 입력 → 사업자정보 자동 조회/채우기 |
| **세금계산서** | 엑셀 임포트 | PDF OCR → 자동 추출 |
| **자산 발견** | 거래 패턴만 | SaaS 구독 페이지 크롤링 → 상세 정보 자동 입력 |

### 3. Outreach Engine (Task #160)

| 기능 | 설명 |
|------|------|
| **Lead 크롤러** | 타겟 회사 웹사이트 → 회사명/업종/연락처 자동 수집 |
| **미니 분석** | 수집 데이터 → Claude 분석 → 수출 잠재력 점수 |
| **자동 이메일** | 맞춤형 피치 이메일 자동 생성 + 발송 + 추적 |

---

## 통합 아키텍처

```
┌──────────────────────────────────┐
│  프론트엔드 (JS/TS)              │
│  Whistle.html / LeanOS Next.js   │
└──────────┬───────────────────────┘
           │ HTTP Request
           ▼
┌──────────────────────────────────┐
│  Supabase (공유 DB)              │
│  Edge Functions (Deno)           │
│  → N8N Webhook 트리거            │
└──────────┬───────────────────────┘
           │ Webhook / REST
           ▼
┌──────────────────────────────────┐
│  Python Scrapling Service        │
│  FastAPI + Scrapling + Claude    │
│                                  │
│  엔드포인트:                      │
│  POST /crawl/manufacturer        │
│  POST /crawl/competitors         │
│  POST /crawl/leads               │
│  POST /lookup/business-info      │
│  POST /extract/tax-invoice       │
│                                  │
│  배포: Docker → AWS Lambda       │
└──────────────────────────────────┘
```

---

## 구현 우선순위

### Phase 0: 검증 (1주)
- [ ] Scrapling 설치 + 기본 테스트
- [ ] 한국 이커머스 API 테스트 (11st, Gmarket)
- [ ] Python ↔ Supabase 연결 검증
- [ ] 해외 B2B 사이트 크롤링 테스트 (Alibaba, Global Sources)

### Phase 1: Whistle AI 고도화 (2주)
- [ ] FastAPI 마이크로서비스 구축
- [ ] 제조사 URL 크롤링 엔진
- [ ] HS코드 자동 분류
- [ ] 경쟁사 데이터 수집
- [ ] Whistle.html ↔ Python API 연동

### Phase 2: LeanOS 자동화 (1주)
- [ ] 사업자정보 자동 조회 API
- [ ] 세금계산서 OCR 추출
- [ ] Import Hub 통합

### Phase 3: Outreach Engine (2주)
- [ ] Lead 크롤러 + DB 저장
- [ ] Claude 기반 미니 분석
- [ ] 이메일 자동 발송 파이프라인

---

## 법적 주의사항

- 공식 API 우선 사용 (11st Open API, Gmarket ET API, 사업자정보공개 API)
- robots.txt 준수 (Disallow 경로 크롤링 금지)
- 한국 이커머스 대형 플랫폼 (쿠팡, 네이버, SSG) 직접 크롤링 불가 (차단 + 법적 위험)
- 수집 데이터 상업적 활용 시 개별 법적 검토 필요
