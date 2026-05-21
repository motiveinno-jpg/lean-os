export default function PlatformDependenciesPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">의존성 상태</h1>
        <p className="text-sm text-[#64748b] mt-1">CODEF · Stripe · Resend · Supabase · Storage · Sentry 헬스</p>
      </div>
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center">
        <div className="text-cyan-400 text-xs font-bold tracking-wider uppercase mb-2">PR-F 예정</div>
        <h2 className="text-lg font-bold text-white mb-2">외부 의존성 헬스체크 엔드포인트 연결 대기</h2>
        <p className="text-sm text-[#64748b] max-w-md mx-auto">
          각 의존성 신호등(녹/주/적) + 최근 24h 실패율,
          장애 시 어느 기능이 막히는지 영향도 표시.
        </p>
      </div>
    </div>
  );
}
