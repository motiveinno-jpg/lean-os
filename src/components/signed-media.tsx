"use client";

// 저장된 스토리지 URL(public 형태)을 **보이는 순간** 서명 URL 로 바꿔 그리는 공용 부품 (2026-09).
//   board-files / chat-files 버킷이 private 이라 public URL 은 더 이상 열리지 않는다. DB 는 그대로 두고
//   여기서만 바꾼다. 스토리지 URL 이 아닌 값(외부 링크·blob:·data:)은 손대지 않고 그대로 돌려준다.
import { useEffect, useMemo, useRef, useState, type ImgHTMLAttributes, type AnchorHTMLAttributes, type MouseEvent } from "react";
import {
  getCachedSignedUrl, invalidateSignedUrls, openStoredFile, parseStorageUrl,
  signHtmlStorageUrls, signStorageUrls,
} from "@/lib/file-storage";

const KEY_SEP = " ";

/** 여러 URL → { 원본: 서명 } 맵. 아직 서명 전이면 원본을 그대로 돌려준다(캐시에 있으면 첫 렌더부터 서명본). */
export function useSignedUrls(urls: (string | null | undefined)[]): Record<string, string> {
  const key = urls.filter((u): u is string => !!u).join(KEY_SEP);
  const list = useMemo(() => Array.from(new Set(key ? key.split(KEY_SEP) : [])), [key]);
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const need = list.filter((u) => parseStorageUrl(u) && !getCachedSignedUrl(u));
    if (need.length === 0) return;
    let alive = true;
    signStorageUrls(need).then((m) => { if (alive) setMap((prev) => ({ ...prev, ...m })); }).catch(() => {});
    return () => { alive = false; };
  }, [list]);

  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const u of list) out[u] = map[u] ?? getCachedSignedUrl(u) ?? u;
    return out;
  }, [list, map]);
}

/** URL 하나 → 서명 URL (서명 전·비스토리지 URL 이면 원본, 빈 값이면 null). */
export function useSignedUrl(url?: string | null): string | null {
  const map = useSignedUrls([url]);
  if (!url) return null;
  return map[url] ?? url;
}

/** 본문 HTML 안의 스토리지 src/href 를 서명 URL 로 바꾼 HTML. 바꾸는 동안엔 원본 HTML 을 돌려준다. */
export function useSignedHtml(html: string): string {
  const [state, setState] = useState<{ src: string; out: string } | null>(null);
  useEffect(() => {
    if (!html || !html.includes("/storage/v1/object/")) return;
    let alive = true;
    signHtmlStorageUrls(html).then((out) => { if (alive) setState({ src: html, out }); }).catch(() => {});
    return () => { alive = false; };
  }, [html]);
  return state && state.src === html ? state.out : html;
}



/** dangerouslySetInnerHTML 자리에 그대로 쓰는 본문 부품 · 목록 안(map)에서도 훅 없이 쓸 수 있게 감쌌다.
 *  html 은 **이미 sanitize 된** 것을 넘긴다. */
export function SignedHtml({ html, className }: { html: string; className?: string }) {
  const signed = useSignedHtml(html);
  return <div className={className} dangerouslySetInnerHTML={{ __html: signed }} />;
}

type SignedImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src?: string | null };

/** <img> 대체 — src 를 서명 URL 로 바꿔 그린다. 오래 열어둔 화면(채팅 팝업)에서 서명이 만료돼 깨지면 한 번 다시 서명한다.
 *  private 버킷의 public URL 을 그대로 요청해 깨진 그림이 잠깐 비치지 않도록, 서명 전에는 src 를 비워 둔다. */
export function SignedImg({ src, onError, alt, ...rest }: SignedImgProps) {
  const signed = useSignedUrl(src);
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const retried = useRef(false);
  useEffect(() => { retried.current = false; setRefreshed(null); }, [src]);

  const isStorage = !!src && !!parseStorageUrl(src);
  const resolved = refreshed ?? signed;
  const pending = isStorage && resolved === src;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      alt={alt}
      src={pending ? undefined : (resolved ?? undefined)}
      onError={(e) => {
        if (isStorage && !pending && !retried.current && src) {
          retried.current = true;
          invalidateSignedUrls([src]);
          signStorageUrls([src]).then((m) => { if (m[src] && m[src] !== src) setRefreshed(m[src]); }).catch(() => {});
        }
        onError?.(e);
      }}
    />
  );
}

type SignedLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href?: string | null; downloadName?: string };

/** <a href> 대체 — 서명 URL 을 href 에 싣고, 아직 서명 전이면 클릭 때 서명해서 새 탭으로 연다. */
export function SignedLink({ href, downloadName, onClick, children, ...rest }: SignedLinkProps) {
  const signed = useSignedUrl(href);
  const isStorage = !!href && !!parseStorageUrl(href);
  const pending = isStorage && signed === href;
  return (
    <a
      {...rest}
      href={signed ?? undefined}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (pending) {
          e.preventDefault();
          void openStoredFile(href, downloadName);
        }
      }}
    >
      {children}
    </a>
  );
}
