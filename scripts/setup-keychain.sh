#!/bin/bash
# LeanOS — macOS Keychain 비밀번호 1회 등록
# 실행: bash scripts/setup-keychain.sh

echo "=================================="
echo "  LeanOS Keychain 비밀번호 등록"
echo "=================================="
echo ""

echo "IBK 기업은행 공동인증서 비밀번호를 입력하세요:"
read -s IBK_PW
if [ -z "$IBK_PW" ]; then
  echo "비밀번호가 비어 있습니다. 건너뜁니다."
else
  security add-generic-password -s "leanos-ibk-cert-pw" -a "cert" -w "$IBK_PW" -U 2>/dev/null
  if [ $? -eq 0 ]; then
    echo "IBK 인증서 비밀번호 등록 완료"
  else
    echo "등록 실패 — Keychain 접근 권한을 확인하세요"
  fi
fi
echo ""

echo "홈택스 비밀번호를 입력하세요 (건너뛰려면 Enter):"
read -s HT_PW
if [ -z "$HT_PW" ]; then
  echo "건너뜁니다."
else
  security add-generic-password -s "leanos-hometax" -a "cert" -w "$HT_PW" -U 2>/dev/null
  if [ $? -eq 0 ]; then
    echo "홈택스 비밀번호 등록 완료"
  else
    echo "등록 실패"
  fi
fi

echo ""
echo "=== 등록 확인 ==="
security find-generic-password -s "leanos-ibk-cert-pw" -a "cert" 2>/dev/null && echo "IBK: OK" || echo "IBK: 미등록"
security find-generic-password -s "leanos-hometax" -a "cert" 2>/dev/null && echo "홈택스: OK" || echo "홈택스: 미등록"
echo ""
echo "완료. 비밀번호 변경 시 이 스크립트를 다시 실행하세요."
