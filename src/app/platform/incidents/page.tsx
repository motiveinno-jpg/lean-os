export default function PlatformIncidentsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">사고 기록</h1>
        <p className="text-sm text-[#64748b] mt-1">504 / RLS 재귀 / publication 누락 등 운영 사고 타임라인</p>
      </div>
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center">
        <div className="text-cyan-400 text-xs font-bold tracking-wider uppercase mb-2">PR-F 예정</div>
        <h2 className="text-lg font-bold text-white mb-2">operator_incidents 테이블 + 초기 데이터 입력 대기</h2>
        <p className="text-sm text-[#64748b] max-w-md mx-auto">
          발생일·증상·근본원인·재발방지 컬럼.
          INCIDENT_504_2026_05_20 등 기존 기록을 시드로 옮길 예정.
        </p>
      </div>
    </div>
  );
}
