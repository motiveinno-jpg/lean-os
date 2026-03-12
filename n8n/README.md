# LeanOS n8n 자동화 가이드

## 은행 거래내역 자동 수집

### 방법 1: 이메일 자동 수집 (추천)
대부분의 은행에서 "거래내역 이메일 알림" 또는 "일별 거래내역 발송" 서비스를 제공합니다.

1. 은행 인터넷뱅킹에서 "거래내역 이메일 발송" 설정
2. n8n에서 `bank-auto-import-workflow.json` 임포트
3. IMAP 이메일 트리거 활성화 + 이메일 서버 정보 입력
4. `x-api-key` 헤더에 company_id 입력: `c361afb9-8a52-4cac-add9-8992f0f7c09c`

### 방법 2: 수동 CSV 드롭 자동화
1. 은행에서 CSV 다운로드
2. Google Drive / Dropbox 특정 폴더에 드롭
3. n8n에서 Google Drive Trigger로 감시 → CSV 파싱 → LeanOS API 전송

### 방법 3: 스크래핑 (고급)
n8n의 Puppeteer 노드로 은행 웹사이트 로그인 → 거래내역 다운로드 자동화 가능.
보안 주의 필요 (OTP 등).

## API 엔드포인트

### POST receive-bank-transactions
```
URL: https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/receive-bank-transactions
Header: x-api-key: {company_id}
```

#### Request Body
```json
{
  "transactions": [
    {
      "transaction_date": "2026-03-01",
      "amount": 1500000,
      "type": "income",
      "counterparty": "주식회사 ABC",
      "description": "수출바우처 대금",
      "balance_after": 52000000
    }
  ],
  "source": "n8n"
}
```

#### Response
```json
{
  "success": true,
  "total": 1,
  "auto_mapped": 0,
  "unmapped": 1
}
```

## 자동 분류 규칙
LeanOS 설정 > 거래내역 > 분류 규칙 탭에서 관리.

| 필드 | 설명 |
|------|------|
| match_field | counterparty / description / memo |
| match_type | contains (포함) / exact (정확) / regex (정규식) |
| match_value | 매칭할 텍스트 |
| assign_category | 고정비 / 변동비 / 매출 / 기타 |
| assign_deal_id | 연결할 딜 ID |
| is_fixed_cost | 고정비 여부 |

예시:
- "스파크플러스" 포함 → 고정비, 카테고리=고정비
- "그릭데이" 포함 → 딜 연결, 카테고리=매출
- "급여" 포함 → 고정비, 카테고리=고정비

## 은행별 CSV 컬럼 매핑

| 은행 | 날짜 | 입금 | 출금 | 잔액 | 적요 |
|------|------|------|------|------|------|
| 국민 | 거래일시 | 입금액 | 출금액 | 거래후잔액 | 적요 |
| 신한 | 거래일 | 입금 | 출금 | 잔액 | 적요 |
| 우리 | 거래일자 | 입금금액 | 출금금액 | 거래후잔액 | 적요 |
| 하나 | 거래일 | 입금액 | 출금액 | 잔액 | 거래내용 |
| 기업 | 거래일자 | 입금 | 출금 | 잔액 | 적요 |

n8n Function 노드에서 은행에 맞게 매핑을 조정하세요.
