(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,40352,e=>{"use strict";var t=e.i(7471);async function a(e){let{error:a}=await t.supabase.from("audit_logs").insert({company_id:e.companyId,user_id:e.userId??null,entity_type:e.entityType,entity_id:e.entityId,action:e.action,before_json:e.beforeJson??null,after_json:e.afterJson??null,metadata:e.metadata??null});if(a)throw a}e.s(["logAudit",()=>a])},35429,e=>{"use strict";var t=e.i(7471);async function a(e,a,n){if(n){let{data:e}=await t.supabase.from("bank_accounts").select("*").eq("id",n).single();if(e)return e}let{data:i}=await t.supabase.from("routing_rules").select("*, bank_accounts(*)").eq("company_id",e).eq("cost_type",a).order("priority",{ascending:!1}).limit(1);if(i&&i.length>0){let e=i[0];if(e.bank_accounts)return e.bank_accounts}let{data:s}=await t.supabase.from("routing_rules").select("*, bank_accounts(*)").eq("company_id",e).eq("cost_type","default").order("priority",{ascending:!1}).limit(1);if(s&&s.length>0){let e=s[0];if(e.bank_accounts)return e.bank_accounts}let{data:r}=await t.supabase.from("bank_accounts").select("*").eq("company_id",e).eq("is_primary",!0).limit(1).single();return r||null}e.s(["BANK_ROLES",0,[{value:"OPERATING",label:"운영통장"},{value:"TAX",label:"세금통장"},{value:"PAYROLL",label:"급여통장"},{value:"PROJECT",label:"프로젝트통장"}],"COST_TYPES",0,[{value:"salary",label:"급여"},{value:"tax",label:"세금"},{value:"outsource",label:"외주비"},{value:"advertising",label:"광고비"},{value:"rent",label:"임대료"},{value:"insurance",label:"보험"},{value:"default",label:"기본"}],"resolveBank",()=>a])},59771,e=>{"use strict";var t=e.i(7471),a=e.i(35429),n=e.i(40352);async function i(e){if(e.approvalRequestId){let{data:a}=await t.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("approval_request_id",e.approvalRequestId).maybeSingle();if(a)return a}if(e.costScheduleId){let{data:a}=await t.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("cost_schedule_id",e.costScheduleId).maybeSingle();if(a)return a}if(e.dealId&&e.description){let{data:a}=await t.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("deal_id",e.dealId).eq("description",e.description).maybeSingle();if(a)return a}if(e.sourceType&&e.sourceId){let{data:a}=await t.supabase.from("payment_queue").select("*").eq("company_id",e.companyId).eq("payment_type",e.sourceType).eq("category",e.sourceId).maybeSingle();if(a)return a}let n=await (0,a.resolveBank)(e.companyId,e.costType||"default",e.dealBankAccountId),i={company_id:e.companyId,cost_schedule_id:e.costScheduleId||null,bank_account_id:n?.id||null,amount:e.amount,description:e.description||null,status:"pending"};e.approvalRequestId&&(i.approval_request_id=e.approvalRequestId),e.dealId&&(i.deal_id=e.dealId),e.sourceType&&(i.payment_type=e.sourceType),e.sourceId&&(i.category=e.sourceId);let{data:s,error:r}=await t.supabase.from("payment_queue").insert(i).select().single();if(r)throw r;return s}async function s(e,a){let{error:n}=await t.supabase.from("payment_queue").update({status:"approved",approved_by:a,approved_at:new Date().toISOString()}).eq("id",e).eq("status","pending");if(n)throw n}async function r(e,a){let{error:n}=await t.supabase.from("payment_queue").update({status:"rejected",approved_by:a,approved_at:new Date().toISOString()}).eq("id",e).eq("status","pending");if(n)throw n}async function o(e){let{data:a}=await t.supabase.from("payment_queue").select("*").eq("id",e).eq("status","approved").single();if(!a)throw Error("승인된 결제만 실행할 수 있습니다");if(a.bank_account_id){let{data:i}=await t.supabase.from("bank_accounts").select("balance").eq("id",a.bank_account_id).single(),s=Number(i?.balance||0),r=Number(a.amount);if(s<r)throw await t.supabase.from("payment_queue").update({status:"failed"}).eq("id",e),await (0,n.logAudit)({companyId:a.company_id,entityType:"payment_queue",entityId:e,action:"execute_failed",metadata:{reason:"insufficient_balance",required:r,available:s}}),Error(`잔액 부족: 필요 ${r.toLocaleString()}원, 가용 ${s.toLocaleString()}원`)}let i=Math.random().toString(36).substring(2,8).toUpperCase(),s=`TXN-${Date.now()}-${i}`,{error:r}=await t.supabase.from("payment_queue").update({status:"executed",executed_at:new Date().toISOString(),transfer_ref:s}).eq("id",e);if(r)throw await t.supabase.from("payment_queue").update({status:"approved"}).eq("id",e),r;try{if(a.cost_schedule_id&&await t.supabase.from("deal_cost_schedule").update({status:"paid",approved:!0,approved_at:new Date().toISOString()}).eq("id",a.cost_schedule_id),a.bank_account_id){let{data:e}=await t.supabase.from("bank_accounts").select("balance").eq("id",a.bank_account_id).single();e&&await t.supabase.from("bank_accounts").update({balance:Number(e.balance||0)-Number(a.amount)}).eq("id",a.bank_account_id)}await (0,n.logAudit)({companyId:a.company_id,entityType:"payment_queue",entityId:e,action:"execute_success",metadata:{amount:Number(a.amount),transfer_ref:s,bank_account_id:a.bank_account_id,cost_schedule_id:a.cost_schedule_id}})}catch(i){throw await t.supabase.from("payment_queue").update({status:"failed",transfer_ref:s}).eq("id",e),await (0,n.logAudit)({companyId:a.company_id,entityType:"payment_queue",entityId:e,action:"execute_failed",metadata:{transfer_ref:s,error:i instanceof Error?i.message:String(i)}}),i}}async function l(e){let{data:a}=await t.supabase.from("payment_queue").select("status, amount").eq("company_id",e),n=a||[];return{pendingCount:n.filter(e=>"pending"===e.status).length,pendingAmount:n.filter(e=>"pending"===e.status).reduce((e,t)=>e+Number(t.amount),0),approvedCount:n.filter(e=>"approved"===e.status).length,approvedAmount:n.filter(e=>"approved"===e.status).reduce((e,t)=>e+Number(t.amount),0),executedCount:n.filter(e=>"executed"===e.status).length,executedAmount:n.filter(e=>"executed"===e.status).reduce((e,t)=>e+Number(t.amount),0),rejectedCount:n.filter(e=>"rejected"===e.status).length}}e.s(["approvePayment",()=>s,"createQueueEntry",()=>i,"executePayment",()=>o,"getPaymentQueueStats",()=>l,"rejectPayment",()=>r])},10160,e=>{"use strict";function t(e){return(t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e})(e)}e.s(["default",()=>t])},6789,e=>{"use strict";var t=e.i(7471);let a=t.supabase;async function n(e){let t=new Date;t.setDate(t.getDate()+7);let{data:n,error:i}=await a.from("partner_invitations").insert({company_id:e.companyId,deal_id:e.dealId||null,email:e.email,name:e.name||null,role:"partner",expires_at:t.toISOString()}).select().single();if(i)throw i;return n}async function i(e){let{data:t}=await a.from("partner_invitations").select("*, deals(name)").eq("company_id",e).order("created_at",{ascending:!1});return t||[]}async function s(e){let{data:t,error:n}=await a.from("partner_invitations").update({status:"accepted",accepted_at:new Date().toISOString()}).eq("invite_token",e).eq("status","pending").select().single();if(n)throw n;return t}async function r(e){let{error:t}=await a.from("partner_invitations").update({status:"cancelled"}).eq("id",e);if(t)throw t}async function o(e){let t=new Date;t.setDate(t.getDate()+7);let{data:n,error:i}=await a.from("employee_invitations").insert({company_id:e.companyId,email:e.email,name:e.name||null,role:e.role||"employee",invited_by:e.invitedBy,expires_at:t.toISOString()}).select().single();if(i)throw i;return n}async function l(e){let{data:t}=await a.from("employee_invitations").select("*").eq("company_id",e).order("created_at",{ascending:!1});return t||[]}async function d(e){let{data:t,error:n}=await a.from("employee_invitations").update({status:"accepted",accepted_at:new Date().toISOString()}).eq("invite_token",e).eq("status","pending").select().single();if(n)throw n;return t}async function c(e){let{error:t}=await a.from("employee_invitations").update({status:"cancelled"}).eq("id",e);if(t)throw t}async function u(e){let{data:t}=await a.from("partner_invitations").select("*").eq("invite_token",e).eq("status","pending").single();if(t)return t.expires_at&&new Date(t.expires_at)<new Date?null:{type:"partner",data:t};let{data:n}=await a.from("employee_invitations").select("*").eq("invite_token",e).eq("status","pending").single();return n?n.expires_at&&new Date(n.expires_at)<new Date?null:{type:"employee",data:n}:null}function p(e){let t=window.location.origin;return`${t}/invite/?token=${e}`}async function m(e){try{let{data:{session:a}}=await t.supabase.auth.getSession();if(!a)return{success:!1,error:"인증 필요"};let n=p(e.inviteToken),i=await fetch("https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-invite-email",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${a.access_token}`},body:JSON.stringify({email:e.email,name:e.name,role:e.role,inviteUrl:n,companyName:e.companyName})}),s=await i.json();if(!i.ok)return{success:!1,error:s.error||"이메일 발송 실패"};return{success:!0}}catch(e){return{success:!1,error:e.message||"이메일 발송 오류"}}}e.s(["acceptEmployeeInvitation",()=>d,"acceptPartnerInvitation",()=>s,"cancelEmployeeInvitation",()=>c,"cancelPartnerInvitation",()=>r,"createEmployeeInvitation",()=>o,"createPartnerInvitation",()=>n,"getEmployeeInvitations",()=>l,"getInviteUrl",()=>p,"getPartnerInvitations",()=>i,"sendInviteEmail",()=>m,"validateInviteToken",()=>u])},66705,e=>{"use strict";var t=e.i(7471);async function a(e){let{data:a}=await t.supabase.from("doc_templates").select("*").eq("id",e.templateId).single();if(!a)throw Error("템플릿을 찾을 수 없습니다");let{data:n,error:i}=await t.supabase.from("documents").insert({company_id:e.companyId,template_id:e.templateId,deal_id:e.dealId||null,name:e.name,status:"draft",content_json:a.content_json,version:1,created_by:e.createdBy}).select().single();if(i)throw i;return n}async function n(e){let{data:a,error:n}=await t.supabase.from("documents").insert({company_id:e.companyId,deal_id:e.dealId||null,name:e.name,status:"draft",content_json:{type:e.type,sections:[],metadata:{}},version:1,created_by:e.createdBy}).select().single();if(n)throw n;return a}function i(e,t){let a=JSON.stringify(e);for(let[e,n]of Object.entries(t))a=a.replace(RegExp(`\\{\\{${e}\\}\\}`,"g"),n);return JSON.parse(a)}async function s(e){let{data:a}=await t.supabase.from("documents").select("version").eq("id",e.documentId).single(),n=(a?.version||0)+1;await t.supabase.from("doc_revisions").insert({document_id:e.documentId,author_id:e.authorId,changes_json:e.contentJson,comment:e.comment||null,version:n}),await t.supabase.from("documents").update({content_json:e.contentJson,version:n}).eq("id",e.documentId)}async function r(e){let{error:a}=await t.supabase.from("documents").update({status:"review"}).eq("id",e);if(a)throw a}async function o(a,n,i){await t.supabase.from("doc_approvals").insert({document_id:a,approver_id:n,status:"approved",comment:i||null,signed_at:new Date().toISOString()}),await t.supabase.from("documents").update({status:"approved"}).eq("id",a);let{data:s}=await t.supabase.from("documents").select("deal_id, name, company_id").eq("id",a).single();if(s?.deal_id){let{dispatchBusinessEvent:t}=await e.A(42016);if(await t({dealId:s.deal_id,eventType:"document_approved",userId:n,referenceId:a,referenceTable:"documents",summary:{title:s.name}}),s.company_id){let{onDocumentApproved:t}=await e.A(39241);await t({documentId:a,companyId:s.company_id,approverId:n})}}}async function l(a,n){let{error:i}=await t.supabase.from("documents").update({status:"locked",locked_at:new Date().toISOString()}).eq("id",a);if(i)throw i;let{data:s}=await t.supabase.from("documents").select("deal_id, name").eq("id",a).single();if(s?.deal_id&&n){let{dispatchBusinessEvent:t}=await e.A(42016);await t({dealId:s.deal_id,eventType:"document_locked",userId:n,referenceId:a,referenceTable:"documents",summary:{title:s.name}})}}e.s(["DOC_STATUS",0,{draft:{label:"초안",bg:"bg-gray-500/10",text:"text-gray-400"},review:{label:"검토중",bg:"bg-yellow-500/10",text:"text-yellow-400"},approved:{label:"승인",bg:"bg-blue-500/10",text:"text-blue-400"},executed:{label:"체결",bg:"bg-green-500/10",text:"text-green-400"},locked:{label:"잠금",bg:"bg-purple-500/10",text:"text-purple-400"}},"DOC_TYPES",0,[{value:"contract",label:"계약서"},{value:"contract_service",label:"용역계약서"},{value:"contract_sales",label:"매매계약서"},{value:"contract_outsource",label:"업무위탁계약서"},{value:"contract_labor",label:"근로계약서"},{value:"contract_lease",label:"임대차계약서"},{value:"contract_partnership",label:"파트너십계약서"},{value:"invoice",label:"견적서"},{value:"quote",label:"제안서"},{value:"sow",label:"업무기술서(SOW)"},{value:"nda",label:"비밀유지계약(NDA)"},{value:"approval_doc",label:"품의서"},{value:"expense_report",label:"지출결의서"},{value:"mou",label:"양해각서(MOU)"}],"approveDocument",()=>o,"createBlankDocument",()=>n,"createFromTemplate",()=>a,"fillVariables",()=>i,"lockDocument",()=>l,"saveRevision",()=>s,"submitForReview",()=>r])},64130,e=>{"use strict";let t=e.i(7471).supabase,a=[{value:"pending",label:"대기",bg:"bg-gray-500/10",text:"text-gray-500",dot:"bg-gray-400"},{value:"sent",label:"발송",bg:"bg-blue-500/10",text:"text-blue-500",dot:"bg-blue-400"},{value:"viewed",label:"열람",bg:"bg-yellow-500/10",text:"text-yellow-600",dot:"bg-yellow-400"},{value:"signed",label:"서명완료",bg:"bg-green-500/10",text:"text-green-600",dot:"bg-green-500"},{value:"rejected",label:"거부",bg:"bg-red-500/10",text:"text-red-500",dot:"bg-red-400"},{value:"expired",label:"만료",bg:"bg-gray-500/10",text:"text-gray-400",dot:"bg-gray-300"}];function n(e){return a.find(t=>t.value===e)||a[0]}async function i(e){let a=new Date;a.setDate(a.getDate()+14);let{data:n,error:i}=await t.from("signature_requests").insert({company_id:e.companyId,document_id:e.documentId,title:e.title,status:"pending",signer_name:e.signerName,signer_email:e.signerEmail,signer_phone:e.signerPhone||null,expires_at:a.toISOString(),created_by:e.createdBy}).select().single();if(i)throw i;return n}async function s(e,a){let n=t.from("signature_requests").select("*, documents(name, status)").eq("company_id",e).order("created_at",{ascending:!1});a&&(n=n.eq("status",a));let{data:i,error:s}=await n;if(s)throw s;return i||[]}async function r(e){let{data:a,error:n}=await t.from("signature_requests").select("*").eq("document_id",e).order("created_at",{ascending:!1});if(n)throw n;return a||[]}async function o(e,a,n){let i={status:a,...n};"sent"===a?i.sent_at=new Date().toISOString():"viewed"===a?i.viewed_at=new Date().toISOString():"signed"===a&&(i.signed_at=new Date().toISOString());let{data:s,error:r}=await t.from("signature_requests").update(i).eq("id",e).select().single();if(r)throw r;return s}async function l(a,n,i){let{data:s,error:r}=await t.from("signature_requests").update({status:"signed",signed_at:new Date().toISOString(),signature_data:n,ip_address:i||null}).eq("id",a).select().single();if(r)throw r;if(s?.document_id){let{data:a}=await t.from("signature_requests").select("id, status").eq("document_id",s.document_id);if((a||[]).length>0&&(a||[]).every(e=>"signed"===e.status)){let{data:a}=await t.from("documents").select("id, status, company_id, deal_id").eq("id",s.document_id).single();if(a){if("approved"!==a.status&&"locked"!==a.status){let{approveDocument:t}=await e.A(90726);await t(a.id,"system","전체 서명 완료로 자동 승인")}let{lockDocument:t}=await e.A(90726);await t(a.id,"system")}}}return s}async function d(e){let{data:a,error:n}=await t.from("signature_requests").update({status:"expired"}).eq("id",e).select().single();if(n)throw n;return a}async function c(e){let{documentId:a,companyId:n,appliedBy:i}=e,{data:s}=await t.from("companies").select("id, name, seal_url").eq("id",n).single();if(!s?.seal_url)throw Error("직인 이미지가 등록되지 않았습니다. 설정에서 직인을 먼저 업로드하세요.");return await t.from("documents").update({seal_applied:!0}).eq("id",a),await t.from("signature_requests").insert({company_id:n,document_id:a,title:"회사 직인 적용",status:"signed",signer_name:s.name||"회사 직인",signer_email:"seal@company",signed_at:new Date().toISOString(),signature_data:{type:"seal",data:s.seal_url},created_by:i}),{success:!0,sealUrl:s.seal_url}}e.s(["SIGNATURE_STATUS",0,a,"applyCompanySeal",()=>c,"cancelSignature",()=>d,"createSignatureRequest",()=>i,"getDocumentSignatures",()=>r,"getSignatureRequests",()=>s,"getSignatureStatusInfo",()=>n,"saveSignature",()=>l,"updateSignatureStatus",()=>o])},53051,53845,e=>{"use strict";var t=e.i(7471);let a=t.supabase,n={document_created:"문서 생성",signing_requested:"서명 요청",email_sent:"이메일 발송",document_opened:"문서 열람",document_viewed:"문서 확인",signature_drawn:"서명 입력 (직접 그리기)",signature_typed:"서명 입력 (텍스트)",signature_submitted:"서명 제출",document_completed:"서명 완료",document_locked:"문서 잠금"};async function i(e,t){let{data:n,error:i}=await a.from("hr_contract_packages").select("id, notes").eq("id",e).single();if(i)throw Error(`감사추적 기록 실패 — 패키지 조회 오류: ${i.message}`);if(!n)throw Error(`감사추적 기록 실패 — 패키지를 찾을 수 없습니다: ${e}`);let s={};if(n.notes)try{let e=JSON.parse(n.notes);s="object"!=typeof e||null===e||Array.isArray(e)?Array.isArray(e)?{audit_trail:e}:{text:String(e)}:e}catch{s={text:n.notes}}let r=Array.isArray(s.audit_trail)?s.audit_trail:[];r.push({action:t.action,timestamp:t.timestamp||new Date().toISOString(),actor:t.actor,...t.ip?{ip:t.ip}:{},...t.userAgent?{userAgent:t.userAgent}:{},...t.details?{details:t.details}:{}}),s.audit_trail=r;let{error:o}=await a.from("hr_contract_packages").update({notes:JSON.stringify(s)}).eq("id",e);if(o)throw Error(`감사추적 기록 실패 — DB 업데이트 오류: ${o.message}`)}async function s(e){let{data:t,error:n}=await a.from("hr_contract_packages").select("notes").eq("id",e).single();if(n)throw Error(`감사추적 조회 실패: ${n.message}`);if(!t?.notes)return[];try{let e=JSON.parse(t.notes);if(Array.isArray(e))return e;if("object"==typeof e&&null!==e&&Array.isArray(e.audit_trail))return e.audit_trail}catch{}return[]}function r(e){let{packageTitle:t,companyName:a,employeeName:i,signerEmail:s,documentNames:r,auditEntries:o,documentHash:l}=e,d=new Date().toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1}),c=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),u=o.map((e,t)=>`
      <tr${t%2==1?' class="alt"':""}>
        <td class="seq">${t+1}</td>
        <td class="ts">${c((e=>{try{return new Date(e).toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}catch{return e}})(e.timestamp))}</td>
        <td class="action">${c(n[e.action]||e.action)}</td>
        <td class="actor">${c(e.actor)}</td>
        <td class="ip">${e.ip?c(e.ip):"-"}</td>
        <td class="details">${e.details?c(e.details):"-"}</td>
      </tr>`).join("\n"),p=r.map((e,t)=>`<li>${t+1}. ${c(e)}</li>`).join("\n");return`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>감사추적인증서 — ${c(t)}</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 15mm;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI',
                   'Noto Sans KR', sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      line-height: 1.6;
      background: #f5f5f5;
    }

    .certificate {
      max-width: 210mm;
      margin: 0 auto;
      background: #fff;
      padding: 40px 36px;
    }

    /* ── Header ── */
    .header {
      text-align: center;
      border-bottom: 3px double #1a1a1a;
      padding-bottom: 20px;
      margin-bottom: 28px;
    }

    .header h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }

    .header .subtitle {
      font-size: 13px;
      color: #666;
      font-weight: 400;
    }

    /* ── Section ── */
    .section {
      margin-bottom: 24px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #1a1a1a;
      border-left: 4px solid #2563eb;
      padding-left: 10px;
      margin-bottom: 12px;
    }

    /* ── Info Grid ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 24px;
    }

    .info-row {
      display: flex;
      gap: 8px;
    }

    .info-label {
      font-weight: 600;
      color: #555;
      min-width: 80px;
      flex-shrink: 0;
    }

    .info-value {
      color: #1a1a1a;
      word-break: break-all;
    }

    /* ── Document List ── */
    .doc-list {
      list-style: none;
      padding: 0;
    }

    .doc-list li {
      padding: 6px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      margin-bottom: 4px;
      font-size: 11px;
    }

    /* ── Timeline Table ── */
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }

    .timeline-table th {
      background: #1e293b;
      color: #fff;
      padding: 8px 6px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
    }

    .timeline-table th:first-child { border-radius: 6px 0 0 0; }
    .timeline-table th:last-child { border-radius: 0 6px 0 0; }

    .timeline-table td {
      padding: 7px 6px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }

    .timeline-table tr.alt td {
      background: #f8fafc;
    }

    .timeline-table .seq { width: 30px; text-align: center; color: #94a3b8; }
    .timeline-table .ts { width: 140px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .timeline-table .action { width: 140px; font-weight: 600; color: #1e40af; }
    .timeline-table .actor { width: 120px; }
    .timeline-table .ip { width: 110px; color: #64748b; font-family: monospace; font-size: 10px; }
    .timeline-table .details { color: #475569; }

    /* ── Hash Section ── */
    .hash-box {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 14px 16px;
    }

    .hash-label {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .hash-value {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 11px;
      color: #1e293b;
      word-break: break-all;
      line-height: 1.5;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
    }

    .legal-notice {
      font-size: 11px;
      color: #475569;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .generated-at {
      font-size: 10px;
      color: #94a3b8;
    }

    .system-name {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <!-- Header -->
    <div class="header">
      <h1>감사추적인증서</h1>
      <div class="subtitle">Audit Trail Certificate</div>
    </div>

    <!-- Document Info -->
    <div class="section">
      <div class="section-title">문서 정보</div>
      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">계약명</span>
          <span class="info-value">${c(t)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">회사명</span>
          <span class="info-value">${c(a)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">서명자</span>
          <span class="info-value">${c(i)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <span class="info-value">${c(s)}</span>
        </div>
        <div class="info-row" style="grid-column: span 2;">
          <span class="info-label">문서 수</span>
          <span class="info-value">${r.length}건</span>
        </div>
      </div>
    </div>

    <!-- Document List -->
    <div class="section">
      <div class="section-title">포함 문서</div>
      <ul class="doc-list">
        ${p}
      </ul>
    </div>

    <!-- Audit Timeline -->
    <div class="section">
      <div class="section-title">감사 추적 이력</div>
      <table class="timeline-table">
        <thead>
          <tr>
            <th>#</th>
            <th>일시</th>
            <th>활동</th>
            <th>수행자</th>
            <th>IP 주소</th>
            <th>상세</th>
          </tr>
        </thead>
        <tbody>
          ${u}
        </tbody>
      </table>
    </div>

    <!-- Document Integrity -->
    <div class="section">
      <div class="section-title">문서 무결성 검증</div>
      <div class="hash-box">
        <div class="hash-label">SHA-256 해시값</div>
        <div class="hash-value">${c(l)}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p class="legal-notice">
        본 인증서는 전자서명법 제3조에 따라 전자서명의 진정성을 증명합니다
      </p>
      <p class="generated-at">생성일시: ${c(d)}</p>
      <p class="system-name">OwnerView 전자서명 시스템</p>
    </div>
  </div>
</body>
</html>`}e.s(["generateAuditTrailCertificateHTML",()=>r,"getAuditTrail",()=>s,"logAuditTrail",()=>i],53051);let o=t.supabase;async function l(e){let t=new TextEncoder().encode(e);return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",t))).map(e=>e.toString(16).padStart(2,"0")).join("")}async function d(e){let{data:t,error:a}=await o.from("hr_contract_package_items").select("id, sort_order, signature_data, documents(content_json)").eq("package_id",e).order("sort_order");if(a)throw Error(`패키지 아이템 조회 실패: ${a.message}`);if(!t||0===t.length)throw Error("패키지에 문서가 없습니다");let n=[];for(let e of t)e.documents?.content_json&&n.push(JSON.stringify(e.documents.content_json)),e.signature_data&&n.push(JSON.stringify(e.signature_data));return l(n.join("|"))}async function c(e,t){let{data:a,error:n}=await o.from("hr_contract_packages").select("notes").eq("id",e).single();if(n)throw Error(`패키지 조회 실패: ${n.message}`);let i={};if(a?.notes)try{i=JSON.parse(a.notes)}catch{i={text:a.notes}}i.document_hash=t,i.hash_generated_at=new Date().toISOString();let{error:s}=await o.from("hr_contract_packages").update({notes:JSON.stringify(i)}).eq("id",e);if(s)throw Error(`해시 저장 실패: ${s.message}`)}async function u(e){let{data:t,error:a}=await o.from("hr_contract_packages").select("notes").eq("id",e).single();if(a)throw Error(`패키지 조회 실패: ${a.message}`);let n="";if(t?.notes)try{n=JSON.parse(t.notes).document_hash||""}catch{}if(!n)throw Error("저장된 해시가 없습니다. 먼저 storeDocumentHash를 호출하세요.");let i=await d(e);return{valid:n===i,storedHash:n,currentHash:i}}e.s(["generatePackageHash",()=>d,"storeDocumentHash",()=>c,"verifyDocumentIntegrity",()=>u],53845)},39241,e=>{e.v(t=>Promise.all(["static/chunks/7e1d3e7875da82d8.js"].map(t=>e.l(t))).then(()=>t(90001)))},33094,e=>{e.v(t=>Promise.all(["static/chunks/4147fc1dc4d9bed2.js"].map(t=>e.l(t))).then(()=>t(70869)))},90726,e=>{e.v(e=>Promise.resolve().then(()=>e(66705)))},48503,e=>{e.v(t=>Promise.all(["static/chunks/adabfc2d4bff09a9.js"].map(t=>e.l(t))).then(()=>t(15833)))},70653,e=>{e.v(t=>Promise.all(["static/chunks/049ce48f7172c019.js"].map(t=>e.l(t))).then(()=>t(24154)))},95111,e=>{e.v(t=>Promise.all(["static/chunks/dfff2fc9aec5c357.js"].map(t=>e.l(t))).then(()=>t(38201)))}]);