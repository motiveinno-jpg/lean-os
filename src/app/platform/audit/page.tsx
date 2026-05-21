export default function PlatformAuditPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">감사 로그</h1>
        <p className="text-sm text-[#64748b] mt-1">운영자가 수행한 모든 회사 데이터 조회·변경 이력</p>
      </div>
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center">
        <div className="text-cyan-400 text-xs font-bold tracking-wider uppercase mb-2">PR-F 예정</div>
        <h2 className="text-lg font-bold text-white mb-2">operator_actions 테이블 + 자동 기록 트리거 대기</h2>
        <p className="text-sm text-[#64748b] max-w-md mx-auto">
          누가·언제·어떤 회사·어떤 화면을 조회했는지 자동 적재.
          타사 데이터 열람은 무조건 한 줄 남도록.
        </p>
      </div>
    </div>
  );
}
