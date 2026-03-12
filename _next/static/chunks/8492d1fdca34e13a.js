(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,64130,e=>{"use strict";var t=e.i(7471),a=e.i(94008);let n=t.supabase,i=[{value:"pending",label:"대기",bg:"bg-gray-500/10",text:"text-gray-500",dot:"bg-gray-400"},{value:"sent",label:"발송",bg:"bg-blue-500/10",text:"text-blue-500",dot:"bg-blue-400"},{value:"viewed",label:"열람",bg:"bg-yellow-500/10",text:"text-yellow-600",dot:"bg-yellow-400"},{value:"signed",label:"서명완료",bg:"bg-green-500/10",text:"text-green-600",dot:"bg-green-500"},{value:"rejected",label:"거부",bg:"bg-red-500/10",text:"text-red-500",dot:"bg-red-400"},{value:"expired",label:"만료",bg:"bg-gray-500/10",text:"text-gray-400",dot:"bg-gray-300"}];function r(e){return i.find(t=>t.value===e)||i[0]}function s(){let e="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",t="",a=new Uint8Array(48);for(let n of(crypto.getRandomValues(a),a))t+=e[n%e.length];return t}async function o(e){let t=new Date;t.setDate(t.getDate()+14);let i=s(),{data:r,error:o}=await n.from("signature_requests").insert({company_id:e.companyId,document_id:e.documentId,title:e.title,status:"pending",signer_name:e.signerName,signer_email:e.signerEmail,signer_phone:e.signerPhone||null,sign_token:i,expires_at:t.toISOString(),created_by:e.createdBy}).select().single();if(o)throw o;return await (0,a.logAudit)({company_id:e.companyId,user_id:e.createdBy,action:"create",entity_type:"signature",entity_id:r.id,entity_name:e.title,metadata:{signer_name:e.signerName,signer_email:e.signerEmail,document_id:e.documentId}}),r}async function l(e){let t=await y(e);if(!t)return{success:!1,error:"서명 요청을 찾을 수 없습니다."};let a=window.location.origin,i=`${a}/sign?token=${t.sign_token}`;try{let{data:a,error:r}=await n.functions.invoke("send-signature-email",{body:{to:t.signer_email,signerName:t.signer_name,title:t.title,signUrl:i,expiresAt:t.expires_at}});if(r)throw r;return await u(e,"sent"),{success:!0}}catch(t){return await u(e,"sent"),{success:!1,error:`이메일 발송 실패 (서명 링크는 생성됨): ${t.message}`}}}async function d(e,t){let a=n.from("signature_requests").select("*, documents(name, status)").eq("company_id",e).order("created_at",{ascending:!1});t&&(a=a.eq("status",t));let{data:i,error:r}=await a;if(r)throw r;return i||[]}async function c(e){let{data:t,error:a}=await n.from("signature_requests").select("*").eq("document_id",e).order("created_at",{ascending:!1});if(a)throw a;return t||[]}async function u(e,t,a){let i={status:t,...a};"sent"===t?i.sent_at=new Date().toISOString():"viewed"===t?i.viewed_at=new Date().toISOString():"signed"===t&&(i.signed_at=new Date().toISOString());let{data:r,error:s}=await n.from("signature_requests").update(i).eq("id",e).select().single();if(s)throw s;return r}async function p(t,i,r){let{data:s,error:o}=await n.from("signature_requests").update({status:"signed",signed_at:new Date().toISOString(),signature_data:i,ip_address:r||null}).eq("id",t).select().single();if(o)throw o;if(await (0,a.logAudit)({company_id:s?.company_id||"",user_id:"signer",action:"sign",entity_type:"signature",entity_id:t,entity_name:s?.title,metadata:{signature_type:i.type,document_id:s?.document_id},ip_address:r}),s?.document_id){let{data:t}=await n.from("signature_requests").select("id, status").eq("document_id",s.document_id);if((t||[]).length>0&&(t||[]).every(e=>"signed"===e.status)){let{data:t}=await n.from("documents").select("id, status, company_id, deal_id").eq("id",s.document_id).single();if(t){if("approved"!==t.status&&"locked"!==t.status){let{approveDocument:a}=await e.A(90726);await a(t.id,"system","전체 서명 완료로 자동 승인")}let{lockDocument:a}=await e.A(90726);await a(t.id,"system")}}}return s}async function m(e){let{data:t,error:a}=await n.from("signature_requests").update({status:"expired"}).eq("id",e).select().single();if(a)throw a;return t}async function g(e){let{documentId:t,companyId:a,appliedBy:i}=e,{data:r}=await n.from("companies").select("id, name, seal_url").eq("id",a).single();if(!r?.seal_url)throw Error("직인 이미지가 등록되지 않았습니다. 설정에서 직인을 먼저 업로드하세요.");return await n.from("documents").update({seal_applied:!0}).eq("id",t),await n.from("signature_requests").insert({company_id:a,document_id:t,title:"회사 직인 적용",status:"signed",signer_name:r.name||"회사 직인",signer_email:"seal@company",sign_token:s(),expires_at:new Date(Date.now()+31536e6).toISOString(),signed_at:new Date().toISOString(),signature_data:{type:"seal",data:r.seal_url},created_by:i}),{success:!0,sealUrl:r.seal_url}}async function _(e){let t=new Date().toISOString(),i=n.from("signature_requests").update({status:"expired"}).lt("expires_at",t).in("status",["pending","sent","viewed"]);e&&(i=i.eq("company_id",e));let{data:r,error:s}=await i.select("id, company_id");if(s)throw s;let o=(r||[]).length;for(let n of r||[])await (0,a.logAudit)({company_id:n.company_id||e||"",user_id:"system",action:"update",entity_type:"signature",entity_id:n.id,entity_name:"서명 요청 자동 만료",metadata:{reason:"overdue",expired_at:t}});return o}async function y(e){let{data:t,error:a}=await n.from("signature_requests").select("*, documents(name, status, content_json)").eq("id",e).single();if(a)throw a;return t}e.s(["SIGNATURE_STATUS",0,i,"applyCompanySeal",()=>g,"cancelSignature",()=>m,"createSignatureRequest",()=>o,"expireOverdueSignatures",()=>_,"getDocumentSignatures",()=>c,"getSignatureRequest",()=>y,"getSignatureRequests",()=>d,"getSignatureStatusInfo",()=>r,"saveSignature",()=>p,"sendSignatureEmail",()=>l,"updateSignatureStatus",()=>u])},87200,e=>{"use strict";var t=e.i(55749),a=e.i(45700),n=e.i(7471),i=e.i(40352),r=e.i(94286);let s=n.supabase;async function o(e,t="DOC"){let a=new Date,n=`${a.getFullYear()}${String(a.getMonth()+1).padStart(2,"0")}`,i=`${t}-${n}-%`,{data:r}=await s.from("documents").select("document_number").eq("company_id",e).like("document_number",i).order("document_number",{ascending:!1}).limit(1),l=1;if(r&&r.length>0&&r[0].document_number){let e=r[0].document_number.split("-"),t=parseInt(e[e.length-1],10);isNaN(t)||(l=t+1)}return`${t}-${n}-${String(l).padStart(4,"0")}`}async function l(e){let n=new t.default("p","mm","a4");await (0,r.loadKoreanFont)(n);let i=n.internal.pageSize.getWidth(),s=n.internal.pageSize.getHeight(),o=20;n.setFontSize(12),(0,r.setKoreanFont)(n,"normal"),n.setTextColor(100,100,100),n.text(e.companyName,14,o),e.documentNumber&&(n.setFontSize(9),n.text(e.documentNumber,i-14,o,{align:"right"})),o+=12,n.setFontSize(18),(0,r.setKoreanFont)(n,"bold"),n.setTextColor(30,30,30),n.text(e.title,i/2,o,{align:"center"}),o+=14,n.setDrawColor(200,200,200),n.line(14,o,i-14,o),o+=10;let l=e.content.split("\n").map(e=>[e]);(0,a.default)(n,{startY:o,body:l,theme:"plain",styles:{fontSize:10,cellPadding:{top:1.5,bottom:1.5,left:2,right:2},textColor:[40,40,40],lineWidth:0,font:"NanumGothic"},columnStyles:{0:{cellWidth:i-28}},margin:{left:14,right:14},tableLineColor:[255,255,255],tableLineWidth:0}),o=n.lastAutoTable.finalY+15;let d=e.issueDate||new Date().toLocaleDateString("ko-KR");o>s-80&&(n.addPage(),o=20),n.setFontSize(10),(0,r.setKoreanFont)(n,"normal"),n.setTextColor(60,60,60),n.text(d,i/2,o,{align:"center"}),o+=10;let c=e.companyInfo;if(c){let t=[];for(let a of(t.push(e.companyName),c.address&&t.push(c.address),c.businessNumber&&t.push(`사업자등록번호: ${c.businessNumber}`),c.phone&&t.push(`TEL: ${c.phone}`),c.representative&&t.push(`대표이사: ${c.representative}`),n.setFontSize(9),t))n.text(a,i/2,o,{align:"center"}),o+=5}if(e.applyStamp&&e.sealUrl)try{let t=await m(e.sealUrl),a=o-10;n.addImage(t,"PNG",i-14-30,a,30,30)}catch{console.warn("Seal image load failed, skipping stamp overlay")}return _(n,e.companyName),n.output("blob")}async function d(e){let n=new t.default("p","mm","a4");await (0,r.loadKoreanFont)(n);let i=n.internal.pageSize.getWidth(),s=15;n.setFontSize(20),(0,r.setKoreanFont)(n,"bold"),n.setTextColor(30,30,30),n.text("견 적 서",i/2,s,{align:"center"}),s+=12,n.setFontSize(9),(0,r.setKoreanFont)(n,"normal"),n.setTextColor(80,80,80),n.text(`No. ${e.documentNumber}`,14,s),n.text(`Date: ${new Date().toLocaleDateString("ko-KR")}`,i-14,s,{align:"right"}),s+=8;let o=[["수 신",`${e.counterparty} 귀하`],["발 신",e.companyInfo.name],["대표이사",e.companyInfo.representative||"-"],["사업자번호",e.companyInfo.businessNumber||"-"],["주 소",e.companyInfo.address||"-"],["연락처",e.companyInfo.phone||"-"]];e.managerName&&o.push(["담 당 자",e.managerName+(e.managerContact?` (${e.managerContact})`:"")]),(0,a.default)(n,{startY:s,body:o,theme:"grid",styles:{fontSize:9,cellPadding:3,font:"NanumGothic"},columnStyles:{0:{cellWidth:30,fontStyle:"bold",fillColor:[245,247,250]},1:{cellWidth:i-58}},margin:{left:14,right:14}}),s=n.lastAutoTable.finalY+6,n.setFillColor(59,130,246),n.roundedRect(14,s,i-28,12,2,2,"F"),n.setFontSize(12),(0,r.setKoreanFont)(n,"bold"),n.setTextColor(255,255,255),n.text(`합계금액:  ${g(e.totalAmount)} 원 (VAT 포함)`,i/2,s+8,{align:"center"}),s+=18;let l=e.items.map((e,t)=>[String(t+1),e.name,e.spec||"-",e.qty.toLocaleString("ko-KR"),g(e.unitPrice),g(e.amount)]);(0,a.default)(n,{startY:s,head:[["No","품 명","규 격","수 량","단 가","금 액"]],body:l,theme:"grid",styles:{fontSize:8,cellPadding:3,halign:"center",font:"NanumGothic"},headStyles:{fillColor:[59,130,246],textColor:255,fontStyle:"bold",font:"NanumGothic"},columnStyles:{0:{cellWidth:12},1:{cellWidth:50,halign:"left"},2:{cellWidth:30},3:{cellWidth:20},4:{cellWidth:30,halign:"right"},5:{cellWidth:35,halign:"right"}},margin:{left:14,right:14},alternateRowStyles:{fillColor:[248,249,250]}}),s=n.lastAutoTable.finalY+2,(0,a.default)(n,{startY:s,body:[["공급가액",`${g(e.supplyAmount)} 원`],["부가세 (10%)",`${g(e.taxAmount)} 원`],["합계금액",`${g(e.totalAmount)} 원`]],theme:"grid",styles:{fontSize:9,cellPadding:3,font:"NanumGothic"},columnStyles:{0:{cellWidth:40,fontStyle:"bold",fillColor:[245,247,250],halign:"center"},1:{halign:"right"}},margin:{left:i-14-100,right:14}}),s=n.lastAutoTable.finalY+6;let d=[];if(e.validUntil&&d.push(["유효기간",e.validUntil]),e.deliveryDate&&d.push(["납품일",e.deliveryDate]),e.bankInfo){let t=e.bankInfo.accountHolder?` (${e.bankInfo.accountHolder})`:"";d.push(["입금계좌",`${e.bankInfo.bankName} ${e.bankInfo.accountNumber}${t}`])}if(e.notes&&d.push(["비 고",e.notes]),d.length>0&&((0,a.default)(n,{startY:s,body:d,theme:"grid",styles:{fontSize:9,cellPadding:3,font:"NanumGothic"},columnStyles:{0:{cellWidth:30,fontStyle:"bold",fillColor:[245,247,250]}},margin:{left:14,right:14}}),s=n.lastAutoTable.finalY+6),e.sealUrl)try{let t=await m(e.sealUrl);n.addImage(t,"PNG",i-14-30-5,s,30,30)}catch{console.warn("Seal image load failed, skipping stamp overlay")}return _(n,e.companyInfo.name),n.output("blob")}async function c(e,t,a){let n=await o(a),r=new Date().toISOString(),{error:l}=await s.from("documents").update({document_number:n,status:"issued",issued_at:r,locked_at:r}).eq("id",e);if(l)throw l;await (0,i.logAudit)({companyId:a,userId:t,entityType:"document",entityId:e,action:"issue",afterJson:{document_number:n,status:"issued",issued_at:r,locked_at:r}})}function u(e){let{documentNumber:t,date:a,partyA:n,partyB:i,contractAmount:r,taxAmount:s,totalAmount:o,items:l,contractSubject:d,contractStartDate:c,contractEndDate:u,paymentTerms:m,deliveryDeadline:g,inspectionPeriod:_,warrantyPeriod:y,latePenaltyRate:f,specialTerms:b,sealUrlA:h,sealUrlB:v}=e,w=l.length>0?l.map((e,t)=>`
        <tr>
          <td style="text-align:center;">${t+1}</td>
          <td>${p(e.name)}</td>
          <td style="text-align:center;">${p(e.spec||"-")}</td>
          <td style="text-align:right;">${e.qty.toLocaleString("ko-KR")}</td>
          <td style="text-align:right;">${e.unitPrice.toLocaleString("ko-KR")}</td>
          <td style="text-align:right;">${e.amount.toLocaleString("ko-KR")}</td>
        </tr>`).join("\n"):`<tr><td colspan="6" style="text-align:center;color:#999;">품목 없음</td></tr>`,x=h?`<img src="${p(h)}" alt="갑 직인" style="width:60px;height:60px;margin-left:8px;vertical-align:middle;" />`:'<span style="display:inline-block;width:60px;height:60px;border:1px solid #ccc;border-radius:50%;text-align:center;line-height:60px;color:#ccc;font-size:11px;margin-left:8px;vertical-align:middle;">인</span>',S=v?`<img src="${p(v)}" alt="을 직인" style="width:60px;height:60px;margin-left:8px;vertical-align:middle;" />`:'<span style="display:inline-block;width:60px;height:60px;border:1px solid #ccc;border-radius:50%;text-align:center;line-height:60px;color:#ccc;font-size:11px;margin-left:8px;vertical-align:middle;">인</span>',$=b?p(b).replace(/\n/g,"<br/>"):"해당 없음";return`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>계약서 - ${p(t)}</title>
<style>
  @page {
    size: A4;
    margin: 20mm 15mm 20mm 15mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 10pt;
    line-height: 1.7;
    color: #222;
    background: #fff;
  }
  .contract-page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 20mm 15mm;
    background: #fff;
  }
  @media print {
    body { background: #fff; }
    .contract-page { padding: 0; margin: 0; width: 100%; }
  }
  .contract-title {
    text-align: center;
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: 12px;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 2px solid #333;
  }
  .doc-meta {
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #666;
    margin-bottom: 20px;
  }
  .party-section {
    margin-bottom: 20px;
    padding: 12px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #fafafa;
  }
  .party-section .party-label {
    font-weight: 700;
    font-size: 11pt;
    color: #1a56db;
    margin-bottom: 4px;
  }
  .party-section .party-detail {
    font-size: 9.5pt;
    color: #444;
    line-height: 1.8;
  }
  .amount-box {
    text-align: center;
    background: #1a56db;
    color: #fff;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13pt;
    font-weight: 700;
    margin: 16px 0;
    letter-spacing: 1px;
  }
  .items-table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 20px;
    font-size: 9pt;
  }
  .items-table th {
    background: #1a56db;
    color: #fff;
    padding: 6px 8px;
    font-weight: 600;
    text-align: center;
    border: 1px solid #1a56db;
  }
  .items-table td {
    padding: 5px 8px;
    border: 1px solid #ddd;
  }
  .items-table tr:nth-child(even) td {
    background: #f8f9fa;
  }
  .amount-summary {
    text-align: right;
    margin: 8px 0 20px;
    font-size: 9.5pt;
  }
  .amount-summary .row {
    margin-bottom: 2px;
  }
  .amount-summary .total {
    font-weight: 700;
    font-size: 10.5pt;
    border-top: 1px solid #333;
    padding-top: 4px;
    margin-top: 4px;
  }
  .article {
    margin-bottom: 12px;
    page-break-inside: avoid;
  }
  .article-title {
    font-weight: 700;
    font-size: 10.5pt;
    margin-bottom: 4px;
    color: #1a1a1a;
  }
  .article-body {
    padding-left: 8px;
    font-size: 9.5pt;
    color: #333;
  }
  .article-body p {
    margin-bottom: 3px;
  }
  .signature-block {
    margin-top: 40px;
    page-break-inside: avoid;
  }
  .signature-date {
    text-align: center;
    font-size: 11pt;
    font-weight: 600;
    margin-bottom: 32px;
  }
  .signature-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
  }
  .signature-party {
    width: 45%;
  }
  .signature-party .sig-label {
    font-weight: 700;
    font-size: 11pt;
    margin-bottom: 8px;
  }
  .signature-party .sig-detail {
    font-size: 9pt;
    color: #555;
    line-height: 1.8;
    margin-bottom: 12px;
  }
  .signature-party .sig-line {
    display: flex;
    align-items: center;
    margin-top: 8px;
  }
  .signature-party .sig-line .label {
    font-weight: 600;
    white-space: nowrap;
  }
  .signature-party .sig-line .stamp-area {
    display: inline-block;
    margin-left: 8px;
  }
  .closing-text {
    text-align: center;
    font-size: 9.5pt;
    color: #555;
    margin-top: 24px;
    line-height: 1.8;
  }
  .footer {
    text-align: center;
    font-size: 7pt;
    color: #aaa;
    margin-top: 32px;
    padding-top: 8px;
    border-top: 1px solid #eee;
  }
</style>
</head>
<body>
<div class="contract-page">

  <!-- Header -->
  <div class="contract-title">계 약 서</div>
  <div class="doc-meta">
    <span>계약번호: ${p(t)}</span>
    <span>계약일자: ${p(a)}</span>
  </div>

  <!-- Party Info -->
  <div class="party-section">
    <div class="party-label">"갑" (위탁자)</div>
    <div class="party-detail">
      상호: ${p(n.name)}<br/>
      대표이사: ${p(n.representative||"")}<br/>
      사업자등록번호: ${p(n.businessNumber||"")}<br/>
      주소: ${p(n.address||"")}<br/>
      ${n.phone?`연락처: ${p(n.phone)}<br/>`:""}
    </div>
  </div>
  <div class="party-section">
    <div class="party-label">"을" (수탁자)</div>
    <div class="party-detail">
      상호: ${p(i.name)}<br/>
      대표이사: ${p(i.representative||"")}<br/>
      사업자등록번호: ${p(i.businessNumber||"")}<br/>
      주소: ${p(i.address||"")}<br/>
      ${i.phone?`연락처: ${p(i.phone)}<br/>`:""}
    </div>
  </div>

  <!-- Contract Amount -->
  <div class="amount-box">
    합계금액: ₩${o.toLocaleString("ko-KR")} 원 (VAT 포함)
  </div>

  <!-- Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:8%;">No</th>
        <th style="width:32%;">품명</th>
        <th style="width:16%;">규격</th>
        <th style="width:10%;">수량</th>
        <th style="width:16%;">단가</th>
        <th style="width:18%;">금액</th>
      </tr>
    </thead>
    <tbody>
      ${w}
    </tbody>
  </table>
  <div class="amount-summary">
    <div class="row">공급가액: ₩${r.toLocaleString("ko-KR")}</div>
    <div class="row">부가가치세(10%): ₩${s.toLocaleString("ko-KR")}</div>
    <div class="total">합계: ₩${o.toLocaleString("ko-KR")}</div>
  </div>

  <!-- Contract Articles (16조) -->
  <div class="article">
    <div class="article-title">제1조 (계약목적)</div>
    <div class="article-body">
      <p>본 계약은 "${p(d)}"(이하 "본 건"이라 한다)에 관하여 갑과 을 사이의 권리\xb7의무 관계를 명확히 규정함을 목적으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제2조 (계약기간)</div>
    <div class="article-body">
      <p>① 본 계약의 유효기간은 ${p(c)}부터 ${p(u||"프로젝트 완료 시")}까지로 한다.</p>
      <p>② 계약기간 만료 1개월 전까지 쌍방 이의가 없는 경우 동일 조건으로 1년간 자동 연장되며, 이후에도 같다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제3조 (계약금액)</div>
    <div class="article-body">
      <p>① 본 계약의 대금은 금 ${r.toLocaleString("ko-KR")} 원정(부가가치세 별도)으로 한다.</p>
      <p>② 부가가치세는 관련 법령에 따라 별도 청구하며, 세금계산서 발행을 원칙으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제4조 (납품 및 인도)</div>
    <div class="article-body">
      <p>① 을은 ${p(g||"별도 협의")}까지 본 건의 결과물(이하 "납품물"이라 한다)을 갑에게 납품\xb7인도한다.</p>
      <p>② 납품 장소는 갑이 지정한 장소로 하며, 납품에 소요되는 비용은 을이 부담한다.</p>
      <p>③ 을은 납품 시 납품명세서를 첨부하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제5조 (검수)</div>
    <div class="article-body">
      <p>① 갑은 납품일로부터 ${p(_)} 이내에 납품물의 수량\xb7품질\xb7규격 등을 검수하여야 한다.</p>
      <p>② 검수 결과 하자가 발견된 경우 갑은 을에게 보완, 교체 또는 재납품을 요구할 수 있으며, 을은 지체 없이 이에 응하여야 한다.</p>
      <p>③ 검수 기간 내 갑이 별도의 이의를 제기하지 아니한 경우 검수에 합격한 것으로 본다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제6조 (대금지급)</div>
    <div class="article-body">
      <p>① ${p(m||"별도 협의")}</p>
      <p>② 갑은 을이 적법한 세금계산서를 발행한 날로부터 30일 이내에 대금을 지급한다.</p>
      <p>③ 갑의 귀책사유로 지급이 지연되는 경우 연 이율 5%의 지연이자를 가산하여 지급한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제7조 (하자보수)</div>
    <div class="article-body">
      <p>① 을은 납품물에 대하여 검수 완료일로부터 ${p(y)} 동안 하자보수 책임을 진다.</p>
      <p>② 하자보수 기간 중 을의 귀책사유로 발생한 하자에 대하여 을은 무상으로 보수 또는 교체하여야 한다.</p>
      <p>③ 을이 하자보수 요청을 받은 날로부터 7영업일 이내에 보수를 개시하지 않는 경우 갑은 제3자에게 보수를 의뢰하고 그 비용을 을에게 청구할 수 있다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제8조 (지체상금)</div>
    <div class="article-body">
      <p>① 을이 납품기한을 초과하여 이행하는 경우 지체일수 1일당 계약금액의 ${p(f)}%에 해당하는 금액을 지체상금으로 갑에게 납부하여야 한다.</p>
      <p>② 지체상금의 총액은 계약금액의 10%를 초과하지 아니한다.</p>
      <p>③ 불가항력 사유에 해당하는 경우에는 지체상금을 면제한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제9조 (손해배상)</div>
    <div class="article-body">
      <p>① 갑 또는 을이 본 계약상의 의무를 위반하여 상대방에게 손해를 끼친 경우 이를 배상하여야 한다.</p>
      <p>② 손해배상의 범위는 통상 손해에 한하되, 특별한 사정으로 인한 손해는 채무자가 그 사정을 알았거나 알 수 있었을 때에 한하여 배상한다.</p>
      <p>③ 본 조의 손해배상 청구권은 손해 발생 사실을 안 날로부터 1년, 손해 발생일로부터 3년 이내에 행사하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제10조 (권리\xb7의무의 양도 금지)</div>
    <div class="article-body">
      <p>갑과 을은 상대방의 사전 서면 동의 없이 본 계약상의 권리\xb7의무의 전부 또는 일부를 제3자에게 양도하거나 담보로 제공할 수 없다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제11조 (불가항력)</div>
    <div class="article-body">
      <p>① 천재지변, 전쟁, 내란, 법령의 개폐, 정부의 행위, 전염병, 파업 기타 당사자의 통제 범위를 벗어나는 사유(이하 "불가항력"이라 한다)로 인하여 본 계약을 이행할 수 없는 경우 그 책임을 면한다.</p>
      <p>② 불가항력 사유가 발생한 당사자는 즉시 상대방에게 서면으로 통지하고, 그 사유가 종료된 후 지체 없이 계약 이행을 재개하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제12조 (비밀유지)</div>
    <div class="article-body">
      <p>① 갑과 을은 본 계약의 체결 및 이행과정에서 취득한 상대방의 기밀정보(기술정보, 영업정보, 고객정보 등)를 제3자에게 누설하거나 본 계약 목적 외의 용도로 사용하지 아니한다.</p>
      <p>② 비밀유지 의무는 본 계약 종료 후에도 3년간 존속한다.</p>
      <p>③ 법령에 의한 공개 의무가 있는 경우 또는 상대방의 서면 동의를 얻은 경우에는 예외로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제13조 (계약해지)</div>
    <div class="article-body">
      <p>① 갑 또는 을이 다음 각 호에 해당하는 경우 상대방은 서면 통지로써 본 계약을 해지할 수 있다.</p>
      <p style="padding-left:12px;">1. 본 계약상의 중대한 의무를 위반하고 서면 최고 후 14일 이내에 시정하지 않는 경우</p>
      <p style="padding-left:12px;">2. 파산, 회생 절차 개시, 해산 결의 등으로 정상적인 계약 이행이 곤란한 경우</p>
      <p style="padding-left:12px;">3. 어음\xb7수표의 부도 등으로 지급불능 상태에 빠진 경우</p>
      <p>② 계약 해지 시 기 수행된 부분에 대하여는 상호 정산하여 처리한다.</p>
      <p>③ 계약 해지는 이미 발생한 손해배상 청구권에 영향을 미치지 아니한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제14조 (분쟁해결)</div>
    <div class="article-body">
      <p>① 본 계약에 관한 분쟁은 갑과 을이 성실히 협의하여 해결한다.</p>
      <p>② 협의가 이루어지지 아니하는 경우 갑의 본점 소재지를 관할하는 법원을 제1심 관할법원으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제15조 (기타)</div>
    <div class="article-body">
      <p>① 본 계약에 정하지 아니한 사항은 상관례 및 민법, 상법 등 관련 법령에 따른다.</p>
      <p>② 본 계약의 변경은 갑과 을의 서면 합의에 의하여야 하며, 구두 합의는 효력이 없다.</p>
      <p>③ 본 계약의 어느 조항이 무효 또는 집행 불가능하더라도 나머지 조항의 유효성에는 영향을 미치지 아니한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제16조 (특약사항)</div>
    <div class="article-body">
      <p>${$}</p>
    </div>
  </div>

  <!-- Closing + Signature -->
  <div class="closing-text">
    본 계약의 성립을 증명하기 위하여 계약서 2통을 작성하고,<br/>
    갑\xb7을이 각각 서명 날인한 후 각 1통씩 보관한다.
  </div>

  <div class="signature-block">
    <div class="signature-date">${p(a)}</div>
    <div class="signature-row">
      <div class="signature-party">
        <div class="sig-label">"갑"</div>
        <div class="sig-detail">
          ${p(n.name)}<br/>
          ${n.address?p(n.address)+"<br/>":""}
          ${n.businessNumber?"사업자등록번호: "+p(n.businessNumber)+"<br/>":""}
        </div>
        <div class="sig-line">
          <span class="label">대표이사 ${p(n.representative||"_______________")}</span>
          <span class="stamp-area">${x}</span>
        </div>
      </div>
      <div class="signature-party">
        <div class="sig-label">"을"</div>
        <div class="sig-detail">
          ${p(i.name)}<br/>
          ${i.address?p(i.address)+"<br/>":""}
          ${i.businessNumber?"사업자등록번호: "+p(i.businessNumber)+"<br/>":""}
        </div>
        <div class="sig-line">
          <span class="label">대표이사 ${p(i.representative||"_______________")}</span>
          <span class="stamp-area">${S}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    OwnerView Document System | ${p(t)} | Generated: ${new Date().toISOString().split("T")[0]}
  </div>

</div>
</body>
</html>`}function p(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function m(e){let t=await fetch(e),a=await t.blob();return new Promise((e,t)=>{let n=new FileReader;n.onloadend=()=>e(n.result),n.onerror=t,n.readAsDataURL(a)})}function g(e){let t=Math.abs(e);return`${e<0?"-":""}${t.toLocaleString("ko-KR")}`}function _(e,t){let a=e.getNumberOfPages(),n=e.internal.pageSize.getWidth(),i=e.internal.pageSize.getHeight();for(let s=1;s<=a;s++)e.setPage(s),e.setFontSize(7),(0,r.setKoreanFont)(e,"normal"),e.setTextColor(150,150,150),e.text(`OwnerView Document  |  ${t}  |  Page ${s}/${a}`,n/2,i-8,{align:"center"})}e.s(["generateContractPDF",()=>u,"generateDocumentPDF",()=>l,"generateQuotePDF",()=>d,"issueDocument",()=>c])},90001,e=>{"use strict";var t=e.i(7471),a=e.i(66154),n=e.i(59771),i=e.i(88617),r=e.i(87200),s=e.i(64130);let o=t.supabase;async function l(e){let{companyId:t,dealId:a,docType:n,createdBy:i,items:r,paymentRatio:s}=e,{data:l,error:d}=await o.from("deals").select("*, partners!deals_partner_id_fkey(name, business_number, contact_email, contact_phone)").eq("id",a).eq("company_id",t).single();if(d||!l)throw Error(`딜을 찾을 수 없습니다 (id: ${a}, error: ${d?.message||"no data"})`);let c=l.partners?.name||l.counterparty||"",u=l.partners?.business_number||"",p=Number(l.contract_total||0),{data:m}=await o.from("companies").select("name, business_number, representative, address").eq("id",t).single(),g=m?.name||"",_=m?.business_number||"",y=m?.representative||"",f=m?.address||"",b={type:n,dealId:a,dealName:l.name,partnerName:c,partnerBizNo:u,partnerEmail:l.partners?.contact_email||"",partnerPhone:l.partners?.contact_phone||"",contractTotal:p,supplyAmount:p,taxAmount:Math.round(.1*p),totalWithTax:Math.round(1.1*p),sections:[],metadata:{autoGenerated:!0,sourceDocType:n,generatedAt:new Date().toISOString()}};if("contract"===n){let e=await (async()=>{let{data:e}=await o.from("documents").select("content_json").eq("deal_id",a).order("created_at",{ascending:!1});return(e||[]).find(e=>{let t=e.content_json;return t?.type==="invoice"||t?.type==="quote"})})(),t=e?.content_json,n=t?.items&&Array.isArray(t.items)&&t.items.length>0?t.items:[{name:l.name||"",quantity:1,unitPrice:p,supplyAmount:p,taxAmount:Math.round(.1*p),totalAmount:Math.round(1.1*p),note:""}],i=t?.paymentRatio?.advance??s?.advance??30,r=t?.paymentRatio?.balance??s?.balance??70;Object.assign(b,{contractStartDate:new Date().toISOString().split("T")[0],contractEndDate:"",paymentTerms:`계약금 ${i}% (계약 후 7일 이내), 잔금 ${r}% (납품 완료 후 14일 이내)`,paymentSchedule:[{label:"선금",ratio:i,amount:Math.round(p*i/100),condition:"계약 후 7일 이내"},{label:"잔금",ratio:r,amount:p-Math.round(p*i/100),condition:"납품 완료 후 14일 이내"}],paymentRatio:{advance:i,balance:r},items:n})}if("invoice"===n){let e=r&&r.length>0?r:l.items&&Array.isArray(l.items)&&l.items.length>0?l.items:[{name:l.name||"",quantity:1,unitPrice:p,supplyAmount:p,taxAmount:Math.round(.1*p),totalAmount:Math.round(1.1*p),note:""}];Object.assign(b,{validUntil:new Date(Date.now()+2592e6).toISOString().split("T")[0],items:e,...s?{paymentRatio:s}:{}})}let h=`${l.name} - ${{invoice:"견적서",contract:"계약서",quote:"제안서"}[n]}`,v=Math.round(.1*p),w=p+v,x=new Date().toISOString().split("T")[0],S=b.items||[];function $(e){let t="\n┌──────┬──────────────────────┬──────────┬──────────┬──────────────┬────────────────┐\n";return t+="│  No  │ 품명                 │ 수량     │ 단가     │ 공급가액     │ 비고           │\n├──────┼──────────────────────┼──────────┼──────────┼──────────────┼────────────────┤\n",e.forEach((e,a)=>{let n=String(a+1).padStart(4),i=(e.name||"").slice(0,18).padEnd(18),r=String(e.quantity||1).padStart(6),s=Number(e.unitPrice||0).toLocaleString("ko-KR").padStart(8),o=Number(e.supplyAmount||e.amount||0).toLocaleString("ko-KR").padStart(12),l=(e.note||"").slice(0,12).padEnd(12);t+=`│ ${n} │ ${i} │ ${r} │ ${s} │ ${o} │ ${l} │
`}),t+="└──────┴──────────────────────┴──────────┴──────────┴──────────────┴────────────────┘\n"}if("invoice"===n){let e=b.validUntil||"";b.body=`견 적 서

수 신: ${c} 귀하
발 신: ${g}
견적일자: ${x}

아래와 같이 견적합니다.
${$(S)}
  공급가액:  ₩${p.toLocaleString("ko-KR")}
  부가세(10%): ₩${v.toLocaleString("ko-KR")}
  ─────────────────────
  합계금액:  ₩${w.toLocaleString("ko-KR")} (VAT 포함)

유효기간: ${e}까지

[결제조건]
${b.paymentRatio?`선금 ${b.paymentRatio.advance}% / 잔금 ${b.paymentRatio.balance}%`:"협의"}

${g}
대표이사 ${y} (직인)`}if("contract"===n){let e=(b.paymentSchedule||[]).map(e=>`  - ${e.label} (${e.ratio}%): ₩${e.amount.toLocaleString("ko-KR")} — ${e.condition}`).join("\n");b.body=`표 준 용 역 계 약 서

계약일자: ${x}

"갑" ${g} (사업자등록번호: ${_})
     대표이사: ${y}
     주소: ${f}

"을" ${c} (사업자등록번호: ${u})


제1조 (목적)
본 계약은 "${l.name}"에 관하여 갑과 을 사이의 권리\xb7의무를 규정함을 목적으로 한다.

제2조 (용역의 범위)
을은 갑이 의뢰한 아래 용역을 성실히 수행한다.
${$(S)}

제3조 (계약금액 및 부가가치세)
  공급가액:  ₩${p.toLocaleString("ko-KR")}
  부가가치세(10%): ₩${v.toLocaleString("ko-KR")}
  ─────────────────────
  합계금액:  ₩${w.toLocaleString("ko-KR")} (VAT 포함)

제4조 (대금지급)
${e||b.paymentTerms||"별도 협의"}

제5조 (계약기간)
${b.contractStartDate||x} ~ ${b.contractEndDate||"프로젝트 완료 시"}

제6조 (납품 및 검수)
을은 용역 완료 후 결과물을 갑에게 납품하고, 갑은 납품일로부터 7영업일 이내에 검수를 완료한다.
검수 결과 하자가 발견된 경우 을은 갑의 요청에 따라 무상으로 보완한다.

제7조 (지식재산권)
본 계약에 의해 수행된 용역의 결과물에 대한 저작재산권 및 소유권은 대금 완납 시 갑에게 귀속된다.

제8조 (비밀유지)
계약 당사자는 본 계약의 이행과정에서 취득한 상대방의 기밀정보를 제3자에게 누설하지 아니하며,
계약 종료 후에도 2년간 비밀유지 의무를 부담한다.

제9조 (손해배상)
계약 당사자가 본 계약을 위반하여 상대방에게 손해를 끼친 경우 그 손해를 배상한다.

제10조 (계약해제 및 해지)
1. 상대방이 본 계약상의 의무를 이행하지 않을 때 서면으로 최고한 후 7일 이내에 이행하지 않으면 계약을 해제\xb7해지할 수 있다.
2. 갑의 사정으로 계약을 해지하는 경우 기 수행된 부분에 대해서는 정산하여 지급한다.

제11조 (불가항력)
천재지변, 전쟁 등 불가항력적인 사유로 계약을 이행할 수 없는 경우 그 책임을 면한다.

제12조 (분쟁해결)
본 계약에 관한 분쟁은 갑의 소재지 관할법원을 제1심 법원으로 한다.

본 계약의 성립을 증명하기 위하여 계약서 2통을 작성하고,
갑\xb7을이 각각 서명 날인한 후 각 1통씩 보관한다.

${x}

"갑" ${g}  대표이사 ${y} (인)
"을" ${c}  대표이사 ______________ (인)`}let{data:I,error:q}=await o.from("documents").insert({company_id:t,deal_id:a,name:h,status:"draft",content_json:b,version:1,created_by:i}).select().single();if(q)throw q;return I.id}async function d(e){let{documentId:a,companyId:n,approverId:r}=e,{data:d}=await t.supabase.from("documents").select("id, name, deal_id, content_json").eq("id",a).single();if(!d||!d.deal_id)return{};let p=d.content_json,m=p?.type;if("invoice"===m||"quote"===m){let e=await l({companyId:n,dealId:d.deal_id,docType:"contract",createdBy:r});await (0,i.dispatchBusinessEvent)({dealId:d.deal_id,eventType:"document_approved",userId:r,referenceId:e,referenceTable:"documents",summary:{title:`계약서 자동 생성됨 (견적서 승인 기반)`}});try{let{data:t}=await o.from("deals").select("name, partners!deals_partner_id_fkey(name, contact_email, contact_phone)").eq("id",d.deal_id).single(),a=t?.partners?.contact_email||"",l=t?.partners?.name||"";try{await (0,s.applyCompanySeal)({documentId:e,companyId:n,appliedBy:r}),await (0,i.dispatchBusinessEvent)({dealId:d.deal_id,eventType:"document_approved",userId:r,referenceId:e,referenceTable:"documents",summary:{title:`계약서 직인 자동 적용`}})}catch{}if(a&&a.includes("@")){let o=await (0,s.createSignatureRequest)({companyId:n,documentId:e,title:`${t?.name||"계약"} - 계약서 서명 요청`,signerName:l,signerEmail:a,createdBy:r});await (0,s.sendSignatureEmail)(o.id),await (0,i.dispatchBusinessEvent)({dealId:d.deal_id,eventType:"document_approved",userId:r,referenceId:o.id,referenceTable:"signature_requests",summary:{title:`서명 요청 자동 발송 (${a})`}})}}catch(e){console.error("Auto-signature request failed:",e)}return{nextAction:"contract_created",createdDocId:e}}if("contract"===m){let e=await c({dealId:d.deal_id,documentId:a,companyId:n,content:p,createdBy:r}),t=await u({dealId:d.deal_id,companyId:n,userId:r,contractTotal:Number(p?.contractTotal||p?.supplyAmount||0),partnerName:p?.partnerName||"",partnerBizNo:p?.partnerBizNo||"",paymentSchedule:p?.paymentSchedule||null,paymentRatio:p?.paymentRatio||null});return{nextAction:"tax_invoice_and_schedule_created",createdInvoiceId:t.invoiceIds?.[0]||void 0,createdDocId:e.pdfDocId}}return{}}async function c(e){let{dealId:t,documentId:a,companyId:n,content:i,createdBy:s}=e;try{let{data:e}=await o.from("companies").select("name, business_number, representative, address, phone").eq("id",n).single(),l=(i?.items||[]).map(e=>({name:e.name||"",spec:e.spec||"",qty:Number(e.quantity||e.qty||1),unitPrice:Number(e.unitPrice||0),amount:Number(e.supplyAmount||e.amount||e.totalAmount||0)})),d=Number(i?.contractTotal||i?.supplyAmount||0),c=(0,r.generateContractPDF)({documentNumber:i?.documentNumber||`CTR-${t.slice(0,8).toUpperCase()}`,date:new Date().toLocaleDateString("ko-KR"),partyA:{name:e?.name||"",representative:e?.representative||"",businessNumber:e?.business_number||"",address:e?.address||"",phone:e?.phone||""},partyB:{name:i?.partnerName||"",representative:i?.counterpartyRepresentative||"",businessNumber:i?.partnerBizNo||"",address:i?.counterpartyAddress||""},contractAmount:d,taxAmount:Math.round(.1*d),totalAmount:Math.round(1.1*d),items:l,contractSubject:i?.dealName||"",contractStartDate:i?.contractStartDate||new Date().toISOString().split("T")[0],contractEndDate:i?.contractEndDate||"",paymentTerms:i?.paymentTerms||"",deliveryDeadline:i?.deliveryDeadline||"",inspectionPeriod:i?.inspectionPeriod||"7영업일",warrantyPeriod:i?.warrantyPeriod||"납품 후 1년",latePenaltyRate:i?.latePenaltyRate||"0.1",specialTerms:i?.specialTerms||""}),{data:u}=await o.from("documents").insert({company_id:n,deal_id:t,name:`${i?.dealName||"계약"} - 계약서 (PDF)`,status:"issued",content_json:{type:"contract_pdf",sourceDocumentId:a,pdfHtml:c,generatedAt:new Date().toISOString(),metadata:{autoGenerated:!0,sourceDocType:"contract"}},content_type:"contract_pdf",version:1,created_by:s}).select("id").single();return{pdfDocId:u?.id}}catch(e){return console.error("Contract PDF generation failed:",e),{}}}async function u(e){let{dealId:t,companyId:n,userId:r,contractTotal:s,partnerName:o,partnerBizNo:l,paymentSchedule:d,paymentRatio:c}=e,u=[];if(s<=0)return{invoiceIds:u};let m=c?.advance??30,g=c?.balance??70,_=d&&Array.isArray(d)&&d.length>0?d:[{label:"선금",ratio:m,amount:Math.round(s*m/100),condition:"계약 후 7일 이내"},{label:"잔금",ratio:g,amount:s-Math.round(s*m/100),condition:"납품 완료 후 14일 이내"}],y=await p({dealId:t,companyId:n,contractTotal:s,userId:r,schedule:_});for(let e=0;e<_.length;e++){let s=_[e];if(s.amount<=0)continue;let d=y[e]||null,c=0===e,p=await (0,a.createTaxInvoice)({companyId:n,dealId:t,type:"sales",counterpartyName:o,counterpartyBizno:l,supplyAmount:s.amount,issueDate:new Date().toISOString().split("T")[0],label:`${s.label} 세금계산서`,revenueScheduleId:d,status:c?"issued":"draft"});p?.id&&(u.push(p.id),await (0,i.dispatchBusinessEvent)({dealId:t,eventType:"invoice_issued",userId:r,referenceId:p.id,referenceTable:"tax_invoices",summary:{amount:Math.round(1.1*s.amount),title:`${s.label} 세금계산서 자동 생성 (${c?"issued":"draft"})`}}))}return{invoiceIds:u}}async function p(e){let{dealId:t,companyId:a,contractTotal:r,userId:s,schedule:l}=e;if(r<=0)return[];let d=new Date,c=[];for(let e=0;e<l.length;e++){let a=l[e],n=new Date(d.getTime()+(0===e?7:60)*864e5),{data:i}=await o.from("deal_revenue_schedule").insert({deal_id:t,label:`${a.label} (${a.ratio}%)`,amount:a.amount,due_date:n.toISOString().split("T")[0],status:"expected",condition_text:a.condition}).select("id").single();i?.id&&c.push(i.id)}let u=l[0];u&&await (0,n.createQueueEntry)({companyId:a,dealId:t,amount:u.amount,description:`${u.label} ${u.ratio}% 입금 예정 (D+7)`,costType:"revenue"});let p=l.map(e=>`${e.label} ${e.amount.toLocaleString()}원`).join(" / ");return await (0,i.dispatchBusinessEvent)({dealId:t,eventType:"milestone_completed",userId:s,referenceId:t,referenceTable:"deals",summary:{title:`매출 스케줄 생성: ${p}`}}),c}async function m(e){let{dealId:t,companyId:n,amount:r,userId:s,revenueScheduleId:l}=e;if(l){await o.from("deal_revenue_schedule").update({status:"received",received_date:new Date().toISOString().split("T")[0]}).eq("id",l);let{data:e}=await o.from("tax_invoices").select("id").eq("revenue_schedule_id",l).single();e&&await (0,a.markInvoiceMatched)(e.id);let{data:n}=await o.from("tax_invoices").select("id, revenue_schedule_id").eq("deal_id",t).eq("status","draft").not("revenue_schedule_id","is",null).order("created_at",{ascending:!0}).limit(1);n&&n.length>0&&await (0,a.issueTaxInvoice)(n[0].id)}let{data:d}=await o.from("deal_revenue_schedule").select("id, amount, status").eq("deal_id",t),c=(d||[]).every(e=>"received"===e.status),u=(d||[]).reduce((e,t)=>e+Number(t.amount||0),0),p=(d||[]).filter(e=>"received"===e.status).reduce((e,t)=>e+Number(t.amount||0),0);c&&p>=u&&(await o.from("deals").update({status:"completed",last_activity_at:new Date().toISOString()}).eq("id",t),await (0,i.dispatchBusinessEvent)({dealId:t,eventType:"deal_status_changed",userId:s,referenceId:t,referenceTable:"deals",summary:{from:"active",to:"completed",reason:"전액 입금 완료"}})),await (0,i.dispatchBusinessEvent)({dealId:t,eventType:"payment_received",userId:s,referenceId:l||t,referenceTable:l?"deal_revenue_schedule":"deals",summary:{amount:r,totalReceived:p,totalExpected:u,progress:u>0?Math.round(p/u*100):0}})}async function g(e){let{data:a}=await t.supabase.from("documents").select("id, name, status, content_json, created_at, updated_at").eq("deal_id",e).order("created_at",{ascending:!0}),{data:n}=await t.supabase.from("tax_invoices").select("id, status, total_amount, issue_date").eq("deal_id",e).neq("status","void"),{data:i}=await o.from("deal_revenue_schedule").select("id, status, amount").eq("deal_id",e),r=[],s=(a||[]).find(e=>{let t=e.content_json;return t?.type==="invoice"||t?.type==="quote"});r.push({stage:"quote",status:s?"approved"===s.status||"locked"===s.status?"completed":"active":"pending",documentId:s?.id,completedAt:s?.status==="approved"?s.updated_at??s.created_at??void 0:void 0});let l=(a||[]).find(e=>{let t=e.content_json;return t?.type==="contract"});r.push({stage:"contract",status:l?"approved"===l.status||"locked"===l.status?"completed":"active":"pending",documentId:l?.id,completedAt:l?.status==="approved"?l.created_at??void 0:void 0}),r.push({stage:"tax_invoice",status:(n||[]).length>0?"completed":"pending",documentId:n?.[0]?.id});let d=(i||[]).length>0;return r.push({stage:"payment_schedule",status:d?"completed":"pending"}),r.push({stage:"payment_received",status:d&&(i||[]).every(e=>"received"===e.status)?"completed":d?"active":"pending"}),r}async function _(e){let{documentId:a,companyId:n,approverId:r,reason:s}=e,{data:o}=await t.supabase.from("documents").select("id, name, status, deal_id, content_json").eq("id",a).single();if(!o)throw Error("문서를 찾을 수 없습니다");let l=o.content_json||{},{error:c}=await t.supabase.from("documents").update({status:"approved",content_json:{...l,forceApproval:{approved:!0,approvedBy:r,approvedAt:new Date().toISOString(),reason:s||"업체 미응답으로 임의 승인"}}}).eq("id",a);if(c)throw c;return(o.deal_id&&await (0,i.dispatchBusinessEvent)({dealId:o.deal_id,eventType:"document_approved",userId:r,referenceId:a,referenceTable:"documents",summary:{title:`${o.name} 임의 승인 (사유: ${s||"업체 미응답"})`}}),o.deal_id)?d({documentId:a,companyId:n,approverId:r}):{nextAction:"force_approved"}}e.s(["createDocumentFromDeal",()=>l,"forceApproveDocument",()=>_,"getDealPipelineStatus",()=>g,"onDocumentApproved",()=>d,"onRevenueReceived",()=>m])},47019,e=>{"use strict";var t=e.i(7471);async function a(e){let{data:a,error:n}=await t.supabase.from("chat_channels").insert({company_id:e.companyId,deal_id:e.dealId||null,sub_deal_id:e.subDealId||null,type:e.type||"deal",name:e.name}).select().single();if(n)throw n;return await t.supabase.from("chat_participants").insert({channel_id:a.id,user_id:e.creatorUserId,role:"OWNER"}),await o(a.id,"channel_created",{created_by:e.creatorUserId}),a}async function n(e){let{data:a,error:n}=await t.supabase.from("chat_messages").insert({channel_id:e.channelId,sender_id:e.senderId,content:e.content,type:e.type||"text",thread_id:e.threadId||null,metadata:e.metadata||null}).select().single();if(n)throw n;return await t.supabase.from("chat_participants").update({last_read_at:new Date().toISOString()}).eq("channel_id",e.channelId).eq("user_id",e.senderId),a}async function i(e,a){let{error:n}=await t.supabase.from("chat_messages").update({pinned:a}).eq("id",e);if(n)throw n}async function r(e){let{data:a,error:n}=await t.supabase.from("chat_participants").insert({channel_id:e.channelId,user_id:e.userId,role:e.role||"member"}).select().single();if(n)throw n;return await o(e.channelId,"user_joined",{user_id:e.userId,role:e.role||"member"}),a}async function s(e,a){let{error:n}=await t.supabase.from("chat_participants").update({last_read_at:new Date().toISOString()}).eq("channel_id",e).eq("user_id",a);if(n)throw n}async function o(e,a,n){await t.supabase.from("chat_events").insert({channel_id:e,event_type:a,data_json:n||null})}async function l(e,t,a){return n({channelId:e,senderId:t,content:a,type:"system"})}async function d(e){if(e.file.size>0xa00000)throw Error("파일 크기는 10MB 이하만 가능합니다.");if(!["image/","application/pdf","application/msword","application/vnd.openxmlformats-","text/csv"].some(t=>e.file.type.startsWith(t)))throw Error("지원하지 않는 파일 형식입니다.");let a=e.file.name.split(".").pop()||"bin",i=`${e.channelId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${a}`,{error:r}=await t.supabase.storage.from("chat-files").upload(i,e.file);if(r)throw r;let{data:s}=t.supabase.storage.from("chat-files").getPublicUrl(i),o=await n({channelId:e.channelId,senderId:e.senderId,content:e.file.name,type:"file",metadata:{file_name:e.file.name,file_url:s.publicUrl,file_size:e.file.size,mime_type:e.file.type}});return await t.supabase.from("chat_files").insert({channel_id:e.channelId,message_id:o.id,file_name:e.file.name,file_url:s.publicUrl,file_size:e.file.size,mime_type:e.file.type}),o}async function c(e){let{data:a,error:n}=await t.supabase.from("chat_messages").insert({channel_id:e.channelId,sender_id:e.senderId,content:e.content,type:e.type||"text",reply_to_id:e.replyToId||null,metadata:e.metadata||null}).select().single();if(n)throw n;if(e.mentionedUserIds.length>0){let n=e.mentionedUserIds.map(t=>({message_id:a.id,channel_id:e.channelId,mentioned_user_id:t}));await t.supabase.from("chat_mentions").insert(n)}return await t.supabase.from("chat_participants").update({last_read_at:new Date().toISOString()}).eq("channel_id",e.channelId).eq("user_id",e.senderId),a}async function u(e,a,n){let{error:i}=await t.supabase.from("chat_reactions").upsert({message_id:e,user_id:a,emoji:n},{onConflict:"message_id,user_id,emoji"});if(i)throw i}async function p(e,a,n){let{error:i}=await t.supabase.from("chat_reactions").delete().eq("message_id",e).eq("user_id",a).eq("emoji",n);if(i)throw i}async function m(e,a){let{error:n}=await t.supabase.from("chat_messages").update({content:a,edited_at:new Date().toISOString()}).eq("id",e);if(n)throw n}async function g(e){let{error:a}=await t.supabase.from("chat_messages").update({deleted_at:new Date().toISOString()}).eq("id",e);if(a)throw a}async function _(e){let a=t.supabase,{data:n,error:i}=await a.from("chat_channels").insert({company_id:e.companyId,name:e.name,description:e.description||null,is_dm:!1}).select().single();if(i)throw i;return n}async function y(e){let a=t.supabase,n=`DM-${Date.now()}`,{data:i,error:r}=await a.from("chat_channels").insert({company_id:e.companyId,name:n,is_dm:!0}).select().single();if(r)throw r;for(let t of e.participantIds)await a.from("chat_members").insert({channel_id:i.id,user_id:t});return i}async function f(e){let a=t.supabase,{data:n}=await a.from("chat_channels").select("invite_token").eq("id",e).single();if(n?.invite_token)return n.invite_token;let i=crypto.randomUUID();return await a.from("chat_channels").update({invite_token:i,allow_guests:!0}).eq("id",e),i}function b(e){let t=window.location.origin;return`${t}/chat?token=${e}`}async function h(e){let{data:a,error:n}=await t.supabase.from("chat_action_cards").insert({message_id:e.messageId,channel_id:e.channelId,card_type:e.cardType,reference_id:e.referenceId,reference_table:e.referenceTable,summary_json:e.summaryJson||{}}).select().single();if(n)throw n;return a}e.s(["addReaction",()=>u,"createActionCard",()=>h,"createChannel",()=>a,"createDMChannel",()=>y,"createTeamChannel",()=>_,"deleteMessage",()=>g,"editMessage",()=>m,"getChatInviteUrl",()=>b,"getOrCreateInviteToken",()=>f,"inviteParticipant",()=>r,"logEvent",()=>o,"markAsRead",()=>s,"removeReaction",()=>p,"sendMessage",()=>n,"sendMessageWithMentions",()=>c,"sendSystemMessage",()=>l,"togglePin",()=>i,"uploadChatFile",()=>d])},88617,e=>{"use strict";var t=e.i(7471),a=e.i(47019);let n={contract_executed:e=>`📝 계약이 체결되었습니다. ${e.title||""}`,payment_received:e=>`💰 입금이 확인되었습니다. ${e.amount?Number(e.amount).toLocaleString()+"원":""}`,milestone_completed:e=>`🎯 마일스톤 완료: ${e.title||e.name||""}`,document_approved:e=>`✅ 문서가 승인되었습니다: ${e.title||""}`,document_locked:e=>`🔒 문서가 잠금되었습니다: ${e.title||""}`,deal_status_changed:e=>`📊 딜 상태 변경: ${e.from||""} → ${e.to||""}`,cost_approved:e=>`💳 비용이 승인되었습니다. ${e.amount?Number(e.amount).toLocaleString()+"원":""}`,invoice_issued:e=>`📋 세금계산서가 발행되었습니다. ${e.amount?Number(e.amount).toLocaleString()+"원":""}`,quote_approved:e=>`📄 견적서가 승인되었습니다 → 계약서 자동 생성. ${e.title||""}`,contract_signed:e=>`✍️ 계약서가 서명되었습니다. ${e.title||""}`,payment_schedule_created:e=>`📅 매출 스케줄이 생성되었습니다. 선금 ${e.advance?Number(e.advance).toLocaleString()+"원":""} / 잔금 ${e.balance?Number(e.balance).toLocaleString()+"원":""}`,revenue_received:e=>`💰 매출 입금: ${e.amount?Number(e.amount).toLocaleString()+"원":""} (${e.progress||0}%)`},i={contract_executed:"document",payment_received:"payment",milestone_completed:"milestone",document_approved:"approval",document_locked:"document",deal_status_changed:"quote",cost_approved:"payment",invoice_issued:"document",quote_approved:"approval",contract_signed:"document",payment_schedule_created:"payment",revenue_received:"payment"};async function r(e){let{dealId:r,eventType:s,userId:o,referenceId:l,referenceTable:d,summary:c={}}=e,{data:u}=await t.supabase.from("chat_channels").select("id").eq("deal_id",r).eq("is_archived",!1).limit(1).maybeSingle();if(!u)return;let p=n[s],m=p?p(c):`시스템 이벤트: ${s}`,g=await (0,a.sendSystemMessage)(u.id,o,m),_=i[s]||"document";await (0,a.createActionCard)({messageId:g.id,channelId:u.id,cardType:_,referenceId:l,referenceTable:d,summaryJson:{...c,eventType:s}}),await (0,a.logEvent)(u.id,s,{user_id:o,reference_id:l,reference_table:d,...c})}e.s(["dispatchBusinessEvent",()=>r])},40352,e=>{"use strict";var t=e.i(7471);async function a(e){let{error:a}=await t.supabase.from("audit_logs").insert({company_id:e.companyId,user_id:e.userId??null,entity_type:e.entityType,entity_id:e.entityId,action:e.action,before_json:e.beforeJson??null,after_json:e.afterJson??null,metadata:e.metadata??null});if(a)throw a}e.s(["logAudit",()=>a])},35429,e=>{"use strict";var t=e.i(7471);async function a(e,a,n){if(n){let{data:e}=await t.supabase.from("bank_accounts").select("*").eq("id",n).single();if(e)return e}let{data:i}=await t.supabase.from("routing_rules").select("*, bank_accounts(*)").eq("company_id",e).eq("cost_type",a).order("priority",{ascending:!1}).limit(1);if(i&&i.length>0){let e=i[0];if(e.bank_accounts)return e.bank_accounts}let{data:r}=await t.supabase.from("routing_rules").select("*, bank_accounts(*)").eq("company_id",e).eq("cost_type","default").order("priority",{ascending:!1}).limit(1);if(r&&r.length>0){let e=r[0];if(e.bank_accounts)return e.bank_accounts}let{data:s}=await t.supabase.from("bank_accounts").select("*").eq("company_id",e).eq("is_primary",!0).limit(1).single();return s||null}e.s(["BANK_ROLES",0,[{value:"OPERATING",label:"운영통장"},{value:"TAX",label:"세금통장"},{value:"PAYROLL",label:"급여통장"},{value:"PROJECT",label:"프로젝트통장"},{value:"operating",label:"운영통장"},{value:"savings",label:"저축통장"},{value:"subsidy",label:"보조금통장"},{value:"project",label:"프로젝트통장"},{value:"loan",label:"대출통장"}],"COST_TYPES",0,[{value:"salary",label:"급여"},{value:"tax",label:"세금"},{value:"outsource",label:"외주비"},{value:"advertising",label:"광고비"},{value:"rent",label:"임대료"},{value:"insurance",label:"보험"},{value:"default",label:"기본"}],"resolveBank",()=>a])},59771,e=>{"use strict";var t=e.i(47167),a=e.i(7471),n=e.i(35429),i=e.i(40352);async function r(e){if(e.approvalRequestId)try{let{data:t}=await a.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("approval_request_id",e.approvalRequestId).maybeSingle();if(t)return t}catch{}if(e.costScheduleId){let{data:t}=await a.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("cost_schedule_id",e.costScheduleId).maybeSingle();if(t)return t}if(e.dealId&&e.description){let{data:t}=await a.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("deal_id",e.dealId).eq("description",e.description).maybeSingle();if(t)return t}if(e.sourceType&&e.sourceId){let{data:t}=await a.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("payment_type",e.sourceType).eq("category",e.sourceId).maybeSingle();if(t)return t}let t=await (0,n.resolveBank)(e.companyId,e.costType||"default",e.dealBankAccountId),i={company_id:e.companyId,cost_schedule_id:e.costScheduleId||null,bank_account_id:t?.id||null,amount:e.amount,description:e.description||null,status:"pending"};e.dealId&&(i.deal_id=e.dealId),e.sourceType&&(i.payment_type=e.sourceType),e.sourceId&&(i.category=e.sourceId);let{data:r,error:s}=await a.supabase.from("payment_queue").insert(i).select().single();if(s)throw s;return r}async function s(e,t){let{error:n}=await a.supabase.from("payment_queue").update({status:"approved",approved_by:t,approved_at:new Date().toISOString()}).eq("id",e).eq("status","pending");if(n)throw n}async function o(e,t){let{error:n}=await a.supabase.from("payment_queue").update({status:"rejected",approved_by:t,approved_at:new Date().toISOString()}).eq("id",e).eq("status","pending");if(n)throw n}async function l(e){let{data:n}=await a.supabase.from("payment_queue").select("*").eq("id",e).eq("status","approved").single();if(!n)throw Error("승인된 결제만 실행할 수 있습니다");if(n.bank_account_id){let{data:t}=await a.supabase.from("bank_accounts").select("balance").eq("id",n.bank_account_id).single(),r=Number(t?.balance||0),s=Number(n.amount);if(r<s)throw await a.supabase.from("payment_queue").update({status:"failed"}).eq("id",e),await (0,i.logAudit)({companyId:n.company_id,entityType:"payment_queue",entityId:e,action:"execute_failed",metadata:{reason:"insufficient_balance",required:s,available:r}}),Error(`잔액 부족: 필요 ${s.toLocaleString()}원, 가용 ${r.toLocaleString()}원`)}let r=Math.random().toString(36).substring(2,8).toUpperCase(),s=`TXN-${Date.now()}-${r}`,{error:o}=await a.supabase.from("payment_queue").update({status:"executed",executed_at:new Date().toISOString(),transfer_ref:s}).eq("id",e);if(o)throw await a.supabase.from("payment_queue").update({status:"approved"}).eq("id",e),o;let l=t.default.env.NEXT_PUBLIC_N8N_PAYMENT_WEBHOOK;if(l)try{let t=await fetch(l,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentId:e,amount:Number(n.amount),recipientName:n.recipient_name,recipientAccount:n.recipient_account,recipientBank:n.recipient_bank,description:n.description,transferRef:s})});if(t.ok){let n=await t.json();n.transferRef&&await a.supabase.from("payment_queue").update({transfer_ref:n.transferRef}).eq("id",e)}else console.warn("n8n 이체 요청 실패, DB 상태만 업데이트됨:",t.status)}catch(e){console.warn("n8n 웹훅 연결 실패, 수동 이체 필요:",e)}try{if(n.cost_schedule_id&&await a.supabase.from("deal_cost_schedule").update({status:"paid",approved:!0,approved_at:new Date().toISOString()}).eq("id",n.cost_schedule_id),n.bank_account_id){let{data:e}=await a.supabase.from("bank_accounts").select("balance").eq("id",n.bank_account_id).single();e&&await a.supabase.from("bank_accounts").update({balance:Number(e.balance||0)-Number(n.amount)}).eq("id",n.bank_account_id)}await (0,i.logAudit)({companyId:n.company_id,entityType:"payment_queue",entityId:e,action:"execute_success",metadata:{amount:Number(n.amount),transfer_ref:s,bank_account_id:n.bank_account_id,cost_schedule_id:n.cost_schedule_id}})}catch(t){throw await a.supabase.from("payment_queue").update({status:"failed",transfer_ref:s}).eq("id",e),await (0,i.logAudit)({companyId:n.company_id,entityType:"payment_queue",entityId:e,action:"execute_failed",metadata:{transfer_ref:s,error:t instanceof Error?t.message:String(t)}}),t}}async function d(e){let{data:t}=await a.supabase.from("payment_queue").select("status, amount").eq("company_id",e),n=t||[];return{pendingCount:n.filter(e=>"pending"===e.status).length,pendingAmount:n.filter(e=>"pending"===e.status).reduce((e,t)=>e+Number(t.amount),0),approvedCount:n.filter(e=>"approved"===e.status).length,approvedAmount:n.filter(e=>"approved"===e.status).reduce((e,t)=>e+Number(t.amount),0),executedCount:n.filter(e=>"executed"===e.status).length,executedAmount:n.filter(e=>"executed"===e.status).reduce((e,t)=>e+Number(t.amount),0),rejectedCount:n.filter(e=>"rejected"===e.status).length}}e.s(["approvePayment",()=>s,"createQueueEntry",()=>r,"executePayment",()=>l,"getPaymentQueueStats",()=>d,"rejectPayment",()=>o])},66154,e=>{"use strict";var t=e.i(7471);async function a(e){let a=Math.round(.1*e.supplyAmount),i=e.supplyAmount+a,r=e.status||(e.revenueScheduleId?"draft":"sales"===e.type?"issued":"received"),{data:s,error:o}=await t.supabase.from("tax_invoices").insert({company_id:e.companyId,deal_id:e.dealId||null,type:e.type,counterparty_name:e.counterpartyName,counterparty_bizno:e.counterpartyBizno||null,supply_amount:e.supplyAmount,tax_amount:a,total_amount:i,issue_date:e.issueDate,status:r,label:e.label||null,revenue_schedule_id:e.revenueScheduleId||null,preferred_date:e.preferredDate||null,expense_category:e.expenseCategory||null,source:"manual"}).select().single();if(o)throw o;return s&&"purchase"===e.type&&n(e.companyId,s).catch(e=>{console.error("Auto expense report creation failed:",e)}),s}async function n(a,n){try{let{createApprovalRequest:i}=await e.A(33094),{data:r}=await t.supabase.from("users").select("id").eq("company_id",a).eq("role","owner").limit(1).single();if(!r)return;await i({companyId:a,requestType:"expense_report",requestId:n.id,requesterId:r.id,title:`[자동] 매입 세금계산서 - ${n.counterparty_name}`,amount:Number(n.total_amount),description:`매입 세금계산서 자동 연결
거래처: ${n.counterparty_name}
공급가: ₩${Number(n.supply_amount).toLocaleString()}
부가세: ₩${Number(n.tax_amount).toLocaleString()}
합계: ₩${Number(n.total_amount).toLocaleString()}
발행일: ${n.issue_date}`})}catch(e){console.error("autoCreateExpenseReport failed:",e)}}async function i(e){let a=.01;try{let{data:n}=await t.supabase.from("companies").select("tax_settings").eq("id",e).single(),i=n?.tax_settings;i?.matching_tolerance!=null&&i.matching_tolerance>=0&&i.matching_tolerance<=100&&(a=i.matching_tolerance/100)}catch{}let{data:n}=await t.supabase.from("tax_invoices").select("*, deals(*)").eq("company_id",e).eq("type","sales").neq("status","void");if(!n)return[];let{data:i}=await t.supabase.from("deal_revenue_schedule").select("*, deals!inner(company_id)").eq("deals.company_id",e).eq("status","received"),r=new Map;return(i||[]).forEach(e=>{let t=e.deal_id;r.set(t,(r.get(t)||0)+Number(e.amount||0))}),n.map(e=>{let t=e.deals,n=Number(t?.contract_total||0),i=Number(e.supply_amount||0),s=Number(e.tax_amount||0),o=Number(e.total_amount||0),l=r.get(e.deal_id)||0,d=n>0&&Math.abs(n-i)/n<=a,c=o>0&&Math.abs(o-l)/o<=a;return{invoiceId:e.id,dealId:e.deal_id,dealName:t?.name||null,invoiceAmount:o,invoiceSupplyAmount:i,invoiceTaxAmount:s,contractAmount:n,receivedAmount:l,amountMatch:d,paymentMatch:c,fullMatch:d&&c,gap:o-l}})}async function r(e){let{error:a}=await t.supabase.from("tax_invoices").update({status:"matched"}).eq("id",e);if(a)throw a}async function s(e){let{data:a,error:n}=await t.supabase.from("tax_invoices").update({status:"issued",issue_date:new Date().toISOString().split("T")[0]}).eq("id",e).eq("status","draft").select().single();if(n)throw n;return a}async function o(e,a,n="monthly"){let i=`${a}-01-01`,r=`${a}-12-31`,{data:s}=await t.supabase.from("tax_invoices").select("type, supply_amount, tax_amount, total_amount, issue_date").eq("company_id",e).neq("status","void").gte("issue_date",i).lte("issue_date",r);if(!s||0===s.length)return[];let l=new Map;return s.forEach(e=>{let t=(e=>{let t=new Date(e).getMonth()+1;if("annual"===n)return`${a}`;if("quarterly"===n){let e=Math.ceil(t/3);return`${a}-Q${e}`}return`${a}-${String(t).padStart(2,"0")}`})(e.issue_date);l.has(t)||l.set(t,{period:t,salesCount:0,purchaseCount:0,salesSupply:0,salesTax:0,salesTotal:0,purchaseSupply:0,purchaseTax:0,purchaseTotal:0,vatPayable:0});let i=l.get(t),r=Number(e.supply_amount||0),s=Number(e.tax_amount||0),o=Number(e.total_amount||0);"sales"===e.type?(i.salesCount++,i.salesSupply+=r,i.salesTax+=s,i.salesTotal+=o):(i.purchaseCount++,i.purchaseSupply+=r,i.purchaseTax+=s,i.purchaseTotal+=o)}),l.forEach(e=>{e.vatPayable=e.salesTax-e.purchaseTax}),Array.from(l.values()).sort((e,t)=>e.period.localeCompare(t.period))}async function l(e,a){let n=t.supabase,i=await o(e,a,"quarterly"),{data:r}=await n.from("card_deduction_summary").select("*").eq("company_id",e),s=new Map;(r||[]).forEach(e=>{let t=new Date(e.month);if(t.getFullYear()!==a)return;let n=Math.ceil((t.getMonth()+1)/3),i=`${a}-Q${n}`;s.set(i,(s.get(i)||0)+Number(e.estimated_vat_deduction||0))});let l={[`${a}-Q1`]:`${a}-04-25`,[`${a}-Q2`]:`${a}-07-25`,[`${a}-Q3`]:`${a}-10-25`,[`${a}-Q4`]:`${a+1}-01-25`};return[`${a}-Q1`,`${a}-Q2`,`${a}-Q3`,`${a}-Q4`].map(e=>{let t=i.find(t=>t.period===e),a=t?.salesTax||0,n=t?.purchaseTax||0,r=s.get(e)||0;return{quarter:e,salesTax:a,purchaseTax:n,cardDeduction:r,netVAT:a-n-r,dueDate:l[e]||""}})}function d(e){return e.map(e=>({type:"매출"===e["구분"]||"발행"===e["유형"]?"sales":"purchase",counterpartyName:String(e["거래처명"]||e["상호"]||""),counterpartyBizno:String(e["사업자번호"]||e["사업자등록번호"]||""),supplyAmount:Number(e["공급가액"]||e["공급가"]||0),taxAmount:Number(e["세액"]||e["부가세"]||0),totalAmount:Number(e["합계금액"]||e["합계"]||0),issueDate:String(e["발행일"]||e["작성일자"]||"")})).filter(e=>e.counterpartyName&&e.supplyAmount>0)}async function c(e){let{data:{session:a}}=await t.supabase.auth.getSession();if(!a)throw Error("로그인이 필요합니다");let n=await t.supabase.functions.invoke("sync-hometax-invoices",{body:{type:e.type||"both",start_date:e.startDate,end_date:e.endDate}});if(n.error)throw n.error;return n.data}async function u(e){let{data:{session:a}}=await t.supabase.auth.getSession();if(!a)throw Error("로그인이 필요합니다");let n=await t.supabase.functions.invoke("modify-tax-invoice",{body:{invoice_id:e.invoiceId,reason:e.reason,new_supply_amount:e.newSupplyAmount,modification_date:e.modificationDate}});if(n.error)throw n.error;return n.data}async function p(e){let a=t.supabase,{data:n,error:i}=await a.from("tax_invoice_queue").select("*, deals(name)").eq("company_id",e).in("status",["pending","needs_approval","processing"]).order("created_at",{ascending:!1});if(i)throw i;return n||[]}async function m(e,a){let n=t.supabase,{error:i}=await n.from("tax_invoice_queue").update({status:"pending",approved_by:a,approved_at:new Date().toISOString()}).eq("id",e);if(i)throw i}async function g(e,a=20){let n=t.supabase,{data:i,error:r}=await n.from("hometax_sync_log").select("*").eq("company_id",e).order("created_at",{ascending:!1}).limit(a);if(r)throw r;return i||[]}async function _(e,a){let n=a.map(t=>({company_id:e,type:t.type,counterparty_name:t.counterpartyName,counterparty_bizno:t.counterpartyBizno||null,supply_amount:t.supplyAmount,tax_amount:t.taxAmount||Math.round(.1*t.supplyAmount),total_amount:t.totalAmount||Math.round(1.1*t.supplyAmount),issue_date:t.issueDate,status:"sales"===t.type?"issued":"received"})),{data:i,error:r}=await t.supabase.from("tax_invoices").insert(n).select();if(r)throw r;return i}e.s(["INVOICE_STATUS",0,{draft:{label:"작성중",bg:"bg-gray-500/10",text:"text-gray-400"},issued:{label:"발행",bg:"bg-blue-500/10",text:"text-blue-400"},received:{label:"수취",bg:"bg-blue-500/10",text:"text-blue-400"},matched:{label:"매칭완료",bg:"bg-green-500/10",text:"text-green-400"},modified:{label:"수정발행",bg:"bg-orange-500/10",text:"text-orange-400"},void:{label:"무효",bg:"bg-red-500/10",text:"text-red-400"}},"INVOICE_TYPES",0,[{value:"sales",label:"매출 (발행)"},{value:"purchase",label:"매입 (수취)"}],"approveQueueItem",()=>m,"bulkImportTaxInvoices",()=>_,"createTaxInvoice",()=>a,"getHomeTaxSyncLogs",()=>g,"getInvoiceQueue",()=>p,"getTaxInvoiceSummary",()=>o,"getVATPreview",()=>l,"issueTaxInvoice",()=>s,"markInvoiceMatched",()=>r,"modifyTaxInvoice",()=>u,"parseHomeTaxExcel",()=>d,"syncHomeTaxInvoices",()=>c,"threeWayMatch",()=>i])},94286,e=>{"use strict";let t=null;async function a(e){if(!t)try{let e=await fetch("https://fonts.gstatic.com/s/nanumgothic/v23/PN_3Rfi-oW3hYwmKDpxS7F_z_tLfxno73g.ttf");if(!e.ok)throw Error(`Font fetch failed: ${e.status}`);let a=await e.arrayBuffer(),n=new Uint8Array(a),i="";for(let e=0;e<n.length;e+=8192){let t=n.subarray(e,Math.min(e+8192,n.length));i+=String.fromCharCode.apply(null,t)}t=btoa(i)}catch(e){console.warn("Korean font load failed, falling back to helvetica:",e);return}e.addFileToVFS("NanumGothic-Regular.ttf",t),e.addFont("NanumGothic-Regular.ttf","NanumGothic","normal"),e.addFont("NanumGothic-Regular.ttf","NanumGothic","bold")}function n(e,t="normal"){try{e.setFont("NanumGothic",t)}catch{e.setFont("helvetica",t)}}e.s(["loadKoreanFont",()=>a,"setKoreanFont",()=>n])},94008,e=>{"use strict";var t=e.i(7471);async function a(e){try{await t.supabase.from("audit_logs").insert({...e,created_at:new Date().toISOString()})}catch(e){console.error("Audit log failed:",e)}}e.s(["logAudit",()=>a])},10160,e=>{"use strict";function t(e){return(t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e})(e)}e.s(["default",()=>t])}]);