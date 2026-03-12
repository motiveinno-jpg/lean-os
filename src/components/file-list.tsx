"use client";

import { useState } from "react";

// ── Types ──
interface FileItem {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  version: number;
  created_at: string;
  uploaded_by?: string;
}

interface FileListProps {
  files: FileItem[];
  onDelete?: (fileId: string) => void;
  onNewVersion?: (fileId: string) => void;
  onDownload?: (file: FileItem) => void;
  showVersions?: boolean;
  readOnly?: boolean;
}

// ── File type icon & color mapping ──
function getFileIcon(mimeType: string): {
  icon: string;
  color: string;
  bgColor: string;
} {
  if (mimeType.startsWith("image/"))
    return {
      icon: "IMG",
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    };
  if (mimeType === "application/pdf")
    return { icon: "PDF", color: "text-red-500", bgColor: "bg-red-500/10" };
  if (mimeType.includes("word") || mimeType.includes("msword"))
    return { icon: "DOC", color: "text-blue-500", bgColor: "bg-blue-500/10" };
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet"))
    return {
      icon: "XLS",
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    };
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation"))
    return {
      icon: "PPT",
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
    };
  if (mimeType === "text/csv")
    return {
      icon: "CSV",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    };
  if (mimeType === "text/plain")
    return { icon: "TXT", color: "text-gray-500", bgColor: "bg-gray-500/10" };
  if (mimeType.includes("zip"))
    return {
      icon: "ZIP",
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    };
  return {
    icon: "FILE",
    color: "text-gray-400",
    bgColor: "bg-gray-400/10",
  };
}

// ── Format file size ──
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Format date ──
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHr < 24) return `${diffHr}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Layout modes ──
type LayoutMode = "list" | "grid";

export function FileList({
  files,
  onDelete,
  onNewVersion,
  onDownload,
  showVersions = true,
  readOnly = false,
}: FileListProps) {
  const [layout, setLayout] = useState<LayoutMode>("list");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Handle download ──
  function handleDownload(file: FileItem) {
    if (onDownload) {
      onDownload(file);
    } else {
      window.open(file.file_url, "_blank");
    }
  }

  // ── Handle delete with confirmation ──
  function handleDelete(fileId: string) {
    if (confirmDeleteId === fileId) {
      onDelete?.(fileId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(fileId);
      // Auto-reset confirmation after 3 seconds
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  }

  // ── Empty state ──
  if (!files || files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--border)]/50 flex items-center justify-center mb-3">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-[var(--text-muted)]"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          등록된 파일이 없습니다
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1 opacity-60">
          파일을 업로드하면 여기에 표시됩니다
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header: count + layout toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text)]">
            파일 목록
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--primary)]/10 text-[var(--primary)]">
            {files.length}
          </span>
        </div>

        {/* Layout toggle */}
        <div className="flex items-center gap-0.5 bg-[var(--border)]/30 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setLayout("list")}
            className={`p-1.5 rounded-md transition-colors ${
              layout === "list"
                ? "bg-[var(--bg)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
            title="리스트 보기"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setLayout("grid")}
            className={`p-1.5 rounded-md transition-colors ${
              layout === "grid"
                ? "bg-[var(--bg)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
            title="그리드 보기"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── List layout ── */}
      {layout === "list" && (
        <div className="space-y-1.5">
          {files.map((file) => {
            const { icon, color, bgColor } = getFileIcon(file.mime_type);
            const isConfirming = confirmDeleteId === file.id;

            return (
              <div
                key={file.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] group hover:border-[var(--primary)]/30 transition-colors"
              >
                {/* Type icon */}
                <div
                  className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold ${color} ${bgColor}`}
                >
                  {icon}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <a
                      href={file.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-[var(--text)] hover:text-[var(--primary)] truncate transition-colors"
                      title={file.file_name}
                    >
                      {file.file_name}
                    </a>
                    {showVersions && file.version > 0 && (
                      <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">
                        v{file.version}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {formatSize(file.file_size)}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] opacity-40">
                      |
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {formatDate(file.created_at)}
                    </span>
                    {file.uploaded_by && (
                      <>
                        <span className="text-[10px] text-[var(--text-muted)] opacity-40">
                          |
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {file.uploaded_by}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {/* Download */}
                  <button
                    type="button"
                    onClick={() => handleDownload(file)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
                    title="다운로드"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>

                  {/* New Version */}
                  {!readOnly && onNewVersion && (
                    <button
                      type="button"
                      onClick={() => onNewVersion(file.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
                      title="새 버전 업로드"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="16 16 12 12 8 16" />
                        <line x1="12" y1="12" x2="12" y2="21" />
                        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                      </svg>
                    </button>
                  )}

                  {/* Delete */}
                  {!readOnly && onDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(file.id)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                        isConfirming
                          ? "text-white bg-[var(--danger)]"
                          : "text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
                      }`}
                      title={isConfirming ? "한 번 더 클릭하면 삭제" : "삭제"}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Grid layout ── */}
      {layout === "grid" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {files.map((file) => {
            const { icon, color, bgColor } = getFileIcon(file.mime_type);
            const isConfirming = confirmDeleteId === file.id;

            return (
              <div
                key={file.id}
                className="relative flex flex-col items-center p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] group hover:border-[var(--primary)]/30 transition-colors"
              >
                {/* Version badge */}
                {showVersions && file.version > 0 && (
                  <span className="absolute top-2 right-2 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">
                    v{file.version}
                  </span>
                )}

                {/* Type icon */}
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold mb-2 ${color} ${bgColor}`}
                >
                  {icon}
                </div>

                {/* File name */}
                <a
                  href={file.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-[var(--text)] hover:text-[var(--primary)] text-center truncate w-full transition-colors"
                  title={file.file_name}
                >
                  {file.file_name}
                </a>

                {/* Meta */}
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {formatSize(file.file_size)}
                </p>
                <p className="text-[9px] text-[var(--text-muted)] opacity-60">
                  {formatDate(file.created_at)}
                </p>

                {/* Hover actions */}
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleDownload(file)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
                    title="다운로드"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>

                  {!readOnly && onNewVersion && (
                    <button
                      type="button"
                      onClick={() => onNewVersion(file.id)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
                      title="새 버전"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="16 16 12 12 8 16" />
                        <line x1="12" y1="12" x2="12" y2="21" />
                        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                      </svg>
                    </button>
                  )}

                  {!readOnly && onDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(file.id)}
                      className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                        isConfirming
                          ? "text-white bg-[var(--danger)]"
                          : "text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
                      }`}
                      title={isConfirming ? "확인 삭제" : "삭제"}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
