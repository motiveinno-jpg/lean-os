export default function PlatformErrorsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">에러 해석</h1>
        <p className="text-sm text-[#64748b] mt-1">최근 발생한 에러를 비전공자도 이해 가능한 언어로 변환</p>
      </div>
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center">
        <div className="text-cyan-400 text-xs font-bold tracking-wider uppercase mb-2">PR-E 예정</div>
        <h2 className="text-lg font-bold text-white mb-2">operator-error-explain 라이브러리 작성 대기</h2>
        <p className="text-sm text-[#64748b] max-w-md mx-auto">
          Postgres / CODEF / Stripe / Edge / Network 코드 매핑.
          각 에러마다 무슨 일이에요? / 어떻게 고치나? 두 줄 설명.
        </p>
      </div>
    </div>
  );
}
