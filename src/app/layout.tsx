import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "OwnerView — 회사 운영 현황을 자동으로 정리해 한눈에 보여줍니다",
  description: "매출·계약·자금·업무 — 대표를 위한 회사 상황판 OS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
        {/* Copy protection + anti-scraping */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  // 우클릭 방지
  document.addEventListener('contextmenu',function(e){e.preventDefault();});
  // 텍스트 선택 방지 (input/textarea 제외)
  document.addEventListener('selectstart',function(e){
    var t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
    e.preventDefault();
  });
  // 단축키 방지 (Ctrl+U, Ctrl+S, Ctrl+Shift+I, Ctrl+Shift+J, F12)
  document.addEventListener('keydown',function(e){
    if(e.key==='F12')e.preventDefault();
    if(e.ctrlKey&&e.shiftKey&&(e.key==='I'||e.key==='J'||e.key==='C'))e.preventDefault();
    if(e.ctrlKey&&(e.key==='u'||e.key==='U'||e.key==='s'||e.key==='S'))e.preventDefault();
  });
  // DevTools 감지
  var dt=new Image();Object.defineProperty(dt,'id',{get:function(){
    document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f5f5f5"><div style="text-align:center;padding:40px"><h1 style="font-size:24px;color:#333">OwnerView</h1><p style="color:#666;margin-top:8px">개발자 도구 사용이 감지되었습니다.</p></div></div>';
  }});
  // 드래그 방지
  document.addEventListener('dragstart',function(e){e.preventDefault();});
  // 복사 방지
  document.addEventListener('copy',function(e){e.preventDefault();});
  // 인쇄 방지
  window.addEventListener('beforeprint',function(){document.body.style.display='none';});
  window.addEventListener('afterprint',function(){document.body.style.display='';});
})();
            `,
          }}
        />
      </body>
    </html>
  );
}
