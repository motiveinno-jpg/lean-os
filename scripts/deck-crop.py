# -*- coding: utf-8 -*-
"""소개서용 조각 크롭 — 2배 캡처(3200x2000)에서 설명 항목별 조각만 잘라낸다.
   좌표는 CSS px(1600x1000) 기준으로 적고 2배로 환산한다."""
from PIL import Image
import os, sys

os.makedirs("cap/x", exist_ok=True)
def crop(src, name, box):
    try:
        im = Image.open(f"cap/{src}.png")
    except FileNotFoundError:
        print("MISS", src); return
    b = tuple(int(v * 2) for v in box)
    out = im.crop(b)
    out.save(f"cap/x/{name}.png")
    print(f"{name:22} {out.size[0]:>5}x{out.size[1]}")

# ── 통장 ──
crop("v-bank", "bank-summary",  (400, 235, 1245, 262))     # 총자산·수익·지출·분류완료율
crop("v-bank", "bank-accounts", (400, 285, 1560, 509))     # 계좌 3줄(표 머리 포함)

# ── 카드 ──
crop("v-cards", "cards-list", (400, 258, 1560, 482))

# ── 수집·전표 ──
crop("v-collect", "collect-head",  (400, 168, 1560, 392))
crop("v-collect", "collect-rows",  (400, 330, 1245, 620))

# ── 매입매출전표 ──
crop("v-sale-purchase", "voucher-rows", (400, 232, 1560, 456))

# ── 세금계산서 ──
crop("v-tax", "tax-rows", (400, 236, 1560, 460))

# ── 경영흐름 ──
crop("v-flow", "flow-chart", (400, 186, 1560, 410))

# ── 손익 ──
crop("v-profit", "profit", (400, 186, 1560, 410))

# ── 부가세 ──
crop("v-vat", "vat", (400, 186, 1560, 410))

# ── 거래처 원장 ──
crop("v-ledger", "ledger", (400, 150, 1245, 620))

# ── 전자계약 ──
crop("v-sign", "sign", (400, 196, 1560, 420))

# ── 결재 ──
crop("v-appr", "appr", (400, 160, 1245, 560))

# ── 인사 ──
crop("v-emp", "employees", (400, 196, 1560, 420))
crop("v-att", "attendance", (400, 200, 1560, 424))

# ── 일정 ──
crop("v-sched", "schedule", (400, 190, 1560, 414))

# ── 요금제 ──
crop("v-billing", "billing", (400, 150, 1245, 620))

# ── 프로젝트 목록 ──
crop("v-projects", "projects", (400, 150, 1245, 560))

# ── 프로젝트 보드(뷰포트에서 조각) ──
crop("v-pb-todo",     "pb-todo",     (400, 160, 1400, 520))
crop("v-pb-revenue",  "pb-revenue",  (400, 160, 1400, 560))
crop("v-pb-contract", "pb-contract", (400, 160, 1400, 560))
crop("v-pb-spend",    "pb-spend",    (400, 160, 1400, 480))
crop("v-pb-meeting",  "pb-meeting",  (400, 160, 1400, 560))

# ── 대시보드 조각 ──
crop("01-dashboard-full", "dash-signals",  (400, 105, 1245, 175))
crop("01-dashboard-full", "dash-briefing", (400, 195, 1245, 500))
crop("01-dashboard-full", "dash-widgets",  (400, 500, 1245, 680))
print("\ndone")
