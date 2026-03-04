"use client";

import { useState, useRef, useCallback } from "react";

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  maxSize?: number; // MB
}

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

export function FileUploadZone({ onFileSelect, disabled, maxSize = 10 }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): boolean => {
    setError(null);
    if (file.size > maxSize * 1024 * 1024) {
      setError(`파일 크기는 ${maxSize}MB 이하만 가능합니다.`);
      return false;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('지원하지 않는 파일 형식입니다. (이미지, PDF, Word, Excel, CSV)');
      return false;
    }
    return true;
  }, [maxSize]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file && validateFile(file)) onFileSelect(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && validateFile(file)) onFileSelect(file);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <>
      <input ref={inputRef} type="file" className="hidden"
        accept={ALLOWED_TYPES.join(',')}
        onChange={handleFileInput} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        disabled={disabled}
        className={`p-2 rounded-lg transition text-[var(--text-dim)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 disabled:opacity-30 ${
          isDragging ? 'bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]' : ''
        }`}
        title="파일 첨부 (10MB 이하)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      {error && (
        <div className="text-[10px] text-red-400 mt-1">{error}</div>
      )}
    </>
  );
}
