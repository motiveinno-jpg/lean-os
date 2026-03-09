#!/bin/bash
# LeanOS IBK Daily Download — launchd 래퍼 스크립트
# Chrome CDP가 활성화되어 있을 때만 실행

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$HOME/Downloads/leanos-bank/logs"
LOG_FILE="$LOG_DIR/ibk-$(date +%Y%m%d).log"
TELEGRAM_BOT="@motive_hajun_bot"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

send_telegram() {
  # 텔레그램 알림 (봇 토큰이 설정되어 있을 때만)
  local msg="$1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${msg}" \
      -d "parse_mode=HTML" > /dev/null 2>&1 || true
  fi
}

log "=== IBK 자동 다운로드 시작 ==="

# 1. Chrome CDP 확인
if ! curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
  log "ERROR: Chrome CDP 미연결 (포트 9222)"
  log "Chrome이 --remote-debugging-port=9222 로 실행 중이어야 합니다."
  send_telegram "[Atlas] IBK 자동 다운로드 실패: Chrome CDP 미연결"
  exit 1
fi

# 2. Keychain 비밀번호 확인
if ! security find-generic-password -s "leanos-ibk-cert-pw" -a "cert" -w > /dev/null 2>&1; then
  log "ERROR: Keychain에 IBK 인증서 비밀번호 미등록"
  send_telegram "[Atlas] IBK 자동 다운로드 실패: Keychain 비밀번호 없음"
  exit 1
fi

# 3. 실행
log "npx tsx scripts/local-agent.ts bank 실행..."
cd "$PROJECT_DIR"

# PATH에 node/npx 포함
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if npx tsx scripts/local-agent.ts bank >> "$LOG_FILE" 2>&1; then
  log "=== 완료: 성공 ==="
  send_telegram "[Atlas] IBK 거래내역 자동 다운로드 완료 ($(date '+%m/%d %H:%M'))"
else
  EXIT_CODE=$?
  log "=== 완료: 실패 (exit $EXIT_CODE) ==="
  send_telegram "[Atlas] IBK 자동 다운로드 실패 (exit $EXIT_CODE). 로그: $LOG_FILE"
  exit $EXIT_CODE
fi

# 4. 오래된 로그 정리 (30일 이상)
find "$LOG_DIR" -name "ibk-*.log" -mtime +30 -delete 2>/dev/null || true
