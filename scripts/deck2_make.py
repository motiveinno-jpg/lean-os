# -*- coding: utf-8 -*-
"""OwnerView 서비스 소개서 v2 — 01~07장 (디자인 적용본)
   2026-08-20 사장님: "배경도 없고 밋밋하다 · 여백이 많아 빈약해 보인다 ·
   같은 텍스트라도 크기·색·강조가 달라야 한다 · 아이콘·캐릭터도 적극 사용"
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from deck2_core import *          # noqa: F401,F403

CX = W // 2

# ══════════ 01 표지 ══════════
cover()

# ══════════ 02 오너뷰는 — All in one ══════════
s = slide(); bg_light(s)
pill(s, CX, Inches(0.62), "회사 운영 All in one", w=Inches(2.9))
text(s, Inches(0.6), Inches(1.12), Inches(12.13), Inches(0.55),
     [("오너뷰는 회사 운영 ", 24, True, INK), ("All in one", 27, True, BR), (" 시스템입니다", 24, True, INK)],
     PP_ALIGN.CENTER)
text(s, Inches(0.6), Inches(1.8), Inches(12.13), Inches(0.3),
     [("은행 앱·엑셀·근태 앱·문서함·단톡방으로 나뉘어 있던 일을 ", 11.5, False, MUT),
      ("한 화면에서", 11.5, True, INK), (" 처리합니다.", 11.5, False, MUT)], PP_ALIGN.CENTER)
for i, (ic, t, d) in enumerate([("money", "돈", "통장 · 카드 · 세금 · 장부"),
                                ("list", "일", "프로젝트 · 일정 · 결재"),
                                ("people", "사람", "근태 · 연차 · 급여 · 계약"),
                                ("doc", "기록", "문서 · 게시판 · 파일")]):
    x = Inches(0.6) + i * Inches(3.11)
    rect(s, x, Inches(2.35), Inches(2.9), Inches(1.5), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
    icon_badge(s, x + Inches(1.45), Inches(2.72), ic, d=Inches(0.6))
    text(s, x, Inches(3.08), Inches(2.9), Inches(0.32), [(t, 15, True, BR)], PP_ALIGN.CENTER)
    text(s, x + Inches(0.2), Inches(3.45), Inches(2.5), Inches(0.3), [(d, 9.5, False, MUT)], PP_ALIGN.CENTER)
rect(s, Inches(0.6), Inches(4.05), Inches(12.13), Inches(2.62), fill=WHITE, line=LINE,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.03)
pic(s, "use-dash.png", Inches(0.74), Inches(4.17), Inches(11.85), Inches(2.38))
foot(s, 2)

# ══════════ 03 이런 분들을 위해 ══════════
s = slide(); bg_light(s)
pill(s, CX, Inches(0.55), "도입을 고민 중이시라면", w=Inches(3.0))
text(s, Inches(0.6), Inches(1.05), Inches(12.13), Inches(0.5),
     [("이런 분들을 위해 ", 24, True, INK), ("만들었습니다", 24, True, BR)], PP_ALIGN.CENTER)
text(s, Inches(0.6), Inches(1.7), Inches(12.13), Inches(0.3),
     [("회사마다 상황은 다르지만, 관리해야 할 일은 같습니다.", 11.5, False, MUT)], PP_ALIGN.CENTER)
for i, (ic, tag, title, body, fix) in enumerate([
        ("gear", "CASE 1", ["기존 ERP가 무겁게", "느껴지는 대표님"],
         "몇 해 전 들인 시스템이 어렵고 느립니다. 쓰는 기능은 일부인데 유지비는 계속 나갑니다.",
         "설치도 구축도 없이, 오늘 가입해 오늘부터"),
        ("bulb", "CASE 2", ["이제 막 시작한", "창업 대표님"],
         "통장·카드·세무·근태를 각각 따로 챙깁니다. 무엇부터 갖춰야 할지 모르겠습니다.",
         "필요한 것만 켜고, 늘면 그때 더"),
        ("search", "CASE 3", ["운영은 하는데", "한눈에 안 보이는 대표님"],
         "매출은 압니다. 남는지는 모릅니다. 숫자는 늘 월말에 도착합니다.",
         "로그인하면 오늘 회사 상태가 첫 화면에")]):
    x = Inches(0.6) + i * Inches(4.15)
    rect(s, x, Inches(2.25), Inches(3.93), Inches(4.35), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
    rect(s, x, Inches(2.25), Inches(3.93), Inches(0.1), fill=BR, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.5)
    icon_badge(s, x + Inches(0.72), Inches(2.98), ic, d=Inches(0.72), no=i + 1)
    text(s, x + Inches(1.3), Inches(2.72), Inches(2.4), Inches(0.26), [(tag, 9, True, BR)])
    text(s, x + Inches(1.3), Inches(2.98), Inches(2.5), Inches(0.75),
         [[(l, 13.5, True, INK)] for l in title], spacing=1.2)
    text(s, x + Inches(0.3), Inches(4.1), Inches(3.35), Inches(1.35), [(body, 10.5, False, MUT)], spacing=1.35)
    rect(s, x + Inches(0.3), Inches(5.65), Inches(3.33), Inches(0.68), fill=SOFT,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.14)
    text(s, x + Inches(0.48), Inches(5.81), Inches(3.0), Inches(0.4), [("→ " + fix, 9.5, True, BR)], spacing=1.2)
foot(s, 3)

# ══════════ 04 자주 듣는 이야기 — 캐릭터 + 말풍선 ══════════
s = slide(); bg_light(s)
pill(s, CX, Inches(0.55), "대표님들의 이야기", w=Inches(2.4))
text(s, Inches(0.6), Inches(1.05), Inches(12.13), Inches(0.5),
     [("현장에서 ", 24, True, INK), ("자주 듣는 이야기", 24, True, BR), ("입니다", 24, True, INK)], PP_ALIGN.CENTER)
text(s, Inches(0.6), Inches(1.7), Inches(12.13), Inches(0.3),
     [("오너뷰는 이 네 가지를 덜어 드리려고 만들었습니다.", 11.5, False, MUT)], PP_ALIGN.CENTER)
TONES = [RGBColor(0x4F, 0x6F, 0xF0), RGBColor(0x2B, 0x8A, 0x8A),
         RGBColor(0xC2, 0x62, 0x2E), RGBColor(0x6B, 0x4F, 0xC0)]
for i, (a, b, c, note) in enumerate([
        ("통장이 세 개인데 ", "잔액을 보려면 앱을 세 번 열어야", " 해요", "은행마다 따로 · 합계는 머릿속에서"),
        ("", "월말마다 세무사에게 넘길 자료 챙기는 데 하루가", " 갑니다", "영수증·계산서·통장을 모아 정리"),
        ("지금 ", "돈이 얼마 있는지 바로 답을 못 합니다", "", "받을 돈·낼 돈이 흩어져 있어서"),
        ("출퇴근은 단톡방에, ", "연차는 수첩에", " 적습니다", "급여명세서는 매달 엑셀로")]):
    x = Inches(0.6) + (i % 2) * Inches(6.25)
    y = Inches(2.4) + (i // 2) * Inches(2.15)
    avatar(s, x + Inches(0.62), y + Inches(0.72), d=Inches(0.95), tone=TONES[i])
    bubble(s, x + Inches(1.35), y, Inches(4.63), Inches(1.3),
           [("“" + a, 12, True, INK), (b, 12, True, RED), (c + "”", 12, True, INK)],
           tail=None, spacing=1.3)
    text(s, x + Inches(1.55), y + Inches(1.42), Inches(4.4), Inches(0.28), [(note, 9.5, False, DIM)])
foot(s, 4)

# ══════════ 05 연결되는 곳 ══════════
s = slide(); bg_light(s)
pill(s, CX, Inches(0.55), "자동 연동", w=Inches(1.8))
text(s, Inches(0.6), Inches(1.05), Inches(12.13), Inches(0.5),
     [("은행·카드사·국세청이 ", 24, True, INK), ("직접 연결", 24, True, BR), ("됩니다", 24, True, INK)], PP_ALIGN.CENTER)
text(s, Inches(0.6), Inches(1.7), Inches(12.13), Inches(0.3),
     [("공동인증서를 ", 11.5, False, MUT), ("한 번만", 11.5, True, INK),
      (" 등록하면 거래 자료가 자동으로 들어옵니다. 옮겨 적으실 일이 없습니다.", 11.5, False, MUT)], PP_ALIGN.CENTER)
for i, (ic, cat, names) in enumerate([
        ("bank", "은행 20+", ["국민", "신한", "우리", "하나", "기업", "농협", "카카오뱅크"]),
        ("card", "카드사 10+", ["신한카드", "삼성카드", "현대카드", "KB국민", "롯데카드", "BC카드", "하나카드"]),
        ("doc", "국세청", ["전자세금계산서", "현금영수증", "매입·매출 자료", "부가세 신고자료"]),
        ("cloud", "그 밖에", ["엑셀 업로드", "직접 입력", "PG 결제", "대출·리스"])]):
    x = Inches(0.6) + i * Inches(3.11)
    rect(s, x, Inches(2.2), Inches(2.9), Inches(4.1), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
    icon_badge(s, x + Inches(1.45), Inches(2.62), ic, d=Inches(0.62))
    text(s, x, Inches(2.98), Inches(2.9), Inches(0.3), [(cat, 13, True, BR)], PP_ALIGN.CENTER)
    for j, nm in enumerate(names):
        yy = Inches(3.42) + j * Inches(0.4)
        rect(s, x + Inches(0.24), yy, Inches(2.42), Inches(0.33), fill=BAND,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.16)
        text(s, x + Inches(0.24), yy + Inches(0.055), Inches(2.42), Inches(0.22),
             [(nm, 9.2, False, MUT)], PP_ALIGN.CENTER)
rect(s, Inches(0.6), Inches(6.45), Inches(12.13), Inches(0.52), fill=SOFT,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.2)
text(s, Inches(0.6), Inches(6.58), Inches(12.13), Inches(0.28),
     [("연동은 나중에 하셔도 됩니다 — 엑셀 업로드와 직접 입력으로 먼저 시작하시고, 이후 연결해도 자료는 그대로 이어집니다.", 10, False, MUT)],
     PP_ALIGN.CENTER)
foot(s, 5)

# ══════════ 06 오너뷰 한 장 ══════════
s = slide(); bg_light(s)
pill(s, CX, Inches(0.55), "한 회사, 한 데이터", w=Inches(2.4))
text(s, Inches(0.6), Inches(1.05), Inches(12.13), Inches(0.5),
     [("흩어진 자료를 ", 24, True, INK), ("한곳에 모아", 24, True, BR), (", 세 가지로 정리해 드립니다", 24, True, INK)],
     PP_ALIGN.CENTER)
for i, (ic, t) in enumerate([("bank", "은행 거래"), ("card", "카드 승인"), ("doc", "세금계산서"),
                             ("clock", "직원 근태"), ("link", "계약·문서"), ("list", "프로젝트")]):
    y = Inches(2.05) + i * Inches(0.75)
    rect(s, Inches(0.7), y, Inches(2.75), Inches(0.6), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.14)
    icon_badge(s, Inches(1.04), y + Inches(0.3), ic, d=Inches(0.4))
    text(s, Inches(1.38), y + Inches(0.17), Inches(1.9), Inches(0.28), [(t, 10.5, True, MUT)])
rect(s, Inches(4.55), Inches(3.15), Inches(3.4), Inches(1.9), fill=BR,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.09)
text(s, Inches(4.55), Inches(3.6), Inches(3.4), Inches(0.5), [("◈ OwnerView", 19, True, WHITE)], PP_ALIGN.CENTER)
text(s, Inches(4.55), Inches(4.2), Inches(3.4), Inches(0.3),
     [("한 회사, 한 데이터", 10.5, False, LAV)], PP_ALIGN.CENTER)
text(s, Inches(3.5), Inches(3.85), Inches(1.0), Inches(0.4), [("›››", 16, True, BR2)], PP_ALIGN.CENTER)
text(s, Inches(8.0), Inches(3.85), Inches(1.0), Inches(0.4), [("›››", 16, True, BR2)], PP_ALIGN.CENTER)
for i, (ic, t, d) in enumerate([("chart", "오늘 회사 상태", "잔액·손익·받을 돈을 첫 화면에서"),
                                ("check", "오늘 해야 할 일", "근거와 함께 급한 순으로"),
                                ("doc", "남는 기록", "장부·계약·인사 이력이 그대로")]):
    y = Inches(2.15) + i * Inches(1.55)
    rect(s, Inches(8.85), y, Inches(3.88), Inches(1.32), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
    icon_badge(s, Inches(9.34), y + Inches(0.66), ic, d=Inches(0.56))
    text(s, Inches(9.76), y + Inches(0.24), Inches(2.9), Inches(0.32), [(t, 13, True, BR)])
    text(s, Inches(9.76), y + Inches(0.68), Inches(2.9), Inches(0.4), [(d, 9.8, False, MUT)], spacing=1.25)
foot(s, 6)

# ══════════ 07 세 가지 원칙 ══════════
s = slide(); bg_light(s)
pill(s, CX, Inches(0.55), "오너뷰가 일하는 방식", w=Inches(2.8))
text(s, Inches(0.6), Inches(1.05), Inches(12.13), Inches(0.5),
     [("모으고 · 제안하고 · ", 24, True, INK), ("확정은 사람이", 24, True, BR)], PP_ALIGN.CENTER)
text(s, Inches(0.6), Inches(1.7), Inches(12.13), Inches(0.3),
     [("자동화는 사람을 대신하는 것이 아니라, ", 11.5, False, MUT),
      ("판단할 준비를 대신하는 것", 11.5, True, INK), ("입니다.", 11.5, False, MUT)], PP_ALIGN.CENTER)
for i, (ic, t, d, hl) in enumerate([
        ("cloud", "자동으로 모읍니다", "은행·카드·국세청 자료가 스스로 들어옵니다.\n옮겨 적을 일이 없습니다.", False),
        ("bulb", "AI가 제안합니다", "분류·매칭·오늘 챙길 것을 출처와 함께 제안합니다.\n(AI 추천 / 배운 규칙 / 국세청 / 장부 대조)", False),
        ("check", "확정은 사람이 합니다", "발송·이체·확정 버튼은 항상 사람의 손에 있습니다.\n확정 버튼은 화면에 하나뿐입니다.", True)]):
    x = Inches(0.6) + i * Inches(4.15)
    rect(s, x, Inches(2.35), Inches(3.93), Inches(2.95), fill=SOFT if hl else WHITE,
         line=BR if hl else LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05, lw=1.5 if hl else 0.75)
    icon_badge(s, x + Inches(0.75), Inches(2.98), ic, d=Inches(0.72), no=i + 1,
               tone=WHITE if hl else None)
    text(s, x + Inches(1.35), Inches(2.8), Inches(2.4), Inches(0.36), [(t, 13.5, True, BR if hl else INK)])
    text(s, x + Inches(0.32), Inches(3.7), Inches(3.3), Inches(1.4), [(d, 10.3, False, MUT)], spacing=1.35)
    if i < 2:
        text(s, x + Inches(3.98), Inches(3.5), Inches(0.3), Inches(0.4), [("›", 18, True, BR2)], PP_ALIGN.CENTER)
rect(s, Inches(0.6), Inches(5.6), Inches(12.13), Inches(0.85), fill=BR,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.18)
text(s, Inches(0.6), Inches(5.85), Inches(12.13), Inches(0.4),
     [("AI 가 대신 누르지 않습니다. ", 13, True, LAV), ("누르기 전까지의 준비만 대신합니다.", 13, True, WHITE)],
     PP_ALIGN.CENTER)
foot(s, 7)
