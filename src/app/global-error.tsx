"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#f9fafb",
          }}
        >
          <div style={{ textAlign: "center", padding: "40px" }}>
            <h1 style={{ fontSize: "24px", color: "#111827", marginBottom: "8px" }}>
              오류가 발생했습니다
            </h1>
            <p style={{ color: "#6b7280", marginBottom: "24px" }}>
              일시적인 문제가 발생했습니다. 다시 시도해 주세요.
            </p>
            <button
              onClick={reset}
              style={{
                padding: "10px 24px",
                fontSize: "14px",
                fontWeight: 500,
                color: "#fff",
                background: "#2563eb",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              다시 시도
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
