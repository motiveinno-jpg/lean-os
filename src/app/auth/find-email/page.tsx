"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const maskedLocal = local.length > 1 ? local[0] + "***" : "***";
  return `${maskedLocal}@${domain}`;
}

export default function FindEmailPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<string[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResults(null);

    if (!name.trim()) return setError("이름을 입력해주세요.");

    setLoading(true);

    try {
      const { data, error: dbError } = await supabase
        .from("users")
        .select("email, name")
        .ilike("name", `%${name.trim()}%`);

      if (dbError) {
        setLoading(false);
        return setError("조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }

      if (!data || data.length === 0) {
        setLoading(false);
        return setResults([]);
      }

      const masked = data.map((u: { email: string }) => maskEmail(u.email));
      setResults(masked);
    } catch {
      setError("서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.");
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[var(--bg)]">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4">
            <svg width="56" height="56" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="#111"/>
              <circle cx="18" cy="17" r="9" stroke="#fff" strokeWidth="2.2" fill="none"/>
              <line x1="24.5" y1="23.5" x2="32" y2="31" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"/>
              <polyline points="12,20 15,18 18,19 22,14" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="22" cy="14" r="1.5" fill="#3b82f6"/>
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">이메일 찾기</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            가입 시 등록한 이름으로 이메일을 찾을 수 있습니다
          </p>
        </div>

        {/* Card */}
        <div
          className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-8"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--danger-dim)] border border-[var(--danger)]/20 text-[var(--danger)] text-sm">
              {error}
            </div>
          )}

          {/* Results */}
          {results !== null && (
            <div className="mb-6">
              {results.length === 0 ? (
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                  </div>
                  <p className="text-[var(--text)] font-semibold mb-1">검색 결과가 없습니다</p>
                  <p className="text-[var(--text-muted)] text-sm">
                    입력하신 정보와 일치하는 계정을 찾을 수 없습니다.
                  </p>
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-4">
                    <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-[var(--text)] font-semibold text-lg mb-3">이메일을 찾았습니다</p>
                  <div className="space-y-2">
                    {results.map((maskedEmail, i) => (
                      <div
                        key={i}
                        className="px-4 py-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] text-sm font-mono text-[var(--text)]"
                      >
                        {maskedEmail}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-3">
                    보안을 위해 이메일 일부가 가려져 있습니다.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Search Form */}
          {results === null && (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="홍길동"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">전화번호 (선택)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-1234-5678"
                  className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition"
                />
                <p className="text-xs text-[var(--text-dim)] mt-1">
                  전화번호가 등록되어 있는 경우 더 정확한 결과를 제공합니다.
                </p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 shadow-sm"
              >
                {loading ? "검색 중..." : "이메일 찾기"}
              </button>
            </form>
          )}

          {/* Retry after results */}
          {results !== null && (
            <button
              onClick={() => {
                setResults(null);
                setName("");
                setPhone("");
                setError("");
              }}
              className="w-full py-3 bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] rounded-xl font-semibold text-sm transition border border-[var(--border)]"
            >
              다시 검색하기
            </button>
          )}
        </div>

        {/* Back to login */}
        <div className="text-center mt-6">
          <Link
            href="/auth"
            className="text-sm text-[var(--primary)] hover:underline font-medium"
          >
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
