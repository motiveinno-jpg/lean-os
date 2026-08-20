# -*- coding: utf-8 -*-
"""소개서 v2 — 조각·전체 화면 크롭 (2026-08-20)
   · 사용 예시 장표: 사이드바를 뺀 **본문 영역 전체**(제품 화면 그대로)
   · 기능 3단 밴드: 설명 항목별 **조각**
   좌표는 CSS px(1600×1000) 기준, 캡처는 2배(3200×2000)."""
from PIL import Image
import os

OUT = "cap/v2"
os.makedirs(OUT, exist_ok=True)

def cut(src, name, box):
    p = f"cap/{src}.png"
    if not os.path.exists(p):
        print("MISS", src); return
    im = Image.open(p)
    b = tuple(int(v * 2) for v in box)
    o = im.crop(b)
    o.save(f"{OUT}/{name}.png")
    print(f"{name:22} {o.size[0]:>5}x{o.size[1]}")

# ── 사용 예시 8장 — **화면 전체**(사이드바 포함). 자르지 않는다.
#   2026-08-20 사장님: "칸에 딱 한눈에 들어오게 · 은행 로고까지 · 사이드메뉴까지 같이 다 보이게"
#   → 크롭 없이 원본(3200×2000)을 그대로 복사해 쓴다.
import shutil
for src, dst in [("01-dashboard-full", "use-dash"), ("v-bank", "use-bank"),
                 ("v-sale-purchase", "use-voucher"), ("v-tax", "use-tax"),
                 ("v-flow", "use-flow"), ("v-profit", "use-profit"),
                 ("v-pb-revenue", "use-project"), ("v-att", "use-att")]:
    sp = f"cap/{src}.png"
    if os.path.exists(sp):
        shutil.copyfile(sp, f"{OUT}/{dst}.png")
        print(f"{dst:22} {Image.open(sp).size[0]}x{Image.open(sp).size[1]} (전체)")
    else:
        print("MISS", src)

# ── 기능 장표(13~19)·설명 장표에 쓰는 이미지도 **전체 화면** 그대로 (2026-08-20 사장님 지시)
#   조각으로 자르면 무슨 화면인지 알기 어렵고, 사이드바가 없어 제품처럼 안 보인다.
FULLMAP = {
    "f-bank":      "v-bank",             # 통장
    "f-cards":     "v-cards",            # 카드
    "f-collect":   "v-collect",          # 수집
    "f-tax":       "v-tax",              # 세금계산서
    "f-voucher":   "v-sale-purchase",    # 매입매출전표
    "f-dash":      "01-dashboard-full",  # 대시보드(신호·브리핑)
    "f-flow":      "v-flow",             # 경영흐름
    "f-profit":    "v-profit",           # 손익
    "f-vat":       "v-vat",              # 부가세
    "f-ledger":    "v-ledger2",          # 거래처 원장
    "f-emp":       "v-emp",              # 구성원
    "f-att":       "v-att",              # 근태
    "f-sched":     "v-sched",            # 일정
    "f-sign":      "v-sign",             # 전자계약
    "f-appr":      "v-appr",             # 결재
    "f-perm":      "v-perm",             # 권한
    "f-copilot":   "v-copilot",          # AI 참모
    "f-billing":   "v-billing",          # 요금제
    "f-projects":  "v-projects",         # 프로젝트 목록
    "f-contract":  "v-pb-contract",      # 계약·갱신
    "f-spend":     "v-pb-spend",         # 예산·지출
    "f-meeting":   "v-pb-meeting",       # 회의·결정
    "f-deal":      "v-pb-revenue",       # 매출 흐름
    "f-todo":      "v-pb-todo",          # 할 일
    "f-templates": "v-pb-todo",          # 템플릿(할 일 화면으로 대체)
}
for dst, src in FULLMAP.items():
    sp = f"cap/{src}.png"
    if os.path.exists(sp):
        shutil.copyfile(sp, f"{OUT}/{dst}.png")
    else:
        print("MISS", src)
print(f"기능 이미지 {len(FULLMAP)}개 → 전체 화면으로 교체")
print("done ->", OUT)
