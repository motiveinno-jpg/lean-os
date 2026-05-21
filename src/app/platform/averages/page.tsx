export default function PlatformAveragesPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">재무 평균</h1>
        <p className="text-sm text-[#64748b] mt-1">전체 회사 재무 지표의 평균·중앙값·표본수</p>
      </div>
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center">
        <div className="text-cyan-400 text-xs font-bold tracking-wider uppercase mb-2">PR-C 예정</div>
        <h2 className="text-lg font-bold text-white mb-2">operator_financial_averages RPC 연결 대기</h2>
        <p className="text-sm text-[#64748b] max-w-md mx-auto">
          월별 매출/지출/순이익/현금흐름/외상매출 평균을 가로 막대로,
          업계별 분리는 /platform/industry 에서 별도 표시.
        </p>
      </div>
    </div>
  );
}
