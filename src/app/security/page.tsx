"use client";

// 보안 안내 — 회사 돈줄(통장·카드·홈택스)을 맡기기 전에 사장님이 가장 먼저 묻는 것들에 답한다.
//   여기 적힌 것은 전부 코드와 DB 설정으로 확인한 사실만이다. 과장·추정은 적지 않는다.
import Link from "next/link";
import { RollingBrandText } from "@/components/brand-logo";

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "회사 자료는 회사별로 완전히 분리됩니다",
    body: [
      "모든 표(통장 거래, 카드 사용내역, 세금계산서, 직원, 근태, 문서 등)는 데이터베이스 단계에서 회사 번호로 잠겨 있습니다. 다른 회사 계정으로 로그인하면 우리 회사 자료는 조회 자체가 되지 않습니다. 화면 코드의 실수로도 남의 자료가 섞이지 않도록 데이터베이스가 직접 막습니다.",
      "세무대리인(세무사)이 고객사 화면을 볼 때도 같은 잠금이 적용되며, 세무대리인 세션은 읽기만 되고 어떤 수정·삭제도 할 수 없습니다.",
    ],
  },
  {
    title: "인증서 파일은 접근이 제한된 별도 저장소에 둡니다",
    body: [
      "공동인증서 파일은 일반 자료와 분리된 전용 저장소에 회사별 폴더로 보관하며, 그 회사의 대표·관리자 계정만 접근할 수 있습니다.",
      "인증서 비밀번호, 홈택스·카드사 로그인 비밀번호는 저장 전에 암호화합니다. 암호화 키는 데이터베이스 안의 별도 금고(Vault)에만 있어 자료를 통째로 내려받아도 비밀번호를 읽을 수 없습니다.",
      "금융기관에 조회를 요청할 때 비밀번호는 금융 데이터 중계사의 공개키로 다시 한 번 암호화해 보냅니다.",
    ],
  },
  {
    title: "오너뷰는 조회만 하고, 돈을 움직이지 않습니다",
    body: [
      "통장·카드·홈택스 연결은 거래내역·잔액·계산서를 읽어 오기 위한 것입니다. 오너뷰에는 계좌이체·송금·결제를 실행하는 기능이 없고, 그런 요청을 보내는 코드 자체가 없습니다. 연결한 인증서와 비밀번호는 조회에만 쓰입니다.",
      "금융 자료 수집은 금융보안원 지정 마이데이터·스크래핑 중계사인 (주)헥토데이터(CODEF)를 통해 이루어지며, 위탁 내용은 개인정보처리방침에 공개되어 있습니다.",
    ],
  },
  {
    title: "누가 무엇을 봤는지 기록이 남습니다",
    body: [
      "자료 조회·변경·삭제 같은 중요한 동작은 감사 기록에 남습니다. 이 기록은 회사 대표(마스터)를 포함한 어떤 사용자도 지울 수 없습니다.",
      "구성원마다 볼 수 있는 화면과 할 수 있는 일을 따로 정할 수 있습니다. 급여·통장처럼 민감한 화면은 권한을 준 사람에게만 열립니다.",
    ],
  },
  {
    title: "그만둘 때는 자료를 지웁니다",
    body: [
      "마이페이지에서 직접 계정을 삭제할 수 있습니다. 회사 자료 삭제를 원하시면 아래 메일로 요청해 주세요. 법령상 보관 의무가 있는 자료(세금계산서 등)는 그 기간이 지난 뒤 삭제됩니다.",
    ],
  },
];

export default function SecurityPage() {
  return (
    <div className="legal-page">
      <nav className="legal-site-nav">
        <div className="site-nav-inner">
          <Link href="/" className="brand-logo-link">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm bg-blue-600">L</div>
            <span className="text-lg font-bold text-white"><RollingBrandText /></span>
          </Link>
          <Link href="/" className="px-4 py-2 text-sm text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition">
            홈으로
          </Link>
        </div>
      </nav>

      <main className="legal-content">
        <div className="legal-header">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">보안</h1>
          <p className="text-slate-400 text-sm">통장·카드·홈택스를 맡기기 전에 확인하실 것들을 사실 그대로 적었습니다.</p>
        </div>

        <div className="legal-intro-box">
          <p>오너뷰는 회사의 돈과 사람에 관한 자료를 다룹니다. 그래서 &quot;안전하다&quot;는 말 대신, 실제로 어떻게 지키고 있는지를 항목별로 적습니다. 궁금한 점은 언제든 <a href="mailto:creative@mo-tive.com" className="underline">creative@mo-tive.com</a> 으로 물어보세요.</p>
        </div>

        <div className="legal-sections">
        {SECTIONS.map((s) => (
          <section key={s.title} className="legal-section">
            <h2 className="text-lg font-semibold text-white mb-3">{s.title}</h2>
            {s.body.map((p, i) => <p key={i} className="text-slate-300 text-sm leading-7 mb-3">{p}</p>)}
          </section>
        ))}
        </div>

        <div className="legal-intro-box">
          <p>함께 읽기: <Link href="/privacy" className="underline">개인정보처리방침</Link> · <Link href="/terms" className="underline">이용약관</Link></p>
        </div>
      </main>
    </div>
  );
}
