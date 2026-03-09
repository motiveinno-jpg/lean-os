#!/bin/bash
# LeanOS — macOS Keychain 비밀번호 1회 등록
# 실행: bash scripts/setup-keychain.sh

echo "=================================="
echo "  LeanOS Keychain 비밀번호 등록"
echo "=================================="
echo ""

echo "공동인증서 비밀번호를 입력하세요 (IBK/홈택스 공통):"
read -s CERT_PW
if [ -z "$CERT_PW" ]; then
  echo "비밀번호가 비어 있습니다. 종료합니다."
  exit 1
fi

# IBK 인증서
security add-generic-password -s "leanos-ibk-cert-pw" -a "cert" -w "$CERT_PW" -U 2>/dev/null
echo "  IBK 인증서: $([ $? -eq 0 ] && echo OK || echo FAIL)"

# 홈택스
security add-generic-password -s "leanos-hometax" -a "cert" -w "$CERT_PW" -U 2>/dev/null
echo "  홈택스: $([ $? -eq 0 ] && echo OK || echo FAIL)"

# 롯데카드 (ID: chae8512, PW: 동일)
security add-generic-password -s "leanos-lottecard" -a "chae8512" -w "$CERT_PW" -U 2>/dev/null
echo "  롯데카드: $([ $? -eq 0 ] && echo OK || echo FAIL)"

echo ""
echo "=== 등록 확인 ==="
security find-generic-password -s "leanos-ibk-cert-pw" -a "cert" >/dev/null 2>&1 && echo "IBK: OK" || echo "IBK: 미등록"
security find-generic-password -s "leanos-hometax" -a "cert" >/dev/null 2>&1 && echo "홈택스: OK" || echo "홈택스: 미등록"
security find-generic-password -s "leanos-lottecard" -a "chae8512" >/dev/null 2>&1 && echo "롯데카드: OK" || echo "롯데카드: 미등록"
echo ""
echo "완료. 비밀번호 변경 시 다시 실행하세요."
