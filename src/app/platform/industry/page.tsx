export default function PlatformIndustryPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">업계별 분석</h1>
        <p className="text-sm text-[#64748b] mt-1">companies.industry 기준 매출·이익 분포와 백분위</p>
      </div>
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center">
        <div className="text-cyan-400 text-xs font-bold tracking-wider uppercase mb-2">PR-D 예정</div>
        <h2 className="text-lg font-bold text-white mb-2">companies.industry 컬럼 + 마이그레이션 대기</h2>
        <p className="text-sm text-[#64748b] max-w-md mx-auto">
          입력 시점: 회사 설정에서 사용자가 직접 선택,
          미분류 회사는 이 페이지에서 운영자가 분류 가능.
        </p>
      </div>
    </div>
  );
}
