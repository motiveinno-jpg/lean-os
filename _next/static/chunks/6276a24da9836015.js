(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,33525,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"warnOnce",{enumerable:!0,get:function(){return n}});let n=e=>{}},98183,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var n={assign:function(){return a},searchParamsToUrlQuery:function(){return i},urlQueryToSearchParams:function(){return s}};for(var o in n)Object.defineProperty(r,o,{enumerable:!0,get:n[o]});function i(e){let t={};for(let[r,n]of e.entries()){let e=t[r];void 0===e?t[r]=n:Array.isArray(e)?e.push(n):t[r]=[e,n]}return t}function l(e){return"string"==typeof e?e:("number"!=typeof e||isNaN(e))&&"boolean"!=typeof e?"":String(e)}function s(e){let t=new URLSearchParams;for(let[r,n]of Object.entries(e))if(Array.isArray(n))for(let e of n)t.append(r,l(e));else t.set(r,l(n));return t}function a(e,...t){for(let r of t){for(let t of r.keys())e.delete(t);for(let[t,n]of r.entries())e.append(t,n)}return e}},95057,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var n={formatUrl:function(){return s},formatWithValidation:function(){return c},urlObjectKeys:function(){return a}};for(var o in n)Object.defineProperty(r,o,{enumerable:!0,get:n[o]});let i=e.r(90809)._(e.r(98183)),l=/https?|ftp|gopher|file/;function s(e){let{auth:t,hostname:r}=e,n=e.protocol||"",o=e.pathname||"",s=e.hash||"",a=e.query||"",c=!1;t=t?encodeURIComponent(t).replace(/%3A/i,":")+"@":"",e.host?c=t+e.host:r&&(c=t+(~r.indexOf(":")?`[${r}]`:r),e.port&&(c+=":"+e.port)),a&&"object"==typeof a&&(a=String(i.urlQueryToSearchParams(a)));let u=e.search||a&&`?${a}`||"";return n&&!n.endsWith(":")&&(n+=":"),e.slashes||(!n||l.test(n))&&!1!==c?(c="//"+(c||""),o&&"/"!==o[0]&&(o="/"+o)):c||(c=""),s&&"#"!==s[0]&&(s="#"+s),u&&"?"!==u[0]&&(u="?"+u),o=o.replace(/[?#]/g,encodeURIComponent),u=u.replace("#","%23"),`${n}${c}${o}${u}${s}`}let a=["auth","hash","host","hostname","href","path","pathname","port","protocol","query","search","slashes"];function c(e){return s(e)}},18581,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"useMergedRef",{enumerable:!0,get:function(){return o}});let n=e.r(71645);function o(e,t){let r=(0,n.useRef)(null),o=(0,n.useRef)(null);return(0,n.useCallback)(n=>{if(null===n){let e=r.current;e&&(r.current=null,e());let t=o.current;t&&(o.current=null,t())}else e&&(r.current=i(e,n)),t&&(o.current=i(t,n))},[e,t])}function i(e,t){if("function"!=typeof e)return e.current=t,()=>{e.current=null};{let r=e(t);return"function"==typeof r?r:()=>e(null)}}("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},18967,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var n={DecodeError:function(){return y},MiddlewareNotFoundError:function(){return v},MissingStaticPage:function(){return j},NormalizeError:function(){return b},PageNotFoundError:function(){return g},SP:function(){return m},ST:function(){return x},WEB_VITALS:function(){return i},execOnce:function(){return l},getDisplayName:function(){return f},getLocationOrigin:function(){return c},getURL:function(){return u},isAbsoluteUrl:function(){return a},isResSent:function(){return d},loadGetInitialProps:function(){return h},normalizeRepeatedSlashes:function(){return p},stringifyError:function(){return w}};for(var o in n)Object.defineProperty(r,o,{enumerable:!0,get:n[o]});let i=["CLS","FCP","FID","INP","LCP","TTFB"];function l(e){let t,r=!1;return(...n)=>(r||(r=!0,t=e(...n)),t)}let s=/^[a-zA-Z][a-zA-Z\d+\-.]*?:/,a=e=>s.test(e);function c(){let{protocol:e,hostname:t,port:r}=window.location;return`${e}//${t}${r?":"+r:""}`}function u(){let{href:e}=window.location,t=c();return e.substring(t.length)}function f(e){return"string"==typeof e?e:e.displayName||e.name||"Unknown"}function d(e){return e.finished||e.headersSent}function p(e){let t=e.split("?");return t[0].replace(/\\/g,"/").replace(/\/\/+/g,"/")+(t[1]?`?${t.slice(1).join("?")}`:"")}async function h(e,t){let r=t.res||t.ctx&&t.ctx.res;if(!e.getInitialProps)return t.ctx&&t.Component?{pageProps:await h(t.Component,t.ctx)}:{};let n=await e.getInitialProps(t);if(r&&d(r))return n;if(!n)throw Object.defineProperty(Error(`"${f(e)}.getInitialProps()" should resolve to an object. But found "${n}" instead.`),"__NEXT_ERROR_CODE",{value:"E394",enumerable:!1,configurable:!0});return n}let m="u">typeof performance,x=m&&["mark","measure","getEntriesByName"].every(e=>"function"==typeof performance[e]);class y extends Error{}class b extends Error{}class g extends Error{constructor(e){super(),this.code="ENOENT",this.name="PageNotFoundError",this.message=`Cannot find module for page: ${e}`}}class j extends Error{constructor(e,t){super(),this.message=`Failed to load static file for page: ${e} ${t}`}}class v extends Error{constructor(){super(),this.code="ENOENT",this.message="Cannot find the middleware module"}}function w(e){return JSON.stringify({message:e.message,stack:e.stack})}},73668,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"isLocalURL",{enumerable:!0,get:function(){return i}});let n=e.r(18967),o=e.r(52817);function i(e){if(!(0,n.isAbsoluteUrl)(e))return!0;try{let t=(0,n.getLocationOrigin)(),r=new URL(e,t);return r.origin===t&&(0,o.hasBasePath)(r.pathname)}catch(e){return!1}}},84508,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),Object.defineProperty(r,"errorOnce",{enumerable:!0,get:function(){return n}});let n=e=>{}},22016,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0});var n={default:function(){return y},useLinkStatus:function(){return g}};for(var o in n)Object.defineProperty(r,o,{enumerable:!0,get:n[o]});let i=e.r(90809),l=e.r(43476),s=i._(e.r(71645)),a=e.r(95057),c=e.r(8372),u=e.r(18581),f=e.r(18967),d=e.r(5550);e.r(33525);let p=e.r(91949),h=e.r(73668),m=e.r(9396);function x(e){return"string"==typeof e?e:(0,a.formatUrl)(e)}function y(t){var r;let n,o,i,[a,y]=(0,s.useOptimistic)(p.IDLE_LINK_STATUS),g=(0,s.useRef)(null),{href:j,as:v,children:w,prefetch:N=null,passHref:P,replace:S,shallow:O,scroll:E,onClick:_,onMouseEnter:k,onTouchStart:C,legacyBehavior:T=!1,onNavigate:L,ref:R,unstable_dynamicOnHover:A,...I}=t;n=w,T&&("string"==typeof n||"number"==typeof n)&&(n=(0,l.jsx)("a",{children:n}));let M=s.default.useContext(c.AppRouterContext),U=!1!==N,$=!1!==N?null===(r=N)||"auto"===r?m.FetchStrategy.PPR:m.FetchStrategy.Full:m.FetchStrategy.PPR,{href:B,as:F}=s.default.useMemo(()=>{let e=x(j);return{href:e,as:v?x(v):e}},[j,v]);if(T){if(n?.$$typeof===Symbol.for("react.lazy"))throw Object.defineProperty(Error("`<Link legacyBehavior>` received a direct child that is either a Server Component, or JSX that was loaded with React.lazy(). This is not supported. Either remove legacyBehavior, or make the direct child a Client Component that renders the Link's `<a>` tag."),"__NEXT_ERROR_CODE",{value:"E863",enumerable:!1,configurable:!0});o=s.default.Children.only(n)}let D=T?o&&"object"==typeof o&&o.ref:R,K=s.default.useCallback(e=>(null!==M&&(g.current=(0,p.mountLinkInstance)(e,B,M,$,U,y)),()=>{g.current&&((0,p.unmountLinkForCurrentNavigation)(g.current),g.current=null),(0,p.unmountPrefetchableInstance)(e)}),[U,B,M,$,y]),z={ref:(0,u.useMergedRef)(K,D),onClick(t){T||"function"!=typeof _||_(t),T&&o.props&&"function"==typeof o.props.onClick&&o.props.onClick(t),!M||t.defaultPrevented||function(t,r,n,o,i,l,a){if("u">typeof window){let c,{nodeName:u}=t.currentTarget;if("A"===u.toUpperCase()&&((c=t.currentTarget.getAttribute("target"))&&"_self"!==c||t.metaKey||t.ctrlKey||t.shiftKey||t.altKey||t.nativeEvent&&2===t.nativeEvent.which)||t.currentTarget.hasAttribute("download"))return;if(!(0,h.isLocalURL)(r)){i&&(t.preventDefault(),location.replace(r));return}if(t.preventDefault(),a){let e=!1;if(a({preventDefault:()=>{e=!0}}),e)return}let{dispatchNavigateAction:f}=e.r(99781);s.default.startTransition(()=>{f(n||r,i?"replace":"push",l??!0,o.current)})}}(t,B,F,g,S,E,L)},onMouseEnter(e){T||"function"!=typeof k||k(e),T&&o.props&&"function"==typeof o.props.onMouseEnter&&o.props.onMouseEnter(e),M&&U&&(0,p.onNavigationIntent)(e.currentTarget,!0===A)},onTouchStart:function(e){T||"function"!=typeof C||C(e),T&&o.props&&"function"==typeof o.props.onTouchStart&&o.props.onTouchStart(e),M&&U&&(0,p.onNavigationIntent)(e.currentTarget,!0===A)}};return(0,f.isAbsoluteUrl)(F)?z.href=F:T&&!P&&("a"!==o.type||"href"in o.props)||(z.href=(0,d.addBasePath)(F)),i=T?s.default.cloneElement(o,z):(0,l.jsx)("a",{...I,...z,children:n}),(0,l.jsx)(b.Provider,{value:a,children:i})}e.r(84508);let b=(0,s.createContext)(p.IDLE_LINK_STATUS),g=()=>(0,s.useContext)(b);("function"==typeof r.default||"object"==typeof r.default&&null!==r.default)&&void 0===r.default.__esModule&&(Object.defineProperty(r.default,"__esModule",{value:!0}),Object.assign(r.default,r),t.exports=r.default)},98115,e=>{"use strict";var t=e.i(43476),r=e.i(71645);function n({size:e=28,className:r=""}){return(0,t.jsxs)("svg",{width:e,height:e,viewBox:"0 0 40 40",fill:"none",className:`shrink-0 ${r}`,children:[(0,t.jsx)("rect",{width:"40",height:"40",rx:"10",fill:"#111"}),(0,t.jsx)("circle",{cx:"18",cy:"17",r:"9",stroke:"#fff",strokeWidth:"2.2",fill:"none"}),(0,t.jsx)("line",{x1:"24.5",y1:"23.5",x2:"32",y2:"31",stroke:"#fff",strokeWidth:"2.8",strokeLinecap:"round"}),(0,t.jsx)("polyline",{points:"12,20 15,18 18,19 22,14",stroke:"#3b82f6",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round",fill:"none"}),(0,t.jsx)("circle",{cx:"22",cy:"14",r:"1.5",fill:"#3b82f6"})]})}function o({className:e="",interval:n=2e3}){let[o,i]=(0,r.useState)(!1);return(0,r.useEffect)(()=>{let e=setInterval(()=>i(e=>!e),n);return()=>clearInterval(e)},[n]),(0,t.jsxs)("span",{className:`relative inline-flex overflow-hidden ${e}`,style:{height:"1.25em",minWidth:"5.5em"},children:[(0,t.jsx)("span",{className:"absolute left-0 transition-all duration-500 ease-in-out whitespace-nowrap",style:{transform:o?"translateY(-100%)":"translateY(0)",opacity:+!o},children:"OwnerView"}),(0,t.jsx)("span",{className:"absolute left-0 transition-all duration-500 ease-in-out whitespace-nowrap",style:{transform:o?"translateY(0)":"translateY(100%)",opacity:+!!o},children:"오너뷰"})]})}e.s(["OwnerViewIcon",()=>n,"RollingBrandText",()=>o])},7528,e=>{"use strict";var t=e.i(43476),r=e.i(22016),n=e.i(98115);let o=[{id:"1",title:"제1조 (개인정보의 수집 항목 및 수집 방법)",content:`(주)모티브이노베이션(이하 "회사")은 OwnerView 서비스(이하 "서비스") 제공을 위해 다음과 같은 개인정보를 수집합니다.

[필수 수집 항목]
1. 회원가입 시: 회사명, 사업자등록번호, 대표자명, 이메일 주소, 연락처, 비밀번호
2. 직원 등록 시: 성명, 이메일, 직급, 부서, 입사일, 연락처
3. 급여 관리 시: 주민등록번호(또는 외국인등록번호), 계좌번호, 급여 정보, 4대보험 관련 정보
4. 결제 시: 신용카드 정보, 결제 이력, 청구지 주소

[선택 수집 항목]
1. 회사 로고, 프로필 사진
2. 거래처/파트너 정보
3. 사업 관련 문서 (계약서, 견적서 등)

[자동 수집 항목]
1. 서비스 이용 기록, 접속 로그, IP 주소, 브라우저 유형, 운영체제
2. 쿠키, 세션 정보
3. 기기 정보 (디바이스 유형, 화면 해상도)
4. 서비스 내 행동 데이터 (클릭, 페이지 뷰, 기능 사용 빈도)

[수집 방법]
- 회원가입 및 서비스 이용 과정에서 이용자가 직접 입력
- 서비스 이용 과정에서 자동으로 생성 및 수집
- 제휴 서비스로부터 제공받는 정보`},{id:"2",title:"제2조 (개인정보의 수집 및 이용 목적)",content:`회사는 수집한 개인정보를 다음의 목적을 위해 이용합니다.

1. 서비스 제공 및 운영
  - 회원 식별 및 인증, 서비스 이용 권한 관리
  - 회계, 급여, 계약, 프로젝트 등 핵심 기능 제공
  - AI 기반 분석, 예측, 자동 분류 기능 제공

2. 서비스 개선 및 개발
  - 서비스 이용 통계 분석 및 품질 향상
  - 신규 기능 개발 및 기존 기능 개선
  - 비식별화/집계 데이터를 활용한 연구 및 분석

3. 고객 지원
  - 문의 사항 처리 및 고객 상담
  - 공지사항, 서비스 변경 안내
  - 장애 대응 및 분쟁 해결

4. 법적 의무 이행
  - 관련 법령에 따른 기록 보존
  - 세무, 회계 관련 법적 의무 이행

5. 마케팅 및 광고 (선택 동의 시)
  - 서비스 관련 정보 제공, 이벤트 안내
  - 맞춤형 서비스 제공`},{id:"3",title:"제3조 (개인정보의 제3자 제공)",content:`회사는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우에는 예외로 합니다.

1. 이용자가 사전에 동의한 경우

2. 서비스 제공을 위한 필수 제3자 제공
  가. Supabase Inc. — 데이터 호스팅 및 인프라 제공 (미국 소재 서버)
     - 제공 항목: 서비스 데이터 전반
     - 보유 기간: 서비스 이용 기간
  나. (주)비바리퍼블리카(토스페이먼츠) — 결제 처리
     - 제공 항목: 결제 관련 정보
     - 보유 기간: 결제 완료 후 5년 (전자상거래법)
  다. Stripe, Inc. — 해외 결제 처리
     - 제공 항목: 결제 관련 정보
     - 보유 기간: 결제 완료 후 5년

3. 법률에 특별한 규정이 있는 경우
  - 수사 기관의 적법한 요청이 있는 경우
  - 법원의 명령 또는 판결이 있는 경우
  - 관련 법률에 의한 행정기관의 요구가 있는 경우`},{id:"4",title:"제4조 (개인정보의 보유 및 이용 기간)",content:`1. 회사는 회원 탈퇴 시 또는 개인정보 수집 및 이용 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다.

2. 다만, 다음의 정보에 대해서는 관련 법령에 따라 아래 기간 동안 보존합니다.

  가. 전자상거래 등에서의 소비자 보호에 관한 법률
    - 계약 또는 청약철회 등에 관한 기록: 5년
    - 대금결제 및 재화 등의 공급에 관한 기록: 5년
    - 소비자의 불만 또는 분쟁처리에 관한 기록: 3년

  나. 통신비밀보호법
    - 서비스 이용 관련 기록: 3개월

  다. 국세기본법, 법인세법
    - 세무 관련 장부 및 증빙서류: 5년

  라. 근로기준법
    - 근로자 명부 및 근로계약서: 3년
    - 임금 대장 및 임금의 결정/지급 방법에 관한 서류: 3년

3. 서비스 해지 후에도 위 법률에 따른 보존 의무가 있는 정보는 분리 보관하여 해당 기간 동안 보존합니다.
4. 보존 기간 경과 후에는 지체 없이 파기합니다.`},{id:"5",title:"제5조 (개인정보의 파기 절차 및 방법)",content:`1. 파기 절차: 회사는 파기 사유가 발생한 개인정보를 선정하고, 개인정보 보호책임자의 승인을 받아 개인정보를 파기합니다.

2. 파기 방법
  가. 전자적 파일: 기술적 방법을 사용하여 복원이 불가능하도록 영구 삭제
  나. 종이 문서: 분쇄기로 분쇄 또는 소각

3. 보유 기간이 경과한 개인정보는 경과한 날로부터 5일 이내에, 개인정보 처리 목적 달성 등 처리가 불필요하게 된 경우에는 그 사유가 발생한 날로부터 5일 이내에 파기합니다.`},{id:"6",title:"제6조 (개인정보의 안전성 확보 조치)",content:`회사는 개인정보의 안전성 확보를 위해 다음과 같은 기술적/관리적/물리적 조치를 취하고 있습니다.

1. 기술적 조치
  가. AES-256 암호화: 비밀번호, 주민등록번호, 금융정보 등 민감정보 암호화 저장
  나. SSL/TLS 통신 암호화: 모든 데이터 전송 시 암호화 적용
  다. 역할 기반 접근 제어(RBAC): 사용자 역할에 따른 데이터 접근 권한 제한
  라. 감사 로그(Audit Log): 모든 데이터 접근 및 변경 이력 기록
  마. 자동 세션 만료 및 2단계 인증 지원
  바. 정기적 보안 취약점 점검 및 패치

2. 관리적 조치
  가. 개인정보 취급 직원의 최소화 및 보안 교육
  나. 내부 개인정보 관리 계획 수립 및 시행
  다. 개인정보 처리 시스템 접근 권한 관리

3. 인프라 보안
  가. SOC2 인증 인프라(Supabase) 사용
  나. Row Level Security(RLS) 정책 적용으로 테넌트 간 데이터 격리
  다. 정기적 데이터 백업 및 재해 복구 체계 운영`},{id:"7",title:"제7조 (정보주체의 권리 및 행사 방법)",content:`1. 이용자(정보주체)는 다음과 같은 개인정보 보호 관련 권리를 행사할 수 있습니다.
  가. 개인정보 열람 요구
  나. 오류 등이 있을 경우 정정 요구
  다. 삭제 요구
  라. 처리정지 요구

2. 권리 행사는 서비스 내 설정 페이지 또는 개인정보 보호책임자에게 이메일(ceo@motiveinno.com)로 요청할 수 있으며, 회사는 이에 대해 지체 없이(최대 10일 이내) 조치합니다.

3. 이용자가 개인정보의 오류에 대한 정정을 요구한 경우, 회사는 정정이 완료되기 전까지 해당 개인정보를 이용 또는 제공하지 않습니다.

4. 권리 행사는 이용자의 법정대리인이나 위임을 받은 자 등 대리인을 통하여 할 수 있으며, 이 경우 개인정보 보호법 시행규칙에 따른 위임장을 제출하여야 합니다.

5. 관련 법령에 따라 보존이 의무화된 개인정보의 경우 삭제 또는 처리정지 요구가 제한될 수 있습니다.`},{id:"8",title:"제8조 (쿠키의 사용)",content:`1. 회사는 이용자에게 개인화된 서비스를 제공하기 위해 쿠키(Cookie)를 사용합니다.

2. 쿠키 사용 목적
  가. 로그인 상태 유지 및 세션 관리
  나. 이용자의 서비스 환경설정 저장
  다. 서비스 이용 통계 분석 및 UX 개선

3. 이용자는 웹 브라우저 설정을 통해 쿠키의 저장을 거부하거나, 쿠키가 저장될 때마다 확인을 받도록 설정할 수 있습니다. 다만, 쿠키 저장을 거부하는 경우 일부 서비스 이용에 제한이 있을 수 있습니다.

4. 회사는 Google Analytics 등 외부 분석 도구를 사용할 수 있으며, 이를 통해 수집되는 정보는 비식별화된 이용 통계 목적으로만 활용됩니다.`},{id:"9",title:"제9조 (개인정보의 국외 이전)",content:`회사는 서비스 제공을 위하여 다음과 같이 개인정보를 국외로 이전합니다.

1. 이전받는 자: Supabase Inc.
  - 이전되는 국가: 미국
  - 이전 목적: 클라우드 데이터베이스 호스팅 및 서비스 인프라 운영
  - 이전 항목: 서비스 이용 과정에서 생성되는 모든 데이터
  - 보유 기간: 서비스 이용 기간 및 법령에 따른 보존 기간
  - 안전조치: SOC2 인증, AES-256 암호화, RLS 정책 적용

2. 이전받는 자: Stripe, Inc.
  - 이전되는 국가: 미국
  - 이전 목적: 해외 결제 처리
  - 이전 항목: 결제 관련 정보
  - 보유 기간: 결제 완료 후 관련 법령에 따른 보존 기간
  - 안전조치: PCI DSS Level 1 인증

3. 회사는 개인정보의 국외 이전에 대하여 개인정보 보호법 제28조의8에 따라 보호조치를 시행합니다.`},{id:"10",title:"제10조 (개인정보 유출 시 대응)",content:`1. 회사는 개인정보 유출 사고 발생 시 다음과 같이 조치합니다.

  가. 유출 사실 인지 후 72시간 이내에 이용자에게 통지
  나. 통지 내용: 유출된 개인정보 항목, 유출 시점 및 경위, 피해 최소화를 위한 조치, 이용자의 대응 방법, 담당 부서 및 연락처
  다. 개인정보보호위원회(또는 한국인터넷진흥원)에 신고

2. 1,000명 이상의 정보주체에 관한 개인정보가 유출된 경우에는 통지와 함께 개인정보보호위원회에 신고합니다.

3. 회사는 유출 피해 최소화를 위한 기술적 조치(비밀번호 초기화, 접근 차단 등)를 즉시 시행합니다.`},{id:"11",title:"제11조 (개인정보 보호책임자)",content:`회사는 개인정보 처리에 관한 업무를 총괄하는 개인정보 보호책임자를 다음과 같이 지정합니다.

[개인정보 보호책임자]
- 성명: 채희웅
- 직위: 대표이사
- 연락처: ceo@motiveinno.com

이용자는 서비스 이용 과정에서 발생하는 모든 개인정보 보호 관련 문의, 불만 처리, 피해 구제 등에 관한 사항을 개인정보 보호책임자에게 문의할 수 있습니다.

[권익침해 구제 기관]
- 개인정보침해신고센터: (국번없이) 118 / privacy.kisa.or.kr
- 개인정보분쟁조정위원회: 1833-6972 / kopico.go.kr
- 대검찰청 사이버수사과: (국번없이) 1301 / spo.go.kr
- 경찰청 사이버수사국: (국번없이) 182 / police.go.kr`},{id:"12",title:"제12조 (방침의 변경)",content:`1. 본 개인정보처리방침은 관련 법령 및 회사 내부 정책에 따라 변경될 수 있습니다.
2. 변경 시에는 시행일자 7일 전부터 서비스 내 공지사항 또는 이메일을 통해 고지합니다.
3. 중요한 변경(수집 항목 추가, 이용 목적 변경, 제3자 제공 대상 추가 등)의 경우에는 시행일자 30일 전에 고지하며, 필요한 경우 별도의 동의를 받습니다.`}];function i(){return(0,t.jsxs)("div",{className:"min-h-screen bg-[#0A0E1A] text-white",children:[(0,t.jsx)("nav",{className:"sticky top-0 w-full bg-[#0A0E1A]/80 backdrop-blur-xl border-b border-white/5 z-50",children:(0,t.jsxs)("div",{className:"max-w-4xl mx-auto px-6 py-3.5 flex items-center justify-between",children:[(0,t.jsxs)(r.default,{href:"/",className:"flex items-center gap-2.5",children:[(0,t.jsx)("div",{className:"w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm bg-blue-600",children:"L"}),(0,t.jsx)("span",{className:"text-lg font-bold text-white",children:(0,t.jsx)(n.RollingBrandText,{})})]}),(0,t.jsx)(r.default,{href:"/",className:"px-4 py-2 text-sm text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition",children:"홈으로"})]})}),(0,t.jsxs)("main",{className:"max-w-4xl mx-auto px-6 py-16",children:[(0,t.jsxs)("div",{className:"mb-12",children:[(0,t.jsx)("h1",{className:"text-3xl md:text-4xl font-bold mb-3",children:"개인정보처리방침"}),(0,t.jsx)("p",{className:"text-slate-400 text-sm",children:"최종 수정일: 2026년 3월 5일 | 시행일: 2026년 3월 5일"})]}),(0,t.jsx)("div",{className:"p-5 rounded-xl bg-blue-500/5 border border-blue-500/10 mb-10 text-sm text-slate-300 leading-7",children:(0,t.jsx)("p",{children:'(주)모티브이노베이션(이하 "회사")은 개인정보 보호법 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립/공개합니다.'})}),(0,t.jsx)("div",{className:"space-y-10",children:o.map(e=>(0,t.jsxs)("section",{className:"scroll-mt-20",children:[(0,t.jsx)("h2",{className:"text-lg font-semibold text-white mb-3",children:e.title}),(0,t.jsx)("div",{className:"text-slate-300 text-sm leading-7 whitespace-pre-line",children:e.content})]},e.id))}),(0,t.jsxs)("div",{className:"mt-16 p-6 rounded-xl bg-white/[0.03] border border-white/5 text-sm text-slate-400 space-y-1",children:[(0,t.jsx)("p",{className:"font-semibold text-slate-300",children:"(주)모티브이노베이션"}),(0,t.jsx)("p",{children:"대표: 채희웅"}),(0,t.jsx)("p",{children:"소재지: 서울특별시 성동구"}),(0,t.jsx)("p",{children:"이메일: ceo@motiveinno.com"})]})]}),(0,t.jsx)("footer",{className:"py-10 px-6 bg-[#060810] text-slate-500 border-t border-white/5",children:(0,t.jsx)("div",{className:"max-w-4xl mx-auto",children:(0,t.jsxs)("div",{className:"flex flex-col md:flex-row items-center justify-between gap-4 text-xs",children:[(0,t.jsx)("div",{children:"(주)모티브이노베이션 | 대표 채희웅 | 서울특별시 성동구"}),(0,t.jsxs)("div",{className:"flex gap-4",children:[(0,t.jsx)(r.default,{href:"/terms",className:"hover:text-white transition",children:"이용약관"}),(0,t.jsx)("span",{className:"text-white font-semibold",children:"개인정보처리방침"}),(0,t.jsx)(r.default,{href:"/refund",className:"hover:text-white transition",children:"환불규정"}),(0,t.jsx)("a",{href:"mailto:ceo@motiveinno.com",className:"hover:text-white transition",children:"ceo@motiveinno.com"})]})]})})})]})}e.s(["default",()=>i])}]);