#!/bin/bash
# LeanOS — launchd 스케줄 설치/해제
# 실행: bash scripts/install-schedule.sh [install|uninstall|status]

PLIST_NAME="com.leanos.ibk-daily"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/${PLIST_NAME}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/Downloads/leanos-bank/logs"

case "${1:-status}" in
  install)
    echo "=== LeanOS IBK 스케줄 설치 ==="

    # 로그 디렉토리 생성
    mkdir -p "$LOG_DIR"

    # 기존 등록 해제
    launchctl unload "$PLIST_DST" 2>/dev/null || true

    # plist 복사
    cp "$PLIST_SRC" "$PLIST_DST"
    echo "plist 복사: $PLIST_DST"

    # 등록
    launchctl load "$PLIST_DST"
    echo "launchd 등록 완료"

    # 확인
    if launchctl list | grep -q "$PLIST_NAME"; then
      echo ""
      echo "설치 완료! 매일 오전 9:30에 IBK 거래내역을 자동 다운로드합니다."
      echo ""
      echo "전제 조건:"
      echo "  1. Chrome이 --remote-debugging-port=9222 로 실행 중"
      echo "  2. Keychain에 IBK 인증서 비밀번호 등록 (bash scripts/setup-keychain.sh)"
      echo "  3. 인터넷 연결"
      echo ""
      echo "수동 실행: bash scripts/ibk-daily.sh"
      echo "로그 확인: ls $LOG_DIR/"
      echo "해제: bash scripts/install-schedule.sh uninstall"
    else
      echo "ERROR: 등록 실패"
      exit 1
    fi
    ;;

  uninstall)
    echo "=== LeanOS IBK 스케줄 해제 ==="
    launchctl unload "$PLIST_DST" 2>/dev/null && echo "launchd 해제 완료" || echo "이미 해제됨"
    rm -f "$PLIST_DST" && echo "plist 삭제: $PLIST_DST" || true
    echo "해제 완료"
    ;;

  status)
    echo "=== LeanOS IBK 스케줄 상태 ==="
    if launchctl list | grep -q "$PLIST_NAME"; then
      echo "상태: 등록됨 (활성)"
      launchctl list | grep "$PLIST_NAME"
    else
      echo "상태: 미등록"
      echo "설치: bash scripts/install-schedule.sh install"
    fi

    if [ -d "$LOG_DIR" ]; then
      LATEST=$(ls -t "$LOG_DIR"/ibk-*.log 2>/dev/null | head -1)
      if [ -n "$LATEST" ]; then
        echo ""
        echo "최근 로그: $LATEST"
        echo "---"
        tail -5 "$LATEST"
      fi
    fi
    ;;

  *)
    echo "사용법: bash scripts/install-schedule.sh [install|uninstall|status]"
    ;;
esac
