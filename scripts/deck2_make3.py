# -*- coding: utf-8 -*-
"""소개서 v2 — 21~34장 (사용 예시 8장 · 도입 챕터 · 요금 · 문의)"""
from deck2_core import *          # noqa: F401,F403

def part3():
    # ══════════ 21 챕터 Ⅲ ══════════
    chapter("CHAPTER Ⅲ", "이렇게 씁니다", "실제 화면을 그대로 보여 드립니다.", 21)

    # ══════════ 22~29 사용 예시 8장 ══════════
    uses = [
        (22, "대시보드", ["로그인하면 회사 잔액·손익·받을 돈·세금 기한이 한 줄로 정리됩니다",
                       "오늘 손대야 할 일은 근거와 함께 급한 순으로 놓입니다"], "use-dash.png"),
        (23, "통장 자동 수집", ["여러 은행 계좌의 잔액과 거래가 자동으로 들어와 한 화면에 모입니다",
                          "이번 달 수입·지출과 분류 완료율을 바로 확인합니다"], "use-bank.png"),
        (24, "매입매출전표", ["수집된 세금계산서·카드 자료가 전표 후보로 놓입니다",
                         "담당자는 확인하고 확정만 하면 그대로 장부가 됩니다"], "use-voucher.png"),
        (25, "세금계산서 발행", ["발행과 수취 내역이 한 표에 모이고 그 자리에서 발행합니다",
                          "발행 내역은 장부와 대조되어 빠진 건을 알려 줍니다"], "use-tax.png"),
        (26, "경영 흐름", ["수입과 지출을 월별로 세워 흐름을 봅니다",
                       "계정별로 펼쳐 어디서 늘고 줄었는지 확인합니다"], "use-flow.png"),
        (27, "손익 계산", ["확정된 전표만으로 이번 달 손익을 계산합니다",
                     "아직 전표로 만들지 않은 자료는 몇 건인지 함께 알려 줍니다"], "use-profit.png"),
        (28, "프로젝트 · 매출 흐름", ["검토 → 제안 → 계약 → 발행 → 입금을 건별 카드로 봅니다",
                              "잔금이 얼마 남았는지 카드에서 바로 읽힙니다"], "use-project.png"),
        (29, "근태 · 급여", ["출퇴근 기록이 쌓이고 지각·연장이 자동으로 계산됩니다",
                        "급여 계산과 명세서 발송까지 이어집니다"], "use-att.png"),
    ]
    for pg, title, pipes, img in uses:
        use_slide(pg, title, pipes, img)

    # ══════════ 30 챕터 Ⅳ ══════════
    chapter("CHAPTER Ⅳ", "도입하기", "오늘 가입하고, 오늘부터 씁니다.", 30)

    # ══════════ 31 역할별로 보는 화면 ══════════
    s = plain(31, "역할마다 보는 화면이 다릅니다", "같은 자료를 쓰지만, 각자에게 필요한 것만 먼저 보입니다.")
    roles = [("대표", "회사 신호 6칸 · 오늘 챙길 것 · 경영 흐름", "오늘 회사가 어떤 상태인지 30초 안에 확인합니다."),
             ("경리 · 총무", "수집 · 전표 · 세금계산서 · 급여", "제안된 분류를 확인하고 확정합니다. 월말이 짧아집니다."),
             ("팀장", "프로젝트 · 결재 · 일정", "맡은 일의 진행과 결재를 한 화면에서 처리합니다."),
             ("직원", "마이페이지 · 근태 · 급여명세 · 요청", "출퇴근부터 증명서까지 스스로 처리합니다.")]
    for i, (t, menus, d) in enumerate(roles):
        x = Inches(0.62) + i * Inches(3.11)
        rect(s, x, Inches(2.2), Inches(2.9), Inches(3.7), fill=WHITE, line=LINE,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
        rect(s, x, Inches(2.2), Inches(2.9), Inches(0.62), fill=BR, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.12)
        rect(s, x, Inches(2.62), Inches(2.9), Inches(0.2), fill=BR)
        text(s, x, Inches(2.36), Inches(2.9), Inches(0.32), [(t, 13.5, True, WHITE)], PP_ALIGN.CENTER)
        text(s, x + Inches(0.25), Inches(3.05), Inches(2.4), Inches(1.0), [(menus, 10, True, INK)], spacing=1.35)
        text(s, x + Inches(0.25), Inches(4.35), Inches(2.4), Inches(1.3), [(d, 10, False, MUT)], spacing=1.35)
    text(s, Inches(0.62), Inches(6.15), Inches(12.11), Inches(0.3),
         [("메뉴 접근과 세부 기능(금액 보기 등)은 구성원마다 따로 켜고 끕니다.", 10.5, False, DIM)], PP_ALIGN.CENTER)

    # ══════════ 32 보안 · 권한 · 데이터 ══════════
    s = plain(32, "회사 자료를 맡기는 일이라, 여기부터 말씀드립니다",
              "권한은 메뉴 단위로, 보안은 데이터 단위로 걸어 둡니다.")
    rect(s, Inches(0.62), Inches(1.95), Inches(6.5), Inches(4.55), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.04)
    pic(s, "f-perm.png", Inches(0.75), Inches(2.08), Inches(6.24), Inches(4.29), border=False)
    items = [("메뉴 · 기능별 권한", "구성원마다 볼 메뉴와 세부 기능을 따로 켭니다. 저장 전에 “○○님이 사용하게 될 메뉴”를 그대로 보여 드립니다."),
             ("행 단위 접근 통제", "화면만 가리는 것이 아니라 데이터베이스에서 회사·권한별로 막습니다. 주소를 알아도 남의 회사 자료는 열리지 않습니다."),
             ("감사 로그", "누가 언제 무엇을 바꿨는지 남습니다. 결재·발행 같은 확정 행위는 사람과 시각이 함께 기록됩니다."),
             ("인증서 · 자료 보관", "공동인증서는 조회 목적으로만 쓰고 암호화해 보관합니다. 쌓인 자료는 언제든 엑셀로 내려받으실 수 있습니다.")]
    for i, (t, d) in enumerate(items):
        y = Inches(1.95) + i * Inches(1.16)
        rect(s, Inches(7.45), y, Inches(5.28), Inches(1.02), fill=BAND, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08)
        text(s, Inches(7.7), y + Inches(0.14), Inches(4.85), Inches(0.3), [(t, 11.5, True, BR)])
        text(s, Inches(7.7), y + Inches(0.46), Inches(4.85), Inches(0.5), [(d, 9.2, False, MUT)], spacing=1.25)

    # ══════════ 33 도입 절차 · 자료 이관 ══════════
    s = plain(33, "도입은 네 단계로 끝납니다", "설치가 필요 없습니다. 웹에서 가입하고 바로 씁니다.")
    steps = [("가입", "이메일 또는 카카오·구글 계정으로 가입합니다.", "3분"),
             ("회사 개설", "사업자등록번호로 회사를 만듭니다.\n이미 있으면 합류를 요청합니다.", "5분"),
             ("연동", "공동인증서를 한 번 등록하면\n은행·카드·홈택스 자료가 모입니다.", "10분"),
             ("구성원 초대", "메일로 초대하고 권한을 메뉴별로 켭니다.", "5분")]
    for i, (t, d, tm) in enumerate(steps):
        x = Inches(0.62) + i * Inches(3.11)
        rect(s, x, Inches(2.1), Inches(2.9), Inches(2.75), fill=WHITE, line=LINE,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
        rect(s, x + Inches(1.2), Inches(2.35), Inches(0.5), Inches(0.5), fill=BR, shape=MSO_SHAPE.OVAL)
        text(s, x + Inches(1.2), Inches(2.43), Inches(0.5), Inches(0.3), [(str(i + 1), 14, True, WHITE)], PP_ALIGN.CENTER)
        text(s, x, Inches(3.02), Inches(2.9), Inches(0.32), [(t, 13.5, True, INK)], PP_ALIGN.CENTER)
        text(s, x + Inches(0.25), Inches(3.45), Inches(2.4), Inches(0.9), [(d, 9.8, False, MUT)], PP_ALIGN.CENTER, spacing=1.3)
        text(s, x, Inches(4.45), Inches(2.9), Inches(0.3), [(tm, 11, True, BR)], PP_ALIGN.CENTER)
        if i < 3:
            text(s, x + Inches(2.92), Inches(3.3), Inches(0.19), Inches(0.3), [("›", 16, True, DIM)], PP_ALIGN.CENTER)
    rect(s, Inches(0.62), Inches(5.15), Inches(12.11), Inches(1.35), fill=BAND, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
    text(s, Inches(0.95), Inches(5.35), Inches(5.4), Inches(0.32), [("쓰시던 자료는 어떻게 되나요?", 12, True, BR)])
    text(s, Inches(0.95), Inches(5.72), Inches(5.4), Inches(0.6),
         [("엑셀은 그대로 올리시면 됩니다. 지난 거래는 연동 시점부터 자동으로 들어오고, 그 이전 자료는 업로드로 채웁니다.", 9.8, False, MUT)], spacing=1.3)
    text(s, Inches(6.9), Inches(5.35), Inches(5.4), Inches(0.32), [("세무사와는 어떻게 하나요?", 12, True, BR)])
    text(s, Inches(6.9), Inches(5.72), Inches(5.4), Inches(0.6),
         [("같은 화면을 열어 드리면 됩니다. 필요한 자료는 엑셀로 내려받아 전달하실 수도 있습니다.", 9.8, False, MUT)], spacing=1.3)

    # ══════════ 34 요금제 (실제 구성) · 문의 ══════════
    #   사장님 지시(2026-08-20): 문의 폼 입력칸은 빼고 **실제 요금제 구성**을 넣는다.
    #   링크는 하이퍼링크로 — 누르면 그 페이지가 열린다.
    s = slide()
    text(s, Inches(0.6), Inches(0.42), Inches(12.13), Inches(0.45),
         [("무료로 시작해, 회사에 맞게 자랍니다", 23, True, INK)], PP_ALIGN.CENTER)
    text(s, Inches(0.6), Inches(1.0), Inches(12.13), Inches(0.3),
         [("기본 5명 포함 · VAT 별도 · 카드 등록 없이 무료로 시작합니다.", 11.5, False, MUT)], PP_ALIGN.CENTER)

    # 열 위치
    cx = [Inches(0.62), Inches(4.72), Inches(7.42), Inches(10.12)]
    cw = [Inches(4.0), Inches(2.6), Inches(2.6), Inches(2.6)]
    top = Inches(1.52)
    # 추천 열(오너뷰) 배경
    rect(s, cx[2], top, cw[2], Inches(4.62), fill=SOFT, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.04)
    # 머리
    heads = [("", "", ""), ("무료", "₩0", "카드 등록 없이 계속"),
             ("오너뷰", "₩39,000/월", "추가 1명 ₩5,000"), ("울트라", "비용 협의", "도입 범위에 따라 견적")]
    for i2, (nm, price, sub) in enumerate(heads):
        if not nm: continue
        c = BR if i2 == 2 else INK
        text(s, cx[i2], top + Inches(0.12), cw[i2], Inches(0.3), [(nm, 12.5, True, c)], PP_ALIGN.CENTER)
        text(s, cx[i2], top + Inches(0.45), cw[i2], Inches(0.35), [(price, 15, True, c)], PP_ALIGN.CENTER)
        text(s, cx[i2], top + Inches(0.85), cw[i2], Inches(0.28), [(sub, 8.8, False, DIM)], PP_ALIGN.CENTER)
    rect(s, cx[0], top + Inches(1.2), Inches(12.11), Emu(12700), fill=LINE)

    rows = [
        ("구성원", "5명", "기본 5명 + 1명 ₩5,000/월", "무제한"),
        ("세금계산서·현금영수증 발행", "월 5건 · 5건", "월 100건 · 100건", "무제한"),
        ("전자계약", "월 5건", "무제한", "무제한"),
        ("통장·카드 연결", "3개 · 하루 2회", "무제한 · 하루 2회 + 즉시", "무제한 + 주기 협의"),
        ("홈택스 자동 수집", "—", "✓", "✓"),
        ("AI 참모", "월 10만 토큰", "월 50만 토큰", "협의(전용 한도)"),
        ("AI 브리핑", "기본형(규칙)", "매일 자동 분석", "회사 지표에 맞춘 브리핑"),
        ("전자결재·근태·급여·프로젝트", "무제한", "무제한", "무제한"),
        ("회사에 맞춘 별도 UX 구축", "—", "—", "✓ 화면·흐름 맞춤 설계"),
        ("기존 시스템 연동(ERP·그룹웨어)", "—", "—", "✓ 협의"),
        ("데이터 이관 · 온보딩 교육", "—", "셀프 가이드", "✓ 전담 담당자"),
        ("지원", "고객센터", "고객센터 · 우선 답변", "전담 채널 · SLA"),
    ]
    y = top + Inches(1.34)
    for k, a, b, c in rows:
        text(s, cx[0], y, cw[0], Inches(0.26), [(k, 9.6, True, INK)])
        for i2, v in enumerate([a, b, c], start=1):
            col = BR if i2 == 2 else (DIM if v == "—" else MUT)
            bold = i2 == 2
            text(s, cx[i2], y, cw[i2], Inches(0.26), [(v, 9.2, bold, col)], PP_ALIGN.CENTER)
        y += Inches(0.283)

    # 하단 — 하이퍼링크 3개
    ly = Inches(6.35)
    rect(s, Inches(0.62), ly, Inches(12.11), Inches(0.72), fill=BR, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.18)
    text(s, Inches(1.0), ly + Inches(0.22), Inches(2.6), Inches(0.3),
         [("지금 시작해 보십시오", 12, True, WHITE)])
    link_text(s, Inches(3.5), ly + Inches(0.22), Inches(2.9), Inches(0.3),
              "www.owner-view.com", "https://www.owner-view.com",
              size=11.5, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    link_text(s, Inches(6.6), ly + Inches(0.22), Inches(2.6), Inches(0.3),
              "요금 안내 →", "https://www.owner-view.com/pricing",
              size=11.5, bold=True, color=RGBColor(0xC7, 0xD6, 0xFF))
    link_text(s, Inches(9.3), ly + Inches(0.22), Inches(3.2), Inches(0.3),
              "도입 상담 신청 →", "https://www.owner-view.com/#partner",
              size=11.5, bold=True, color=RGBColor(0xC7, 0xD6, 0xFF))
    #   이 장표는 하단 링크 바가 푸터 자리를 쓰므로 쪽번호만 오른쪽 위에 둔다
    text(s, Inches(9.8), Inches(0.45), Inches(2.9), Inches(0.22),
         [("34 / 34", 8, False, DIM)], PP_ALIGN.RIGHT)
