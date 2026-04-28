#!/bin/bash
# OwnerView QA 자동 모니터 — Max 구독 활용 (추가 비용 0원)
# crontab: */5 9-18 * * 1-5 /Users/motive/lean-os/scripts/qa-monitor.sh

set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$PATH"
export HOME="/Users/motive"

PROJECT_DIR="/Users/motive/lean-os"
REPO="motiveinno-jpg/motive-team"
ISSUE_NUM=3
STATE_FILE="${PROJECT_DIR}/.qa-last-comment-id"
LOG_FILE="${PROJECT_DIR}/.qa-monitor.log"
LOCK_FILE="${PROJECT_DIR}/.qa-monitor.lock"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR" "$LOCK_FILE"' EXIT

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

# 중복 실행 방지
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"

cd "$PROJECT_DIR"
log "체크 시작 (PID $$)"

LAST_ID=$(cat "$STATE_FILE" 2>/dev/null || echo "0")

# 전체 코멘트 조회 — 임시파일로 처리 (변수 크기 제한 회피)
gh api "repos/${REPO}/issues/${ISSUE_NUM}/comments?per_page=100" --paginate \
  > "$TMP_DIR/raw.json" 2>/dev/null || echo "[]" > "$TMP_DIR/raw.json"

jq -s 'add // []' "$TMP_DIR/raw.json" > "$TMP_DIR/all.json" 2>/dev/null || echo "[]" > "$TMP_DIR/all.json"

TOTAL_COUNT=$(jq 'length' "$TMP_DIR/all.json" 2>/dev/null || echo "0")
log "총 코멘트 ${TOTAL_COUNT}건 조회"

if ! jq -e 'type == "array"' "$TMP_DIR/all.json" >/dev/null 2>&1; then
  log "GitHub API 응답 오류 — 배열이 아님"
  exit 1
fi

# 새 코멘트 필터링 (봇/오너 제외, 자동수정 보고 제외)
jq --arg last "$LAST_ID" '
  [.[] |
    select(.id > ($last | tonumber)) |
    select(.user.login != "motiveinno-jpg") |
    select(.user.login != "github-actions[bot]") |
    select(.body | test("자동수정|수정 완료|수정 보고") | not)
  ]' "$TMP_DIR/all.json" > "$TMP_DIR/new.json" 2>/dev/null || echo "[]" > "$TMP_DIR/new.json"

COUNT=$(jq 'length' "$TMP_DIR/new.json" 2>/dev/null || echo "0")

if [ "$COUNT" = "0" ] || [ "$COUNT" = "null" ]; then
  log "새 코멘트 없음 — 대기"
  exit 0
fi

log "새 QA 코멘트 ${COUNT}건 발견"

# 새 코멘트 합치기
MERGED_BODY=""
MERGED_AUTHORS=""
LATEST_ID="$LAST_ID"

for i in $(seq 0 $((COUNT - 1))); do
  AUTHOR=$(jq -r ".[$i].user.login" "$TMP_DIR/new.json")
  BODY=$(jq -r ".[$i].body" "$TMP_DIR/new.json")
  CID=$(jq -r ".[$i].id" "$TMP_DIR/new.json")
  MERGED_BODY="${MERGED_BODY}

--- @${AUTHOR} ---
${BODY}
"
  MERGED_AUTHORS="${MERGED_AUTHORS} @${AUTHOR}"
  if [ "$CID" -gt "$LATEST_ID" ]; then
    LATEST_ID="$CID"
  fi
done

log "Claude Code 실행 시작"

/Users/motive/.local/bin/claude -p "
당신은 OwnerView(오너뷰) QA 자동 수정 에이전트입니다.
프로젝트: ${PROJECT_DIR}
라이브: www.owner-view.com

## 새 QA 코멘트 (${COUNT}건)
${MERGED_BODY}

## 작업 순서
1. 각 코멘트에서 수정할 이슈 파악
2. 해당 소스 파일을 읽고 수정
3. npm run build 빌드 검증
4. 빌드 성공 시 git add + commit + push
5. 절대 빌드 실패 상태로 커밋하지 마세요

## 커밋 메시지
fix(qa): [요약] — GitHub QA 자동수정
Relates to motiveinno-jpg/motive-team#3
Co-Authored-By: Claude Code <noreply@anthropic.com>

## 커밋 메시지 금지사항 (매우 중요!)
- 커밋 본문에 #1, #2, #3 같은 해시+숫자 절대 금지 (GitHub 이슈 자동 링크됨)
- QA 항목 번호는 Q1, Q2, Q3 또는 (1), (2), (3) 형식으로

## 완료 후
수정 내역을 한국어로 간결하게 요약해주세요.
" --dangerously-skip-permissions --max-turns 30 2>&1 | tee -a "$LOG_FILE" | tail -5

# 커밋 해시 확인
HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "none")
CHANGED=$(git diff --name-only HEAD~1 HEAD -- src/ 2>/dev/null | sed 's/^/- `/' | sed 's/$/`/' || echo "")

if [ -n "$CHANGED" ]; then
  gh issue comment "$ISSUE_NUM" --repo "$REPO" --body "## QA 자동수정 완료 ($(TZ=Asia/Seoul date '+%m/%d %H:%M'))

커밋: \`${HASH}\` — Vercel 자동 배포

${MERGED_AUTHORS} 님의 QA 기반 자동 수정:

### 변경 파일
${CHANGED}

www.owner-view.com 에서 확인 가능합니다."
  log "수정 완료 — 커밋 ${HASH}"
else
  log "코드 변경 없음"
fi

# 상태 저장 — 처리 완료 후에만 저장 (실패 시 재시도 가능)
echo "$LATEST_ID" > "$STATE_FILE"
