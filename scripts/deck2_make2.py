# -*- coding: utf-8 -*-
"""소개서 v2 — 08~20장 (비교 챕터 · 기능 3단 밴드 8장)"""
from deck2_core import *          # noqa: F401,F403

def part2():
    # ══════════ 08 챕터 Ⅰ ══════════
    chapter("CHAPTER Ⅰ", "기존 ERP와 무엇이 다를까요", "지금 쓰시는 방식과 나란히 놓고 비교해 봤습니다.", 8)

    # ══════════ 09 비교표 ══════════
    s = plain(9, "지금 쓰시는 방식과 나란히 놓고 비교해 봤습니다",
              "기존 ERP가 나쁜 것은 아닙니다. 다만 우리 회사에 비해 무겁습니다.")
    cols = [Inches(0.62), Inches(2.75), Inches(5.55), Inches(8.9)]
    widths = [Inches(2.1), Inches(2.75), Inches(3.3), Inches(3.83)]
    heads = ["", "엑셀 · 수기", "기존 ERP", "오너뷰"]
    top = Inches(2.05)
    rect(s, cols[3], top, widths[3], Inches(4.45), fill=SOFT, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.03)
    rect(s, cols[3], top, widths[3], Inches(0.45), fill=BR, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.15)
    rect(s, cols[3], top + Inches(0.25), widths[3], Inches(0.2), fill=BR)
    for i, h in enumerate(heads):
        if not h: continue
        c = WHITE if i == 3 else MUT
        text(s, cols[i], top + Inches(0.1), widths[i], Inches(0.3), [(h, 12, True, c)], PP_ALIGN.CENTER)
    rows = [
        ("도입 기간", "즉시(대신 계속 손이 감)", "수 주 ~ 수 개월 · 컨설팅", "당일 — 가입하고 바로"),
        ("초기 비용", "없음", "구축비 수백만 ~ 수천만 원", "0원 · 무료로 시작"),
        ("자료 입력", "전부 손으로", "대부분 손으로 · 일부 연동", "은행·카드·국세청 자동 수집"),
        ("현황 파악", "파일을 열어 합산", "메뉴를 찾아 조회·출력", "로그인하면 첫 화면에"),
        ("쓰는 용어", "사람마다 다름", "회계 용어 위주", "받을 돈 · 낼 돈 · 오늘 챙길 것"),
        ("교육", "따로 없지만 실수가 잦음", "담당자 교육 필요", "따로 없음 · 화면이 안내"),
        ("모바일", "사실상 불가", "제한적", "웹 그대로"),
        ("확장", "파일만 늘어남", "추가 개발 비용", "메뉴를 켜고 끄면 됨 · 맞춤은 울트라"),
    ]
    y = top + Inches(0.55)
    for k, a, b, c in rows:
        text(s, cols[0], y, widths[0], Inches(0.3), [(k, 10.5, True, INK)])
        text(s, cols[1], y, widths[1], Inches(0.3), [(a, 9.5, False, MUT)], PP_ALIGN.CENTER)
        text(s, cols[2], y, widths[2], Inches(0.3), [(b, 9.5, False, MUT)], PP_ALIGN.CENTER)
        text(s, cols[3], y, widths[3], Inches(0.3), [(c, 9.8, True, BR)], PP_ALIGN.CENTER)
        y += Inches(0.48)
        rect(s, cols[0], y - Inches(0.09), Inches(12.11), Emu(9525), fill=LINE)

    # ══════════ 10 도입 전 · 후 ══════════
    s = plain(10, "담당자의 월말이 이렇게 바뀝니다", "경리·총무 담당자가 매달 하시던 일을 기준으로 정리했습니다.")
    before = ["은행 3곳에 로그인해 거래내역을 내려받습니다",
              "카드사 승인내역을 따로 받아 엑셀에 붙입니다",
              "홈택스에서 계산서를 조회해 다시 정리합니다",
              "영수증을 모아 계정과목을 하나씩 적습니다",
              "세무사에게 넘길 파일을 만들어 보냅니다",
              "누락이 생기면 처음부터 다시 확인합니다"]
    after = ["거래·승인·계산서가 이미 들어와 있습니다",
             "계정과목과 거래처가 제안된 상태로 놓입니다",
             "담당자는 확인하고 확정만 합니다",
             "빠진 자료는 화면이 몇 건인지 알려 줍니다",
             "세무사에게는 같은 화면을 열어 드립니다",
             "지난달 것도 그대로 남아 있습니다"]
    for idx, (title, items, bg, ln, tc) in enumerate([
            ("도입 전", before, BADR, BADL, RGBColor(0xC5, 0x30, 0x30)),
            ("도입 후", after, GOODB, GOODL, BR)]):
        x = Inches(0.62) + idx * Inches(6.5)
        rect(s, x, Inches(2.0), Inches(5.6), Inches(4.0), fill=bg, line=ln,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
        text(s, x + Inches(0.3), Inches(2.25), Inches(4.9), Inches(0.35), [(title, 14, True, tc)])
        for j, it in enumerate(items):
            yy = Inches(2.8) + j * Inches(0.5)
            text(s, x + Inches(0.3), yy, Inches(0.2), Inches(0.3), [("·", 11, True, tc)])
            text(s, x + Inches(0.55), yy, Inches(4.75), Inches(0.4), [(it, 10.2, False, MUT)], spacing=1.2)
    text(s, Inches(6.32), Inches(3.75), Inches(0.5), Inches(0.5), [("›", 22, True, DIM)], PP_ALIGN.CENTER)
    rect(s, Inches(0.62), Inches(6.2), Inches(12.11), Inches(0.62), fill=BAND, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.18)
    text(s, Inches(0.62), Inches(6.36), Inches(12.11), Inches(0.35),
         [("자료를 모으는 시간이 줄면, 그만큼 ", 12, True, INK), ("판단할 시간이 늘어납니다.", 12, True, AMB)], PP_ALIGN.CENTER)

    # ══════════ 11 왜 쉬운가 ══════════
    s = plain(11, "쉬워야 씁니다. 그래서 이렇게 만들었습니다",
              "도입을 망설이게 하는 네 가지를 먼저 덜어냈습니다.")
    for i, (t, d) in enumerate([
            ("설치가 없습니다", "웹에서 바로 씁니다. 서버도 설치 파일도 전산 담당자도 필요하지 않습니다."),
            ("교육이 없습니다", "‘받을 돈 · 낼 돈 · 오늘 챙길 것’ 처럼 평소 쓰시던 말로 되어 있습니다."),
            ("연동은 한 번뿐입니다", "공동인증서를 한 번 등록하면 이후 자료는 알아서 들어옵니다."),
            ("안 쓰는 기능은 안 보입니다", "필요한 메뉴만 켜 두시면 됩니다. 나중에 켜셔도 자료는 그대로입니다.")]):
        x = Inches(0.62) + (i % 2) * Inches(6.5)
        y = Inches(2.2) + (i // 2) * Inches(2.1)
        rect(s, x, y, Inches(5.6), Inches(1.8), fill=WHITE, line=LINE,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
        rect(s, x, y, Inches(0.09), Inches(1.8), fill=BR)
        text(s, x + Inches(0.42), y + Inches(0.32), Inches(4.9), Inches(0.35), [(t, 14.5, True, BR)])
        text(s, x + Inches(0.42), y + Inches(0.88), Inches(4.9), Inches(0.7), [(d, 10.5, False, MUT)], spacing=1.35)

    # ══════════ 12 챕터 Ⅱ ══════════
    chapter("CHAPTER Ⅱ", "어떤 일이 줄어들까요", "손이 많이 가던 일곱 가지를 화면으로 보여 드립니다.", 12)

    # ══════════ 13~19 기능 3단 밴드 ══════════
    three_band(13, "통장과 카드가 스스로 들어옵니다",
               "여러 은행 앱을 오갈 필요 없이 전 계좌·전 카드를 한 화면에서 봅니다",
               [("통장이 세 개인데 ", "잔액을 보려면 앱을 세 번 열어야", " 해요"),
                ("거래 하나하나 ", "엑셀에 옮겨 적는 게", " 제일 오래 걸려요")],
               [("전 계좌를 한 줄로", "계좌별 잔액과 이번 달 변화가\n로그인 즉시 한 줄에 섭니다", "f-bank-accounts.png"),
                ("법인카드도 함께", "카드사 승인 내역이 자동으로 들어오고\n결제일·한도를 함께 봅니다", "f-cards.png"),
                ("분류까지 제안", "적요를 읽어 계정과목과 거래처를\n제안합니다", "f-collect.png")])

    three_band(14, "장부는 채워진 채로 시작합니다",
               "국세청 자료까지 모아 전표 후보를 만들어 둡니다. 확정만 하시면 됩니다",
               [("", "부가세 낼 돈을 미리 못 잡아 둬서", " 신고 때마다 급해요"),
                ("계산서를 발행했는지 안 했는지 ", "찾아봐야", " 알아요")],
               [("자료 수집", "통장·카드·세금계산서·현금영수증을\n채널별로 모읍니다", "f-collect.png"),
                ("세금계산서", "발행과 수취 내역이 한 표에 모이고\n그 자리에서 발행합니다", "f-tax.png"),
                ("전표 확정", "매입매출전표가 제안된 상태로 놓입니다\n확인하고 확정하면 장부가 됩니다", "f-voucher.png")])

    three_band(15, "오늘 회사 상태를 30초 안에 봅니다",
               "통장 잔액부터 세금 기한까지, 로그인하면 가장 먼저 만나는 여섯 칸입니다",
               [("지금 ", "돈이 얼마 있는지 바로 답을 못 합니다", ""),
                ("", "이 속도로 쓰면 몇 달 버티는지", " 계산해 본 적이 없어요")],
               [("회사 신호 여섯 칸", "잔액·30일 뒤·손익·받을 돈·낼 돈·세금을\n색으로 알려 줍니다", "f-signals.png"),
                ("오늘 챙길 것", "손대야 할 일을 근거와 함께\n급한 순으로 정리합니다", "f-brief.png"),
                ("경영 흐름", "지난 흐름과 30일 뒤 예상을\n함께 봅니다", "f-flow.png")])

    three_band(16, "받을 돈과 낼 돈을 놓치지 않습니다",
               "언제 받을 돈인지, 며칠 밀렸는지, 30일 뒤에 얼마가 남는지 화면이 먼저 말해 줍니다",
               [("", "언제 준다던 돈인지 기억이 안 나서", " 독촉을 못 해요"),
                ("미수금이 쌓이는 걸 ", "분기가 지나서야", " 알았습니다")],
               [("미수 경과로 보기", "30일·60일·90일로 나눠\n오래된 것부터 보여 줍니다", "f-ledger.png"),
                ("거래처 원장", "거래처를 고르면 주고받은 내역이\n한 줄로 정리됩니다", "f-ledger.png"),
                ("30일 뒤 예측", "들어올 돈과 나갈 돈을 셈해\n남을 금액을 미리 알려 줍니다", "f-flow.png")])

    three_band(17, "일마다 맞는 화면을 드립니다",
               "프로젝트를 만들면 하는 일에 맞는 첫 화면이 열립니다",
               [("회의에서 정한 걸 ", "다시 정리해 옮겨 적습니다", ""),
                ("견적·계약·입금이 ", "각각 다른 파일에", " 있어요")],
               [("템플릿에서 시작", "부서가 아니라 일의 형태로 고릅니다\n칸까지 갖춰진 표가 만들어집니다", "f-templates.png"),
                ("회의 결정 → 할 일", "안건 아래 결정을 적고 버튼 하나로\n담당·기한과 함께 넘깁니다", "f-meeting.png"),
                ("매출 파이프라인", "검토→제안→계약→발행→입금을\n점으로 봅니다", "f-deal.png")])

    three_band(18, "계약과 문서가 흐름을 따라갑니다",
               "견적에서 발행까지 앞 문서의 내용이 다음 문서로 그대로 넘어갑니다",
               [("계약서가 ", "어디까지 진행됐는지", " 물어봐야 압니다"),
                ("", "만기가 지난 걸 나중에", " 알게 됩니다")],
               [("견적서 · 계약서", "매출 줄에서 바로 만듭니다\n품목과 금액이 그대로 넘어갑니다", "f-deal.png"),
                ("전자서명", "보내고 받는 과정이 목록에 남습니다\n종이가 필요 없습니다", "f-sign.png"),
                ("계약 만기 D-day", "임박한 순으로 세워 둡니다\n지난 계약은 붉게 올라옵니다", "f-contract.png")])

    three_band(19, "직원은 마이페이지 하나로 끝냅니다",
               "출퇴근부터 급여명세서까지 한 곳에서 처리하고, 관리자는 표 한 장으로 봅니다",
               [("출퇴근은 단톡방에, ", "연차는 수첩에", " 적습니다"),
                ("급여명세서를 ", "매달 엑셀로 만들어", " 보냅니다")],
               [("구성원 관리", "입사일·부서·직위·고용형태를\n한 표로 봅니다", "f-emp.png"),
                ("근태", "출퇴근이 쌓이고 지각·연장이\n자동으로 계산됩니다", "f-att.png"),
                ("일정 · 협업", "일정과 할 일을 한 곳에서 봅니다\n공개 범위는 사람마다 정합니다", "f-sched.png")])

    # ══════════ 20 AI 참모 ══════════
    s = plain(20, "회사 자료를 아는 AI 에게 물어보세요",
              "매출·자금·인사 현황을 평소 말로 물어보시면 됩니다. 답에는 근거가 함께 붙습니다.")
    rect(s, Inches(0.62), Inches(1.95), Inches(7.4), Inches(4.55), fill=WHITE, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.04)
    pic(s, "f-copilot.png", Inches(0.75), Inches(2.08), Inches(7.14), Inches(4.29), border=False)
    for i, (t, d) in enumerate([
            ("무엇이든 물어보세요", "“이번 달 미수금 얼마야?”처럼 물으시면 회사 자료를 근거로 답합니다."),
            ("출처를 함께 적습니다", "AI 추천 / 배운 규칙 / 국세청 조회 / 장부 대조 — 어디서 나온 답인지 밝힙니다."),
            ("실행은 사람이", "결재 상신·발송 같은 실행은 확인하신 뒤 직접 누르시면 됩니다."),
            ("매일 아침 브리핑", "묻지 않으셔도 오늘 챙길 것을 다섯 줄로 정리해 둡니다.")]):
        y = Inches(1.95) + i * Inches(1.16)
        rect(s, Inches(8.4), y, Inches(4.33), Inches(1.0), fill=BAND, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08)
        text(s, Inches(8.65), y + Inches(0.16), Inches(3.9), Inches(0.3), [(t, 11.5, True, BR)])
        text(s, Inches(8.65), y + Inches(0.5), Inches(3.9), Inches(0.45), [(d, 9.5, False, MUT)], spacing=1.25)
