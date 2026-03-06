"use client";

import { useState, useRef, useCallback } from "react";

// ── Types ──
interface FileUploadMultiProps {
  onFilesSelect: (files: File[]) => void;
  disabled?: boolean;
  maxSize?: number; // MB, default 50
  maxFiles?: number; // default 20
  accept?: string; // MIME types comma-separated
  label?: string;
}

// ── Allowed MIME types ──
const DEFAULT_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
];

// ── File type icon & color mapping ──
function getFileIcon(type: string): { icon: string; color: string } {
  if (type.startsWith("image/"))
    return { icon: "IMG", color: "text-purple-500 bg-purple-500/10" };
  if (type === "application/pdf")
    return { icon: "PDF", color: "text-red-500 bg-red-500/10" };
  if (type.includes("word") || type.includes("msword"))
    return { icon: "DOC", color: "text-blue-500 bg-blue-500/10" };
  if (type.includes("excel") || type.includes("spreadsheet"))
    return { icon: "XLS", color: "text-green-500 bg-green-500/10" };
  if (type.includes("powerpoint") || type.includes("presentation"))
    return { icon: "PPT", color: "text-orange-500 bg-orange-500/10" };
  if (type === "text/csv")
    return { icon: "CSV", color: "text-emerald-500 bg-emerald-500/10" };
  if (type === "text/plain")
    return { icon: "TXT", color: "text-gray-500 bg-gray-500/10" };
  if (type.includes("zip"))
    return { icon: "ZIP", color: "text-yellow-500 bg-yellow-500/10" };
  return { icon: "FILE", color: "text-gray-400 bg-gray-400/10" };
}

// ── Format file size ──
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadMulti({
  onFilesSelect,
  disabled = false,
  maxSize = 50,
  maxFiles = 20,
  accept,
  label,
}: FileUploadMultiProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const allowedTypes = accept
    ? accept.split(",").map((t) => t.trim())
    : DEFAULT_ALLOWED_TYPES;

  const acceptString = accept || DEFAULT_ALLOWED_TYPES.join(",");

  // ── Validate a single file ──
  const validateFile = useCallback(
    (file: File, currentCount: number): string | null => {
      if (currentCount >= maxFiles) {
        return `최대 ${maxFiles}개 파일까지 업로드 가능합니다.`;
      }
      if (file.size > maxSize * 1024 * 1024) {
        return `"${file.name}" - 파일 크기가 ${maxSize}MB를 초과합니다. (${formatSize(file.size)})`;
      }
      if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
        return `"${file.name}" - 지원하지 않는 파일 형식입니다. (${file.type || "알 수 없음"})`;
      }
      return null;
    },
    [maxSize, maxFiles, allowedTypes]
  );

  // ── Process incoming files ──
  const processFiles = useCallback(
    (incoming: FileList | File[]) => {
      const newErrors: string[] = [];
      const validFiles: File[] = [];
      const currentCount = selectedFiles.length;

      const fileArray = Array.from(incoming);

      if (currentCount + fileArray.length > maxFiles) {
        newErrors.push(
          `최대 ${maxFiles}개까지 선택 가능합니다. ${fileArray.length}개 중 ${maxFiles - currentCount}개만 추가됩니다.`
        );
      }

      for (const file of fileArray) {
        const error = validateFile(file, currentCount + validFiles.length);
        if (error) {
          newErrors.push(error);
        } else {
          // Prevent duplicates by name + size
          const isDuplicate =
            selectedFiles.some(
              (f) => f.name === file.name && f.size === file.size
            ) ||
            validFiles.some(
              (f) => f.name === file.name && f.size === file.size
            );
          if (isDuplicate) {
            newErrors.push(`"${file.name}" - 이미 선택된 파일입니다.`);
          } else {
            validFiles.push(file);
          }
        }
      }

      setErrors(newErrors);

      if (validFiles.length > 0) {
        const updated = [...selectedFiles, ...validFiles];
        setSelectedFiles(updated);
        onFilesSelect(updated);
      }
    },
    [selectedFiles, maxFiles, validateFile, onFilesSelect]
  );

  // ── Remove a single file ──
  const removeFile = useCallback(
    (index: number) => {
      const updated = selectedFiles.filter((_, i) => i !== index);
      setSelectedFiles(updated);
      onFilesSelect(updated);
      setErrors([]);
    },
    [selectedFiles, onFilesSelect]
  );

  // ── Clear all ──
  const clearAll = useCallback(() => {
    setSelectedFiles([]);
    setErrors([]);
    onFilesSelect([]);
  }, [onFilesSelect]);

  // ── Drag handlers ──
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }

  // ── File input handler ──
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="w-full">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={acceptString}
        onChange={handleFileInput}
        disabled={disabled}
      />

      {/* Drop zone */}
      <button
        type="button"
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={disabled}
        className={`w-full rounded-xl border-2 border-dashed p-6 transition-all text-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          isDragging
            ? "border-[var(--primary)] bg-[var(--primary)]/5 scale-[1.01]"
            : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/3"
        }`}
      >
        {/* Upload icon */}
        <div className="flex flex-col items-center gap-2">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              isDragging
                ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                : "bg-[var(--border)]/50 text-[var(--text-muted)]"
            }`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {label || "파일을 드래그하거나 클릭하여 선택"}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              최대 {maxSize}MB, {maxFiles}개 파일 / 이미지, PDF, Word, Excel,
              PPT, CSV, ZIP, TXT
            </p>
          </div>
        </div>
      </button>

      {/* Error messages */}
      {errors.length > 0 && (
        <div className="mt-2 space-y-1">
          {errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 text-xs text-[var(--danger)]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 mt-0.5"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {/* Selected files list */}
      {selectedFiles.length > 0 && (
        <div className="mt-3">
          {/* Header with count badge + clear all */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--text)]">
                선택된 파일
              </span>
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--primary)] text-white">
                {selectedFiles.length}
              </span>
            </div>
            <button
              type="button"
              onClick={clearAll}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
            >
              전체 삭제
            </button>
          </div>

          {/* File items */}
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {selectedFiles.map((file, index) => {
              const { icon, color } = getFileIcon(file.type);
              return (
                <div
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] group hover:border-[var(--primary)]/30 transition-colors"
                >
                  {/* Type icon */}
                  <div
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold ${color}`}
                  >
                    {icon}
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--text)] truncate">
                      {file.name}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {formatSize(file.size)}
                    </p>
                  </div>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="파일 제거"
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
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
