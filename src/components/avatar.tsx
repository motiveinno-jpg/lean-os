"use client";

// 프로필 아바타 — 업로드한 사진(src)이 있으면 사진, 없으면 이름 첫 글자 그라데이션 원형.
//   기존 인라인 아바타(w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 …) 통일용.
export function Avatar({
  name,
  src,
  size = 40,
  className = "",
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = (name || "?").trim().charAt(0) || "?";
  const dim = { width: size, height: size };
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || "프로필"}
        style={dim}
        className={`avatar-img rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      style={{ ...dim, fontSize: Math.round(size * 0.4) }}
      className={`avatar-initial rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0 ${className}`}
    >
      {initial}
    </div>
  );
}
