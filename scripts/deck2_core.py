# -*- coding: utf-8 -*-
"""
OwnerView 서비스 소개서 v2 — 34장 (2026-08-20 사장님 확정 "진행")

읽는 사람: **도입을 검토하는 중소기업 대표 · 담당자 · 개인사업자**
  ① 구식 ERP가 무겁게 느껴지는 대표 ② 창업 초기라 아직 시스템이 없는 대표
  ③ 운영은 하는데 한눈에 안 보이는 대표 ④ 경리·총무 담당자 ⑤ 개인사업자

참고 덱에서 가져온 것 (사장님 지시로 역할을 나눠 분석):
  · 아드리엘 = **내실** — 기능 장표의 3단 밴드(제목/|부제| → 고객의 말 → 기능+캡처),
    연동 커넥터 그리드를 앞에 배치, 사용 예시 챕터, 화면이 분량의 70%
  · 마인드노크 = **외형** — 글꼴 굵기 3단계·중간 크기 배제, 캡처는 카드+그림자+캡션,
    3열 균등, 주색 3톤 + 강조 1색, 챕터에도 메시지 문장

데이터는 시연 회사 '오너뷰' — 모티브 실정보 노출 0.
실행: python scripts/deck2-build.py  →  dist/OwnerView_서비스소개서.pptx
"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from PIL import Image
import os

# ── 색 ── (오너뷰 인디고 3톤 + 문제=빨강 + 효과=앰버)
BR   = RGBColor(0x1C, 0x3F, 0xAA)   # 주색
BR2  = RGBColor(0x3B, 0x5B, 0xDB)   # 밝은 주색
DEEP = RGBColor(0x0E, 0x1A, 0x44)   # 짙은 남색(표지·챕터)
BAND = RGBColor(0xEE, 0xF1, 0xF9)   # 밴드 배경
SOFT = RGBColor(0xF4, 0xF7, 0xFF)   # 카드 강조 배경
INK  = RGBColor(0x14, 0x18, 0x27)
MUT  = RGBColor(0x4A, 0x55, 0x70)
DIM  = RGBColor(0x93, 0x9B, 0xB1)
LINE = RGBColor(0xDF, 0xE3, 0xEE)
RED  = RGBColor(0xE0, 0x31, 0x31)
AMB  = RGBColor(0xB4, 0x53, 0x09)
WHITE= RGBColor(0xFF, 0xFF, 0xFF)
LAV  = RGBColor(0xC7, 0xD6, 0xFF)
BADR = RGBColor(0xFD, 0xF2, 0xF2)   # before 배경
BADL = RGBColor(0xF6, 0xD5, 0xD5)
GOODB= RGBColor(0xF2, 0xF6, 0xFF)
GOODL= RGBColor(0xCF, 0xDC, 0xFB)

FONT = "맑은 고딕"
W, H = Inches(13.333), Inches(7.5)
CAP = "cap/v2"
TOTAL = 34

prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]


# ══════════ 기본 도구 ══════════
def slide():
    return prs.slides.add_slide(BLANK)

def rect(s, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE, radius=None, lw=0.75):
    sp = s.shapes.add_shape(shape, x, y, w, h)
    if fill is None: sp.fill.background()
    else: sp.fill.solid(); sp.fill.fore_color.rgb = fill
    if line is None: sp.line.fill.background()
    else: sp.line.color.rgb = line; sp.line.width = Pt(lw)
    sp.shadow.inherit = False
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try: sp.adjustments[0] = radius
        except Exception: pass
    return sp

def text(s, x, y, w, h, runs, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=None):
    tb = s.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    paras = runs if isinstance(runs[0], list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing: p.line_spacing = spacing
        for (t, size, bold, color) in para:
            r = p.add_run(); r.text = t
            r.font.size = Pt(size); r.font.bold = bold
            r.font.color.rgb = color; r.font.name = FONT
    return tb

def link_text(s, x, y, w, h, label, url, size=12, bold=True, color=None, align=PP_ALIGN.LEFT):
    """하이퍼링크가 걸린 글자 — 발표·PDF 어느 쪽에서 눌러도 그 페이지로 간다 (2026-08-20 사장님 지시)"""
    tb = s.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = label
    r.font.size = Pt(size); r.font.bold = bold; r.font.name = FONT
    r.font.color.rgb = color if color is not None else BR
    r.hyperlink.address = url
    return tb


def link_shape(s, shape, url):
    """도형(버튼) 자체에 링크를 건다"""
    from pptx.oxml.ns import qn
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT
    rId = s.part.relate_to(url, RT.HYPERLINK, is_external=True)
    cNvPr = shape._element._nvXxPr.cNvPr
    hl = cNvPr.makeelement(qn("a:hlinkClick"), {qn("r:id"): rId})
    cNvPr.append(hl)
    return shape


def grad(s, c1, c2, angle=45):
    sp = rect(s, 0, 0, W, H, fill=c1)
    f = sp.fill; f.gradient(); f.gradient_angle = angle
    st = f.gradient_stops
    st[0].color.rgb = c1; st[0].position = 0.0
    st[1].color.rgb = c2; st[1].position = 1.0
    return sp

def pic(s, name, x, y, maxw, maxh, border=True, align="center"):
    """비율 유지 — 영역 안에 가운데 배치"""
    p = os.path.join(CAP, name)
    if not os.path.exists(p):
        rect(s, x, y, maxw, maxh, fill=BAND, line=LINE)
        text(s, x, y + maxh // 2, maxw, Inches(0.3), [(f"[{name}]", 9, False, DIM)], PP_ALIGN.CENTER)
        return
    iw, ih = Image.open(p).size
    r = min(maxw / iw, maxh / ih)
    w_, h_ = int(iw * r), int(ih * r)
    px = x if align == "left" else x + (maxw - w_) // 2
    py = y + (maxh - h_) // 2
    s.shapes.add_picture(p, px, py, w_, h_)
    if border:
        b = rect(s, px, py, w_, h_, fill=None, line=LINE); b.line.width = Pt(0.75)

def pic_top(s, name, x, y, w, h):
    """폭을 맞추고 위에서부터 잘라 넣는다 — 화면 전체를 크게 보여줄 때"""
    p = os.path.join(CAP, name)
    if not os.path.exists(p):
        rect(s, x, y, w, h, fill=BAND, line=LINE); return
    iw, ih = Image.open(p).size
    ar, tr = iw / ih, w / h
    im = s.shapes.add_picture(p, x, y, w, h)
    if ar > tr:
        cut = 1 - tr / ar; im.crop_right = cut
    elif ar < tr:
        cut = 1 - ar / tr; im.crop_bottom = cut
    b = rect(s, x, y, w, h, fill=None, line=LINE); b.line.width = Pt(0.75)

def foot(s, n):
    text(s, Inches(0.55), Inches(7.02), Inches(3), Inches(0.22), [("OwnerView", 8, True, BR)])
    text(s, Inches(9.8), Inches(7.02), Inches(3), Inches(0.22),
         [(f"{n:02d} / {TOTAL}", 8, False, DIM)], PP_ALIGN.RIGHT)


# ══════════ 장표 틀 ══════════
def cover():
    s = slide(); grad(s, DEEP, BR2, 45)
    rect(s, 0, 0, W, Inches(0.05), fill=LAV)
    text(s, Inches(0.85), Inches(0.75), Inches(8), Inches(0.3),
         [("COMPANY OPERATION SOFTWARE", 10.5, True, LAV)])
    text(s, Inches(0.85), Inches(2.4), Inches(7.2), Inches(2),
         [[("은행·카드·세금·계약·직원 —", 28, True, WHITE)],
          [("회사 운영의 모든 것을 한 화면에", 28, True, LAV)]], spacing=1.28)
    text(s, Inches(0.85), Inches(5.3), Inches(5), Inches(0.4), [("◈ OwnerView", 19, True, WHITE)])
    text(s, Inches(0.85), Inches(5.95), Inches(4.05), Inches(0.35),
         [("작은 회사를 위한 운영 소프트웨어 · ", 11.5, False, RGBColor(0xD5, 0xDC, 0xF5))])
    #   표지 주소도 누르면 열리게 (2026-08-20 사장님 지시)
    link_text(s, Inches(4.35), Inches(5.95), Inches(3.4), Inches(0.35),
              "www.owner-view.com", "https://www.owner-view.com",
              size=11.5, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    p = os.path.join(CAP, "use-dash.png")
    if os.path.exists(p):
        iw, ih = Image.open(p).size
        w_ = Inches(6.5); h_ = int(w_ * ih / iw)
        s.shapes.add_picture(p, Inches(7.1), Inches(1.5), w_, h_)
    return s

def chapter(no, title, sub, page):
    s = slide(); grad(s, INK, DEEP, 30)
    rect(s, 0, 0, Inches(0.15), H, fill=BR2)
    text(s, Inches(1.1), Inches(2.8), Inches(8), Inches(0.3), [(no, 11.5, True, LAV)])
    text(s, Inches(1.1), Inches(3.2), Inches(9), Inches(0.9), [(title, 30, True, WHITE)])
    text(s, Inches(1.1), Inches(4.2), Inches(9), Inches(0.4), [(sub, 11.5, False, RGBColor(0xC7, 0xCB, 0xE0))])
    text(s, Inches(9.8), Inches(7.02), Inches(3), Inches(0.22),
         [(f"{page:02d} / {TOTAL}", 8, False, RGBColor(0x8A, 0x90, 0xB5))], PP_ALIGN.RIGHT)
    return s

def head_band(s, title, pipe):
    """아드리엘식 상단 밴드 — 제목 + |부제|"""
    rect(s, 0, 0, W, Inches(1.55), fill=BAND)
    text(s, Inches(0.6), Inches(0.42), Inches(12.13), Inches(0.5),
         [(title, 23, True, INK)], PP_ALIGN.CENTER)
    text(s, Inches(0.6), Inches(1.02), Inches(12.13), Inches(0.3),
         [("| ", 12.5, True, BR), (pipe, 12.5, True, BR), (" |", 12.5, True, BR)], PP_ALIGN.CENTER)

def three_band(page, title, pipe, voices, feats):
    """기능 장표 — 밴드(제목/|부제|) / 고객의 말 2 / 기능 3행(왼쪽 설명 + 오른쪽 넓은 캡처)

       ⚠️ 기능을 3열 카드로 두면 제품 조각(대개 5:1 로 가로가 길다)이 우표처럼 작아지거나
          왼쪽 라벨이 잘려 무슨 화면인지 알 수 없다. 그래서 **행**으로 눕혀 캡처를 넓게 준다.
    """
    s = slide(); head_band(s, title, pipe)
    y = Inches(1.9)
    for (a, b, c) in voices:
        runs = [("“" + a, 13, True, INK), (b, 13, True, RED), (c + "”", 13, True, INK)]
        text(s, Inches(1.0), y, Inches(11.3), Inches(0.4), runs, PP_ALIGN.CENTER)
        y += Inches(0.5)
    rect(s, 0, Inches(3.05), W, H - Inches(3.05), fill=BAND)
    n = len(feats)
    top = Inches(3.25); gap = Inches(0.14)
    rh = int((Inches(3.75) - gap * (n - 1)) / n)
    for i, (nm, desc, img) in enumerate(feats):
        ry = top + i * (rh + gap)
        rect(s, Inches(0.6), ry, Inches(12.13), rh, fill=WHITE, line=LINE,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
        rect(s, Inches(0.6), ry, Inches(0.08), rh, fill=BR)
        text(s, Inches(0.92), ry + Inches(0.14), Inches(2.7), Inches(0.3), [(nm, 12.5, True, BR)])
        text(s, Inches(0.92), ry + Inches(0.5), Inches(2.75), rh - Inches(0.6),
             [(desc.replace(chr(10), " "), 9.8, False, MUT)], spacing=1.25)
        pic(s, img, Inches(3.85), ry + Inches(0.1), Inches(8.7), rh - Inches(0.2), border=False, align="left")
    foot(s, page)
    return s


def use_slide(page, title, pipes, img):
    """사용 예시 — 제목 좌상단 + |부제 2줄| + 화면 크게"""
    s = slide(); rect(s, 0, 0, W, H, fill=BAND)
    text(s, Inches(0.55), Inches(0.38), Inches(12.2), Inches(0.45),
         [("오너뷰 사용 예시 – ", 18, True, INK), (title, 18, True, BR)])
    y = Inches(0.95)
    for t in pipes:
        text(s, Inches(0.55), y, Inches(12.2), Inches(0.28),
             [("| ", 11, True, RED), (t, 11, False, RGBColor(0x3A, 0x43, 0x56))])
        y += Inches(0.3)
    box_y = Inches(1.72)
    rect(s, Inches(0.55), box_y, Inches(12.23), H - box_y - Inches(0.45),
         fill=WHITE, line=LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.02)
    pic_top(s, img, Inches(0.68), box_y + Inches(0.12), Inches(11.97), H - box_y - Inches(0.69))
    foot(s, page)
    return s

def plain(page, title, lead=None, band=False):
    s = slide()
    if band:
        head_band(s, title, lead or "")
    else:
        text(s, Inches(0.6), Inches(0.55), Inches(12.13), Inches(0.5), [(title, 23, True, INK)], PP_ALIGN.CENTER)
        if lead:
            text(s, Inches(0.6), Inches(1.15), Inches(12.13), Inches(0.35), [(lead, 11.5, False, MUT)], PP_ALIGN.CENTER)
    foot(s, page)
    return s
