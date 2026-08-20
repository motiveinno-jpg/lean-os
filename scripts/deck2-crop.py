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

# ── 사용 예시 8장 — 본문 영역(사이드바 제외) 전체 ──
#   좌: 헤더 아래 본문 시작 x=390 / 위: 상단 바 아래 y=95 / 우·아래: 화면 끝
FULL = (345, 88, 1585, 960)
cut("01-dashboard-full", "use-dash",    (345, 88, 1585, 960))
cut("v-bank",           "use-bank",     FULL)
cut("v-sale-purchase",  "use-voucher",  FULL)
cut("v-tax",            "use-tax",      FULL)
cut("v-flow",           "use-flow",     FULL)
cut("v-ledger2",        "use-ledger",   FULL)
cut("v-pb-revenue",     "use-project",  FULL)
cut("v-att",            "use-att",      FULL)

# ── 기능 장표 조각 (3단 밴드의 카드 안에 들어감) ──
cut("v-bank",          "f-bank-accounts", (350, 285, 1560, 509))
cut("v-cards",         "f-cards",         (350, 258, 1560, 482))
cut("v-collect",       "f-collect",       (350, 168, 1560, 392))
cut("v-tax",           "f-tax",           (350, 236, 1560, 460))
cut("v-sale-purchase", "f-voucher",       (350, 232, 1560, 456))
cut("01-dashboard-full","f-signals",      (350, 105, 1560, 178))
cut("01-dashboard-full","f-brief",        (350, 195, 1560, 470))
cut("v-flow",          "f-flow",          (350, 186, 1560, 410))
cut("v-profit",        "f-profit",        (350, 186, 1560, 410))
cut("v-vat",           "f-vat",           (350, 186, 1560, 410))
cut("v-ledger2",       "f-ledger",        (350, 150, 1560, 480))
cut("01-dashboard-full","f-receivable",   (350, 500, 1000, 700))
cut("v-emp",           "f-emp",           (350, 196, 1560, 420))
cut("v-att",           "f-att",           (350, 200, 1560, 424))
cut("v-sched",         "f-sched",         (350, 190, 1560, 414))
cut("v-sign",          "f-sign",          (350, 196, 1560, 420))
cut("v-appr",          "f-appr",          (350, 196, 1560, 420))
cut("v-perm",          "f-perm",          (350, 150, 1560, 620))
cut("v-copilot",       "f-copilot",       (350, 120, 1560, 620))
cut("v-billing",       "f-billing",       (350, 150, 1560, 620))
cut("v-projects",      "f-projects",      (350, 150, 1560, 560))
cut("v-pb-contract",   "f-contract",      (350, 160, 1560, 480))
cut("v-pb-spend",      "f-spend",         (350, 160, 1560, 480))

# ── 이미 좋은 조각은 그대로 복사 ──
for src, dst in [("30-meeting-agenda", "f-meeting"), ("31-deal-card", "f-deal"),
                 ("34-templates", "f-templates"), ("33-expense", "f-expense")]:
    p = f"cap/{src}.png"
    if os.path.exists(p):
        Image.open(p).save(f"{OUT}/{dst}.png")
        print(f"{dst:22} (copy)")

print("\ndone →", OUT)
