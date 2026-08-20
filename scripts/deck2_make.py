# -*- coding: utf-8 -*-
"""OwnerView 서비스 소개서 v2 — 34장 조립 (핵심 틀은 deck2_core.py)
   실행: python scripts/deck2_make.py  →  dist/OwnerView_서비스소개서.pptx"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deck2_core import *          # noqa: F401,F403  (prs · 색 · 틀 함수)

# ══════════ 01 표지 ══════════
cover()

# ══════════ 02 오너뷰는 ══════════
s = plain(2, "오너뷰는 회사 운영 All in one 시스템입니다",
          "은행 앱·엑셀·근태 앱·문서함·단톡방으로 나뉘어 있던 일을 한 화면에서 처리합니다.")
for i, (t, d) in enumerate([("돈", "통장 · 카드 · 세금 · 장부"), ("일", "프로젝트 · 일정 · 결재"),
                            ("사람", "근태 · 연차 · 급여 · 계약"), ("기록", "문서 · 게시판 · 파일")]):
    x = Inches(0.6) + i * Inches(3.11)
    rect(s, x, Inches(1.95), Inches(2.9), Inches(1.35), fill=SOFT, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
    text(s, x, Inches(2.22), Inches(2.9), Inches(0.4), [(t, 16, True, BR)], PP_ALIGN.CENTER)
    text(s, x + Inches(0.2), Inches(2.72), Inches(2.5), Inches(0.4), [(d, 10, False, MUT)], PP_ALIGN.CENTER)
rect(s, Inches(0.6), Inches(3.55), Inches(12.13), Inches(2.95), fill=WHITE, line=LINE,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.03)
pic_top(s, "use-dash.png", Inches(0.72), Inches(3.67), Inches(11.89), Inches(2.71))

# ══════════ 03 이런 분들을 위해 ══════════
s = plain(3, "이런 분들을 위해 만들었습니다", "회사마다 상황은 다르지만, 관리해야 할 일은 같습니다.")
for i, (tag, title, body, fix) in enumerate([
        ("CASE 1", ["기존 ERP가 무겁게", "느껴지는 대표님"],
         "몇 해 전 들인 시스템이 어렵고 느립니다. 쓰는 기능은 일부인데 유지비는 계속 나갑니다.",
         "설치도 구축도 없이, 오늘 가입해 오늘부터"),
        ("CASE 2", ["이제 막 시작한", "창업 대표님"],
         "통장·카드·세무·근태를 각각 따로 챙깁니다. 무엇부터 갖춰야 할지 모르겠습니다.",
         "필요한 것만 켜고, 늘면 그때 더"),
        ("CASE 3", ["운영은 하는데", "한눈에 안 보이는 대표님"],
         "매출은 압니다. 남는지는 모릅니다. 숫자는 늘 월말에 도착합니다.",
         "로그인하면 오늘 회사 상태가 첫 화면에")]):
    x = Inches(0.6) + i * Inches(4.15)
    rect(s, x, Inches(1.95), Inches(3.93), Inches(4.5), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
    rect(s, x + Inches(0.28), Inches(2.25), Inches(0.95), Inches(0.3), fill=SOFT,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.5)
    text(s, x + Inches(0.28), Inches(2.29), Inches(0.95), Inches(0.24), [(tag, 8.5, True, BR)], PP_ALIGN.CENTER)
    text(s, x + Inches(0.28), Inches(2.78), Inches(3.4), Inches(0.95),
         [[(l, 15, True, INK)] for l in title], spacing=1.25)
    text(s, x + Inches(0.28), Inches(4.0), Inches(3.4), Inches(1.3), [(body, 10.5, False, MUT)], spacing=1.35)
    rect(s, x + Inches(0.28), Inches(5.55), Inches(3.37), Inches(0.62), fill=SOFT,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.12)
    text(s, x + Inches(0.45), Inches(5.72), Inches(3.05), Inches(0.4), [("→ " + fix, 9.5, True, BR)], spacing=1.2)

# ══════════ 04 자주 듣는 이야기 ══════════
s = plain(4, "자주 듣는 이야기입니다", "오너뷰는 이 네 가지를 덜어 드리려고 만들었습니다.")
for i, (a, b, c, note) in enumerate([
        ("“통장이 세 개인데 ", "잔액을 보려면 앱을 세 번 열어야", " 해요”", "은행마다 따로 · 합계는 머릿속에서"),
        ("“", "월말마다 세무사에게 넘길 자료 챙기는 데 하루가", " 갑니다”", "영수증·계산서·통장을 모아 정리"),
        ("“지금 ", "돈이 얼마 있는지 바로 답을 못 합니다", "”", "받을 돈·낼 돈이 흩어져 있어서"),
        ("“출퇴근은 단톡방에, ", "연차는 수첩에", " 적습니다”", "급여명세서는 매달 엑셀로")]):
    x = Inches(0.6) + (i % 2) * Inches(6.2)
    y = Inches(2.15) + (i // 2) * Inches(2.2)
    rect(s, x, y, Inches(5.93), Inches(1.9), fill=BAND, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
    text(s, x + Inches(0.35), y + Inches(0.35), Inches(5.25), Inches(0.9),
         [(a, 13, True, INK), (b, 13, True, RED), (c, 13, True, INK)], spacing=1.35)
    text(s, x + Inches(0.35), y + Inches(1.38), Inches(5.25), Inches(0.3), [(note, 9.5, False, DIM)])

# ══════════ 05 연결되는 곳 ══════════
s = plain(5, "은행·카드사·국세청이 직접 연결됩니다",
          "공동인증서를 한 번 등록하면 거래 자료가 자동으로 들어옵니다. 옮겨 적으실 일이 없습니다.")
for i, (cat, names) in enumerate([
        ("은행 20+", ["국민", "신한", "우리", "하나", "기업", "농협", "카카오뱅크"]),
        ("카드사 10+", ["신한카드", "삼성카드", "현대카드", "KB국민", "롯데카드", "BC카드", "하나카드"]),
        ("국세청", ["전자세금계산서", "현금영수증", "매입·매출 자료", "부가세 신고자료"]),
        ("그 밖에", ["엑셀 업로드", "직접 입력", "PG 결제", "대출·리스"])]):
    x = Inches(0.6) + i * Inches(3.11)
    rect(s, x, Inches(1.95), Inches(2.9), Inches(4.35), fill=BAND, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
    text(s, x, Inches(2.22), Inches(2.9), Inches(0.32), [(cat, 13.5, True, BR)], PP_ALIGN.CENTER)
    for j, nm in enumerate(names):
        yy = Inches(2.72) + j * Inches(0.47)
        rect(s, x + Inches(0.22), yy, Inches(2.46), Inches(0.37), fill=WHITE, line=LINE,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.12)
        text(s, x + Inches(0.22), yy + Inches(0.07), Inches(2.46), Inches(0.24), [(nm, 9.5, False, MUT)], PP_ALIGN.CENTER)
text(s, Inches(0.6), Inches(6.5), Inches(12.13), Inches(0.3),
     [("연동은 나중에 하셔도 됩니다 — 엑셀 업로드와 직접 입력으로 먼저 시작하시고, 이후 연결해도 자료는 그대로 이어집니다.", 10, False, DIM)],
     PP_ALIGN.CENTER)

# ══════════ 06 오너뷰 한 장 ══════════
s = plain(6, "흩어진 자료를 한곳에 모아, 세 가지로 정리해 드립니다")
for i, t in enumerate(["은행 거래", "카드 승인", "세금계산서", "직원 근태", "계약·문서", "프로젝트"]):
    y = Inches(2.0) + i * Inches(0.72)
    rect(s, Inches(0.7), y, Inches(2.5), Inches(0.55), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.1)
    text(s, Inches(0.7), y + Inches(0.15), Inches(2.5), Inches(0.3), [(t, 10.5, False, MUT)], PP_ALIGN.CENTER)
rect(s, Inches(4.35), Inches(3.1), Inches(3.1), Inches(1.7), fill=BR, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08)
text(s, Inches(4.35), Inches(3.55), Inches(3.1), Inches(0.5), [("◈ OwnerView", 18, True, WHITE)], PP_ALIGN.CENTER)
text(s, Inches(4.35), Inches(4.1), Inches(3.1), Inches(0.3), [("한 회사, 한 데이터", 10, False, LAV)], PP_ALIGN.CENTER)
text(s, Inches(3.35), Inches(3.7), Inches(0.9), Inches(0.4), [("›››", 15, True, DIM)], PP_ALIGN.CENTER)
text(s, Inches(7.55), Inches(3.7), Inches(0.9), Inches(0.4), [("›››", 15, True, DIM)], PP_ALIGN.CENTER)
for i, (t, d) in enumerate([("오늘 회사 상태", "잔액·손익·받을 돈을 첫 화면에서"),
                            ("오늘 해야 할 일", "근거와 함께 급한 순으로"),
                            ("남는 기록", "장부·계약·인사 이력이 그대로")]):
    y = Inches(2.2) + i * Inches(1.5)
    rect(s, Inches(8.6), y, Inches(4.1), Inches(1.25), fill=SOFT, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
    text(s, Inches(8.85), y + Inches(0.22), Inches(3.6), Inches(0.32), [(t, 13, True, BR)])
    text(s, Inches(8.85), y + Inches(0.66), Inches(3.6), Inches(0.4), [(d, 10, False, MUT)], spacing=1.25)

# ══════════ 07 세 가지 원칙 ══════════
s = plain(7, "모으고 · 제안하고 · 확정은 사람이",
          "자동화는 사람을 대신하는 것이 아니라, 판단할 준비를 대신하는 것입니다.")
for i, (t, d, hl) in enumerate([
        ("① 자동으로 모읍니다", "은행·카드·국세청 자료가 스스로 들어옵니다.\n옮겨 적을 일이 없습니다.", False),
        ("② AI가 제안합니다", "분류·매칭·오늘 챙길 것을 출처와 함께 제안합니다.\n(AI 추천 / 배운 규칙 / 국세청 / 장부 대조)", False),
        ("③ 확정은 사람이 합니다", "발송·이체·확정 버튼은 항상 사람의 손에 있습니다.\n확정 버튼은 화면에 하나뿐입니다.", True)]):
    x = Inches(0.6) + i * Inches(4.15)
    rect(s, x, Inches(2.4), Inches(3.93), Inches(2.7), fill=SOFT if hl else WHITE,
         line=BR if hl else LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05, lw=1.25 if hl else 0.75)
    text(s, x + Inches(0.3), Inches(2.75), Inches(3.35), Inches(0.4), [(t, 15, True, BR if hl else INK)])
    text(s, x + Inches(0.3), Inches(3.42), Inches(3.35), Inches(1.4), [(d, 10.5, False, MUT)], spacing=1.35)
    if i < 2:
        text(s, x + Inches(3.98), Inches(3.6), Inches(0.3), Inches(0.4), [("›", 17, True, DIM)], PP_ALIGN.CENTER)
rect(s, Inches(0.6), Inches(5.5), Inches(12.13), Inches(0.75), fill=BAND, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.16)
text(s, Inches(0.6), Inches(5.72), Inches(12.13), Inches(0.4),
     [("AI 가 대신 누르지 않습니다. 누르기 전까지의 준비만 대신합니다.", 12.5, True, INK)], PP_ALIGN.CENTER)
