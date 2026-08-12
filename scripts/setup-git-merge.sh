#!/usr/bin/env bash
# 두 PC 동시 작업용 git 설정 — **PC 마다 한 번씩** 실행한다 (2026-08-12 사장님 지시)
#
#   `.gitattributes` 는 저장소에 커밋되지만, ① `merge=ours` 드라이버 정의와
#   ② 충돌 마커 커밋 차단 훅은 **로컬 설정**이라 PC 마다 깔아야 한다.
#
#   실행:  bash scripts/setup-git-merge.sh
set -e
cd "$(dirname "$0")/.."

# ── ① merge=ours 드라이버 — 생성물 파일은 우리 것을 그대로 쓴다 ──
git config merge.ours.driver true
git config merge.ours.name "우리 것을 그대로 둔다 (생성물 파일용)"

# ── ② 충돌 마커가 커밋되는 것을 막는다 ──
#   2026-08-12 실제 사고: 다른 PC 가 globals.css 에 <<<<<<< 마커를 그대로 커밋해
#   origin/main 에 올라갔다. CSS 가 깨지면 **앱 전 화면이 500** 이고 tsc·lint 는 못 잡는다.
mkdir -p .git/hooks
cat > .git/hooks/pre-commit <<'HOOK'
#!/usr/bin/env bash
#   스테이지에 올라간 텍스트 파일에 충돌 마커가 있으면 커밋을 막는다.
files=$(git diff --cached --name-only --diff-filter=ACM)
bad=""
for f in $files; do
  case "$f" in *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.pdf|*.zip|*.msi|*.woff*) continue;; esac
  [ -f "$f" ] || continue
  if git show ":$f" 2>/dev/null | grep -qE '^(<<<<<<< |=======$|>>>>>>> )'; then
    bad="$bad  $f\n"
  fi
done
if [ -n "$bad" ]; then
  echo "커밋을 막았습니다 — 충돌 마커가 남아 있는 파일이 있습니다:"
  printf "$bad"
  echo "충돌을 풀고 마커(<<<<<<< ======= >>>>>>>)를 지운 뒤 다시 커밋하세요."
  echo "(globals.css 는 .gitattributes 의 union 병합으로 보통 저절로 풀립니다)"
  exit 1
fi
HOOK
chmod +x .git/hooks/pre-commit

echo "설정 완료:"
echo "  · globals.css/landing*.css → union 병합 (양쪽 규칙을 다 남긴다. 우리 것이 지워지지 않는다)"
echo "  · release-log.json         → 우리 것 그대로"
echo "  · pre-commit               → 충돌 마커가 남아 있으면 커밋 차단"
