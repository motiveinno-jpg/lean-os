(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,47891,23894,e=>{"use strict";e.i(47167);var t=e.i(7471),a=e.i(59771),n=e.i(35429);let i=t.supabase;async function r(e){let{data:t,error:a}=await i.from("expense_requests").insert({company_id:e.companyId,requester_id:e.requesterId,deal_id:e.dealId||null,title:e.title,description:e.description||null,amount:e.amount,category:e.category||"general",receipt_urls:e.receiptUrls||[],status:"pending"}).select().single();if(a)throw a;return t&&o(e.companyId,e.requesterId,t).catch(e=>{console.error("Auto expense approval creation failed:",e)}),t}async function o(t,a,n){try{let i=Number(n.amount);if(i<1e5)return;let{createApprovalRequest:r}=await e.A(33094);await r({companyId:t,requestType:"expense",requestId:n.id,requesterId:a,title:`[경비] ${n.title}`,amount:i,description:n.description||`경비 청구: ${n.title}
금액: ₩${i.toLocaleString()}
카테고리: ${n.category}`})}catch(e){console.error("autoCreateExpenseApproval failed:",e)}}async function s(e,t){let a=i.from("expense_requests").select("*, users:requester_id(name, email), deals(name)").eq("company_id",e).order("created_at",{ascending:!1});t&&(a=a.eq("status",t));let{data:n}=await a;return n||[]}async function c(e){let{error:t}=await i.from("expense_approvals").insert({company_id:e.companyId,expense_id:e.expenseId,approver_id:e.approverId,level:1,status:"approved",comment:e.comment||null,decided_at:new Date().toISOString()});if(t)throw t;let{data:r,error:o}=await i.from("expense_requests").update({status:"approved",updated_at:new Date().toISOString()}).eq("id",e.expenseId).select("id, title, amount, deal_id").single();if(o)throw await i.from("expense_approvals").delete().eq("expense_id",e.expenseId).eq("approver_id",e.approverId).eq("status","approved"),o;if(r)try{let t=Number(r.amount||0);if(t>0){let i=await (0,n.resolveBank)(e.companyId,"expense");await (0,a.createQueueEntry)({companyId:e.companyId,amount:t,description:`[경비승인] ${r.title}`,costType:"expense",dealId:r.deal_id||void 0,dealBankAccountId:i?.id||null,sourceType:"expense_request",sourceId:e.expenseId})}}catch(e){console.error("Expense payment queue creation failed:",e)}}async function d(e){let{error:t}=await i.from("expense_approvals").insert({company_id:e.companyId,expense_id:e.expenseId,approver_id:e.approverId,level:1,status:"rejected",comment:e.comment||null,decided_at:new Date().toISOString()});if(t)throw t;let{error:a}=await i.from("expense_requests").update({status:"rejected",updated_at:new Date().toISOString()}).eq("id",e.expenseId);if(a)throw await i.from("expense_approvals").delete().eq("expense_id",e.expenseId).eq("approver_id",e.approverId).eq("status","rejected"),a}async function l(e){let{error:t}=await i.from("expense_requests").update({status:"paid",updated_at:new Date().toISOString()}).eq("id",e);if(t)throw t}e.s(["EXPENSE_CATEGORIES",0,[{value:"general",label:"일반 경비"},{value:"travel",label:"출장비"},{value:"entertainment",label:"접대비"},{value:"supplies",label:"소모품"},{value:"transport",label:"교통비"},{value:"education",label:"교육비"},{value:"equipment",label:"장비 구매"},{value:"subscription",label:"구독료"},{value:"meals",label:"식비"},{value:"other",label:"기타"}],"EXPENSE_STATUS",0,{pending:{label:"승인 대기",bg:"bg-yellow-500/10",text:"text-yellow-400"},approved:{label:"승인",bg:"bg-green-500/10",text:"text-green-400"},rejected:{label:"반려",bg:"bg-red-500/10",text:"text-red-400"},paid:{label:"지급 완료",bg:"bg-blue-500/10",text:"text-blue-400"}},"approveExpense",()=>c,"createExpenseRequest",()=>r,"getExpenseRequests",()=>s,"markExpensePaid",()=>l,"rejectExpense",()=>d],23894);let u=t.supabase;async function p(e){let a=[],[n,i,r,o,s,c,d]=await Promise.all([t.supabase.from("payment_queue").select("id, amount, description, created_at, deals(name)").eq("company_id",e).eq("status","pending").order("created_at",{ascending:!1}),u.from("expense_requests").select("id, title, amount, category, created_at, users:requester_id(name), deals(name)").eq("company_id",e).eq("status","pending").order("created_at",{ascending:!1}),t.supabase.from("documents").select("id, name, status, created_at, deals(name)").eq("company_id",e).eq("status","review").order("created_at",{ascending:!1}),u.from("leave_requests").select("id, leave_type, days, reason, created_at, employees(name)").eq("company_id",e).eq("status","pending").order("created_at",{ascending:!1}),u.from("signature_requests").select("id, signer_name, status, created_at, documents(name)").eq("company_id",e).eq("status","pending").order("created_at",{ascending:!1}),t.supabase.from("deal_cost_schedule").select("id, item_name, amount, created_at, deals(name)").eq("company_id",e).eq("approved",!1).order("created_at",{ascending:!1}),u.from("approval_requests").select("id, title, amount, request_type, created_at, users:requester_id(name)").eq("company_id",e).eq("status","pending").order("created_at",{ascending:!1})]);(n.data||[]).forEach(e=>{a.push({id:e.id,type:"payment",title:e.description||"결제 승인 요청",amount:Number(e.amount||0),createdAt:e.created_at,urgency:Number(e.amount||0)>=5e6?"high":"medium",dealName:e.deals?.name})}),(i.data||[]).forEach(e=>{a.push({id:e.id,type:"expense",title:e.title||"경비 청구",amount:Number(e.amount||0),requester:e.users?.name,createdAt:e.created_at,urgency:Number(e.amount||0)>=1e6?"high":"low",dealName:e.deals?.name})}),(r.data||[]).forEach(e=>{a.push({id:e.id,type:"document",title:e.name||"문서 검토",createdAt:e.created_at,urgency:"medium",dealName:e.deals?.name})}),(o.data||[]).forEach(e=>{a.push({id:e.id,type:"leave",title:`${e.employees?.name||"직원"} ${{annual:"연차",sick:"병가",personal:"개인사유",maternity:"출산",paternity:"육아",compensation:"보상"}[e.leave_type]||e.leave_type} ${e.days}일`,createdAt:e.created_at,urgency:"low"})}),(s.data||[]).forEach(e=>{a.push({id:e.id,type:"signature",title:`서명 요청: ${e.signer_name||""}`,createdAt:e.created_at,urgency:"medium",metadata:{documentName:e.documents?.name}})}),(c.data||[]).forEach(e=>{a.push({id:e.id,type:"cost",title:e.item_name||"비용 승인",amount:Number(e.amount||0),createdAt:e.created_at,urgency:Number(e.amount||0)>=3e6?"high":"medium",dealName:e.deals?.name})});let l={expense:"경비",payment:"결제",leave:"휴가",overtime:"초과근무",purchase:"구매",contract:"계약",travel:"출장",card_expense:"법인카드",equipment:"장비",custom:"기타"};(d.data||[]).forEach(e=>{a.push({id:e.id,type:"approval",title:e.title||`${l[e.request_type]||"결재"} 승인 요청`,amount:Number(e.amount||0),requester:e.users?.name,createdAt:e.created_at,urgency:Number(e.amount||0)>=5e6?"high":Number(e.amount||0)>=1e6?"medium":"low"})});let p={high:0,medium:1,low:2};return a.sort((e,t)=>{let a=p[e.urgency]-p[t.urgency];return 0!==a?a:new Date(t.createdAt).getTime()-new Date(e.createdAt).getTime()}),a}async function m(e){let[a,n,i,r,o,s,c]=await Promise.all([t.supabase.from("payment_queue").select("id",{count:"exact",head:!0}).eq("company_id",e).eq("status","pending"),u.from("expense_requests").select("id",{count:"exact",head:!0}).eq("company_id",e).eq("status","pending"),t.supabase.from("documents").select("id",{count:"exact",head:!0}).eq("company_id",e).eq("status","review"),u.from("leave_requests").select("id",{count:"exact",head:!0}).eq("company_id",e).eq("status","pending"),u.from("signature_requests").select("id",{count:"exact",head:!0}).eq("company_id",e).eq("status","pending"),t.supabase.from("deal_cost_schedule").select("id",{count:"exact",head:!0}).eq("company_id",e).eq("approved",!1),u.from("approval_requests").select("id",{count:"exact",head:!0}).eq("company_id",e).eq("status","pending")]),d=a.count||0,l=n.count||0,p=i.count||0,m=r.count||0,y=o.count||0,_=s.count||0,f=c.count||0;return{total:d+l+p+m+y+_+f,payments:d,expenses:l,documents:p,leaves:m,signatures:y,costs:_,approvals:f}}async function y(n,i,r,o){switch(i){case"payment":await (0,a.approvePayment)(r,o);break;case"expense":await c({companyId:n,expenseId:r,approverId:o});break;case"document":await t.supabase.from("documents").update({status:"approved",updated_at:new Date().toISOString()}).eq("id",r),await t.supabase.from("doc_approvals").insert({document_id:r,approver_id:o,status:"approved",signed_at:new Date().toISOString()});break;case"leave":await u.from("leave_requests").update({status:"approved",approved_by:o,approved_at:new Date().toISOString()}).eq("id",r);break;case"signature":await u.from("signature_requests").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",r);break;case"cost":await t.supabase.from("deal_cost_schedule").update({approved:!0,approved_at:new Date().toISOString()}).eq("id",r);break;case"approval":{let{data:t}=await u.from("approval_requests").select("id, current_stage").eq("id",r).single();if(t){let{data:a}=await u.from("approval_steps").select("id").eq("request_id",r).eq("stage",t.current_stage).eq("status","pending").limit(1).single();if(a){let{approveStep:t}=await e.A(33094);await t(a.id,o)}}}}}async function _(e){try{let{data:{session:a}}=await t.supabase.auth.getSession();if(!a)return{success:!1,error:"인증 필요"};let n=await fetch("https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-approval-email",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${a.access_token}`},body:JSON.stringify(e)}),i=await n.json();if(!n.ok)return{success:!1,error:i.error||"이메일 발송 실패"};return{success:!0}}catch(e){return{success:!1,error:e.message||"이메일 발송 오류"}}}async function f(e,t,a){let n=0,i=0;for(let r of t)try{await y(e,r.type,r.id,a),n++}catch{i++}return{succeeded:n,failed:i}}async function g(e){let{data:t}=await u.from("recurring_payments").select("*, bank_accounts(bank_name, account_number)").eq("company_id",e).order("category").order("name");return t||[]}async function h(e){let t={company_id:e.companyId,name:e.name,amount:e.amount,category:e.category};e.id&&(t.id=e.id),void 0!==e.recipientName&&(t.recipient_name=e.recipientName),void 0!==e.recipientAccount&&(t.recipient_account=e.recipientAccount),void 0!==e.recipientBank&&(t.recipient_bank=e.recipientBank),void 0!==e.bankAccountId&&(t.bank_account_id=e.bankAccountId),void 0!==e.frequency&&(t.frequency=e.frequency),void 0!==e.dayOfMonth&&(t.day_of_month=e.dayOfMonth),void 0!==e.isActive&&(t.is_active=e.isActive),void 0!==e.autoTransferDate&&(t.auto_transfer_date=e.autoTransferDate),void 0!==e.autoTransferAccountId&&(t.auto_transfer_account_id=e.autoTransferAccountId),void 0!==e.autoTransferMemo&&(t.auto_transfer_memo=e.autoTransferMemo);let{data:a,error:n}=await u.from("recurring_payments").upsert(t).select().single();if(n)throw n;return a}async function b(e,t){let a=u.from("payment_batches").select("*, users:approved_by(name)").eq("company_id",e).order("created_at",{ascending:!1});t&&(a=a.eq("status",t));let{data:n}=await a;return n||[]}async function v(e){let{data:t}=await u.from("recurring_payments").select("*").eq("company_id",e).eq("is_active",!0);if(!t||0===t.length)return[];let a=new Date;a.setMonth(a.getMonth()-3);let n=a.toISOString().split("T")[0],{data:i}=await u.from("bank_transactions").select("id, counterparty, amount, transaction_date, description").eq("company_id",e).eq("type","withdrawal").gte("transaction_date",n).order("transaction_date",{ascending:!1}),{data:r}=await u.from("card_transactions").select("id, merchant_name, amount, transaction_date, description").eq("company_id",e).gte("transaction_date",n).order("transaction_date",{ascending:!1}),o=[];for(let e of t){let t=(e.name||"").toLowerCase(),a=(e.recipient_name||"").toLowerCase(),n=null,s="bank";if(i&&(n=i.find(e=>{let n=(e.counterparty||"").toLowerCase(),i=(e.description||"").toLowerCase();return a&&n.includes(a)||n.includes(t)||i.includes(t)})),!n&&r){let e=r.find(e=>{let n=(e.merchant_name||"").toLowerCase(),i=(e.description||"").toLowerCase();return n.includes(t)||i.includes(t)||a&&n.includes(a)});e&&(n=e,s="card")}if(n){let t=Math.abs(Number(n.amount)),a=Number(e.amount);t!==a&&t>0&&(await u.from("recurring_payments").update({amount:t,updated_at:new Date().toISOString()}).eq("id",e.id),o.push({id:e.id,name:e.name,oldAmount:a,newAmount:t,lastTxDate:n.transaction_date,source:s}))}}return o}e.s(["approveAction",()=>y,"bulkApproveActions",()=>f,"getApprovalSummary",()=>m,"getCEOPendingActions",()=>p,"getPaymentBatches",()=>b,"getRecurringPayments",()=>g,"refreshRecurringAmounts",()=>v,"sendApprovalNotificationEmail",()=>_,"upsertRecurringPayment",()=>h],47891)},87304,e=>{"use strict";var t=e.i(47167),a=e.i(7471),n=e.i(59771),i=e.i(47891);let r=a.supabase;function o(e,t,a){let n=Math.round(.045*e),i=Math.round(.03545*e),r=Math.round(.1295*i),o=Math.round(.009*e),s=e<=106e4?0:e<=15e5?Math.round(.02*e):e<=3e6?Math.round(.04*e):e<=5e6?Math.round(.06*e):e<=8e6?Math.round(.1*e):Math.round(.15*e),c=Math.round(.1*s),d=n+i+r+o+s+c;return{employeeId:a,employeeName:t,baseSalary:e,nationalPension:n,healthInsurance:i+r,employmentInsurance:o,incomeTax:s,localIncomeTax:c,deductionsTotal:d,netPay:e-d}}function s(e){let t=new Date(e.startDate),a=Math.floor((new Date(e.endDate).getTime()-t.getTime())/864e5),n=a>=365,i=e.last3MonthsDays||90,r=e.last3MonthsSalary/i;return{retirementPay:n?Math.round(30*r*(a/365)):0,totalDays:a,dailyAvgWage:r,eligible:n}}async function c(e,t){let a=t||`${new Date().getFullYear()}년 ${new Date().getMonth()+1}월`,{data:i}=await r.from("employees").select("id, name, salary, bank_account, bank_name, is_4_insurance, status").eq("company_id",e).eq("status","active");if(!i?.length)throw Error("활성 직원이 없습니다");let s=i.map(e=>{let t=Number(e.salary||0);return t<=0?null:o(t,e.name,e.id)}).filter(Boolean);if(0===s.length)throw Error("급여가 설정된 직원이 없습니다");let c=s.reduce((e,t)=>e+t.netPay,0),{data:d,error:l}=await r.from("payment_batches").insert({company_id:e,name:`${a} 급여`,batch_type:"payroll",total_amount:c,item_count:s.length,status:"draft"}).select().single();if(l)throw l;for(let t of s){let o=i.find(e=>e.id===t.employeeId);await (0,n.createQueueEntry)({companyId:e,amount:t.netPay,description:`${a} 급여 - ${t.employeeName}`,costType:"salary"}).then(async e=>{e&&await r.from("payment_queue").update({batch_id:d.id,payment_type:"payroll",category:"salary",recipient_name:t.employeeName,recipient_account:o?.bank_account||null,recipient_bank:o?.bank_name||null}).eq("id",e.id)})}return{batchId:d.id,items:s}}async function d(e,t){let a=t||`${new Date().getFullYear()}년 ${new Date().getMonth()+1}월`,o=(await (0,i.getRecurringPayments)(e)).filter(e=>e.is_active);if(0===o.length)throw Error("활성 반복결제가 없습니다");let s=o.reduce((e,t)=>e+Number(t.amount||0),0),{data:c,error:d}=await r.from("payment_batches").insert({company_id:e,name:`${a} 고정비`,batch_type:"fixed_cost",total_amount:s,item_count:o.length,status:"draft"}).select().single();if(d)throw d;for(let t of o){let a=await (0,n.createQueueEntry)({companyId:e,amount:Number(t.amount||0),description:`${t.name} (${t.category})`,costType:t.category});a&&await r.from("payment_queue").update({batch_id:c.id,payment_type:"fixed_cost",category:t.category,is_recurring:!0,recurring_rule_id:t.id,recipient_name:t.recipient_name||null,recipient_account:t.recipient_account||null,recipient_bank:t.recipient_bank||null}).eq("id",a.id)}let l=o.map(e=>e.id);return await r.from("recurring_payments").update({last_generated_at:new Date().toISOString()}).in("id",l),{batchId:c.id,count:o.length,totalAmount:s}}async function l(e,t){await r.from("payment_batches").update({status:"approved",approved_by:t,approved_at:new Date().toISOString()}).eq("id",e),await r.from("payment_queue").update({status:"approved",approved_by:t,approved_at:new Date().toISOString()}).eq("batch_id",e).eq("status","pending");let{data:a}=await r.from("payment_batches").select("batch_type, company_id, name").eq("id",e).single();a?.batch_type==="payroll"&&u(e,a.company_id,a.name).catch(e=>{console.error("Payslip email send failed:",e)})}async function u(e,t,n){let{data:i}=await r.from("companies").select("name").eq("id",t).single(),{data:s}=await r.from("payment_queue").select("amount, description, recipient_name, category").eq("batch_id",e).eq("payment_type","payroll");if(!s?.length)return{sent:0,failed:0};let{data:c}=await r.from("employees").select("id, name, email, salary, is_4_insurance").eq("company_id",t).eq("status","active");if(!c?.length)return{sent:0,failed:0};let d=n.replace(/\s*급여\s*$/,"")||n,{data:{session:l}}=await a.supabase.auth.getSession();if(!l)return{sent:0,failed:0};let u=0,p=0;for(let e of c){if(!e.email){p++;continue}let t=Number(e.salary||0);if(t<=0){p++;continue}let a=o(t,e.name,e.id);try{(await fetch("https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-payslip-email",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${l.access_token}`},body:JSON.stringify({email:e.email,employeeName:e.name,companyName:i?.name||"",monthLabel:d,baseSalary:a.baseSalary,nationalPension:a.nationalPension,healthInsurance:a.healthInsurance,employmentInsurance:a.employmentInsurance,incomeTax:a.incomeTax,localIncomeTax:a.localIncomeTax,deductionsTotal:a.deductionsTotal,netPay:a.netPay})})).ok?u++:p++}catch{p++}}return{sent:u,failed:p}}async function p(e){let{data:a}=await r.from("payment_batches").select("*").eq("id",e).single();if(!a||"approved"!==a.status)return{triggered:!1};let{data:n}=await r.from("payment_queue").select("id, amount, description, recipient_name, recipient_account, recipient_bank").eq("batch_id",e).eq("status","approved");if(!n?.length)return{triggered:!1};await r.from("payment_batches").update({status:"executing"}).eq("id",e);let i=t.default.env.NEXT_PUBLIC_N8N_PAYMENT_WEBHOOK||"http://localhost:5678/webhook/payment-batch";try{let t=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({batchId:a.id,batchType:a.batch_type,totalAmount:a.total_amount,payments:n.map(e=>({id:e.id,amount:Number(e.amount),description:e.description,recipientName:e.recipient_name,recipientAccount:e.recipient_account,recipientBank:e.recipient_bank}))})});if(t.ok){let a=(await t.json()).executionId||`n8n-${Date.now()}`;return await r.from("payment_batches").update({n8n_execution_id:a}).eq("id",e),{triggered:!0,executionId:a}}}catch{await r.from("payment_batches").update({status:"approved"}).eq("id",e)}return{triggered:!1}}async function m(e){let{data:t}=await r.from("payment_batches").select("*, users:approved_by(name)").eq("id",e).single(),{data:a}=await r.from("payment_queue").select("*").eq("batch_id",e).order("created_at");return{batch:t,items:a||[]}}async function y(e,t){let a=r.from("payment_batches").select("*, users:approved_by(name)").eq("company_id",e).order("created_at",{ascending:!1});t&&(a=a.eq("status",t));let{data:n}=await a;return(n||[]).map(e=>({id:e.id,name:e.name,batchType:e.batch_type,totalAmount:Number(e.total_amount||0),itemCount:e.item_count||0,status:e.status,approvedBy:e.users?.name,approvedAt:e.approved_at,createdAt:e.created_at}))}e.s(["approveBatch",()=>l,"calculatePayroll",()=>o,"calculateRetirementPay",()=>s,"createFixedCostBatch",()=>d,"createPayrollBatch",()=>c,"getBatchWithItems",()=>m,"getCompanyBatches",()=>y,"sendPayslipEmails",()=>u,"triggerBatchExecution",()=>p])},6789,e=>{"use strict";var t=e.i(7471);let a=t.supabase;async function n(e){let t=new Date;t.setDate(t.getDate()+7);let{data:n,error:i}=await a.from("partner_invitations").insert({company_id:e.companyId,deal_id:e.dealId||null,email:e.email,name:e.name||null,role:"partner",expires_at:t.toISOString()}).select().single();if(i)throw i;return n}async function i(e){let{data:t}=await a.from("partner_invitations").select("*, deals(name)").eq("company_id",e).order("created_at",{ascending:!1});return t||[]}async function r(e){let{data:t,error:n}=await a.from("partner_invitations").update({status:"accepted",accepted_at:new Date().toISOString()}).eq("invite_token",e).eq("status","pending").select().single();if(n)throw n;return t}async function o(e){let{error:t}=await a.from("partner_invitations").update({status:"cancelled"}).eq("id",e);if(t)throw t}async function s(e){let t=new Date;t.setDate(t.getDate()+7);let{data:n,error:i}=await a.from("employee_invitations").insert({company_id:e.companyId,email:e.email,name:e.name||null,role:e.role||"employee",invited_by:e.invitedBy,expires_at:t.toISOString()}).select().single();if(i)throw i;return n}async function c(e){let{data:t}=await a.from("employee_invitations").select("*").eq("company_id",e).order("created_at",{ascending:!1});return t||[]}async function d(e){let{data:t,error:n}=await a.from("employee_invitations").update({status:"accepted",accepted_at:new Date().toISOString()}).eq("invite_token",e).eq("status","pending").select().single();if(n)throw n;return t}async function l(e){let{error:t}=await a.from("employee_invitations").update({status:"cancelled"}).eq("id",e);if(t)throw t}async function u(e){let{data:t}=await a.from("partner_invitations").select("*").eq("invite_token",e).eq("status","pending").single();if(t)return t.expires_at&&new Date(t.expires_at)<new Date?null:{type:"partner",data:t};let{data:n}=await a.from("employee_invitations").select("*").eq("invite_token",e).eq("status","pending").single();return n?n.expires_at&&new Date(n.expires_at)<new Date?null:{type:"employee",data:n}:null}function p(e){let t=window.location.origin;return`${t}/invite/?token=${e}`}async function m(e){try{let{data:{session:a}}=await t.supabase.auth.getSession();if(!a)return{success:!1,error:"인증 필요"};let n=p(e.inviteToken),i=await fetch("https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-invite-email",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${a.access_token}`},body:JSON.stringify({email:e.email,name:e.name,role:e.role,inviteUrl:n,companyName:e.companyName})}),r=await i.json();if(!i.ok)return{success:!1,error:r.error||"이메일 발송 실패"};return{success:!0}}catch(e){return{success:!1,error:e.message||"이메일 발송 오류"}}}e.s(["acceptEmployeeInvitation",()=>d,"acceptPartnerInvitation",()=>r,"cancelEmployeeInvitation",()=>l,"cancelPartnerInvitation",()=>o,"createEmployeeInvitation",()=>s,"createPartnerInvitation",()=>n,"getEmployeeInvitations",()=>c,"getInviteUrl",()=>p,"getPartnerInvitations",()=>i,"sendInviteEmail",()=>m,"validateInviteToken",()=>u])},66705,e=>{"use strict";var t=e.i(7471),a=e.i(94008);async function n(e){let{data:n}=await t.supabase.from("doc_templates").select("*").eq("id",e.templateId).single();if(!n)throw Error("템플릿을 찾을 수 없습니다");let{data:i,error:r}=await t.supabase.from("documents").insert({company_id:e.companyId,template_id:e.templateId,deal_id:e.dealId||null,name:e.name,status:"draft",content_json:n.content_json,version:1,created_by:e.createdBy}).select().single();if(r)throw r;return await (0,a.logAudit)({company_id:e.companyId,user_id:e.createdBy,action:"create",entity_type:"document",entity_id:i.id,entity_name:i.name,metadata:{source:"template",template_id:e.templateId}}),i}async function i(e){let{data:n,error:i}=await t.supabase.from("documents").insert({company_id:e.companyId,deal_id:e.dealId||null,name:e.name,status:"draft",content_json:{type:e.type,sections:[],metadata:{}},version:1,created_by:e.createdBy}).select().single();if(i)throw i;return await (0,a.logAudit)({company_id:e.companyId,user_id:e.createdBy,action:"create",entity_type:"document",entity_id:n.id,entity_name:n.name,metadata:{source:"blank",type:e.type}}),n}function r(e,t){let a=JSON.stringify(e);for(let[e,n]of Object.entries(t))a=a.replace(RegExp(`\\{\\{${e}\\}\\}`,"g"),n);return JSON.parse(a)}async function o(e){let{data:a}=await t.supabase.from("documents").select("version").eq("id",e.documentId).single(),n=(a?.version||0)+1;await t.supabase.from("doc_revisions").insert({document_id:e.documentId,author_id:e.authorId,changes_json:e.contentJson,comment:e.comment||null,version:n}),await t.supabase.from("documents").update({content_json:e.contentJson,version:n}).eq("id",e.documentId)}async function s(e){let{error:a}=await t.supabase.from("documents").update({status:"review"}).eq("id",e);if(a)throw a}async function c(n,i,r){await t.supabase.from("doc_approvals").insert({document_id:n,approver_id:i,status:"approved",comment:r||null,signed_at:new Date().toISOString()}),await t.supabase.from("documents").update({status:"approved"}).eq("id",n);let{data:o}=await t.supabase.from("documents").select("deal_id, name, company_id").eq("id",n).single();if(await (0,a.logAudit)({company_id:o?.company_id||"",user_id:i,action:"approve",entity_type:"document",entity_id:n,entity_name:o?.name,metadata:{comment:r}}),o?.deal_id){let{dispatchBusinessEvent:t}=await e.A(42016);if(await t({dealId:o.deal_id,eventType:"document_approved",userId:i,referenceId:n,referenceTable:"documents",summary:{title:o.name}}),o.company_id){let{onDocumentApproved:t}=await e.A(39241);await t({documentId:n,companyId:o.company_id,approverId:i})}}}async function d(n,i){let{error:r}=await t.supabase.from("documents").update({status:"locked",locked_at:new Date().toISOString()}).eq("id",n);if(r)throw r;let{data:o}=await t.supabase.from("documents").select("deal_id, name, company_id").eq("id",n).single();if(await (0,a.logAudit)({company_id:o?.company_id||"",user_id:i||"system",action:"lock",entity_type:"document",entity_id:n,entity_name:o?.name}),o?.deal_id&&i){let{dispatchBusinessEvent:t}=await e.A(42016);await t({dealId:o.deal_id,eventType:"document_locked",userId:i,referenceId:n,referenceTable:"documents",summary:{title:o.name}})}}e.s(["DOC_STATUS",0,{draft:{label:"초안",bg:"bg-gray-500/10",text:"text-gray-400"},review:{label:"검토중",bg:"bg-yellow-500/10",text:"text-yellow-400"},approved:{label:"승인",bg:"bg-blue-500/10",text:"text-blue-400"},executed:{label:"체결",bg:"bg-green-500/10",text:"text-green-400"},locked:{label:"잠금",bg:"bg-purple-500/10",text:"text-purple-400"}},"DOC_TYPES",0,[{value:"contract",label:"계약서"},{value:"contract_service",label:"용역계약서"},{value:"contract_sales",label:"매매계약서"},{value:"contract_outsource",label:"업무위탁계약서"},{value:"contract_labor",label:"근로계약서"},{value:"contract_lease",label:"임대차계약서"},{value:"contract_partnership",label:"파트너십계약서"},{value:"invoice",label:"견적서"},{value:"quote",label:"제안서"},{value:"sow",label:"업무기술서(SOW)"},{value:"nda",label:"비밀유지계약(NDA)"},{value:"approval_doc",label:"품의서"},{value:"expense_report",label:"지출결의서"},{value:"mou",label:"양해각서(MOU)"}],"approveDocument",()=>c,"createBlankDocument",()=>i,"createFromTemplate",()=>n,"fillVariables",()=>r,"lockDocument",()=>d,"saveRevision",()=>o,"submitForReview",()=>s])},5470,e=>{"use strict";var t=e.i(7471),a=e.i(87304);let n=t.supabase;async function i(e){let{data:t}=await n.from("employees").select("id, name, salary, status").eq("company_id",e).eq("status","active");if(!t?.length)return{items:[],totalGross:0,totalDeductions:0,totalNet:0};let i=[],r=0,o=0,s=0;for(let e of t){let t=Number(e.salary||0);if(t<=0)continue;let n=(0,a.calculatePayroll)(t,e.name,e.id);i.push(n),r+=n.baseSalary,o+=n.deductionsTotal,s+=n.netPay}return{items:i,totalGross:r,totalDeductions:o,totalNet:s}}async function r(e){let{data:t}=await n.from("employees").select("salary").eq("company_id",e).eq("status","active");return(t||[]).reduce((e,t)=>e+Number(t.salary||0),0)}e.s(["getMonthlyTotalSalary",()=>r,"previewPayroll",()=>i])},53051,53845,e=>{"use strict";var t=e.i(7471);let a=t.supabase,n={document_created:"문서 생성",signing_requested:"서명 요청",email_sent:"이메일 발송",document_opened:"문서 열람",document_viewed:"문서 확인",signature_drawn:"서명 입력 (직접 그리기)",signature_typed:"서명 입력 (텍스트)",signature_submitted:"서명 제출",document_completed:"서명 완료",document_locked:"문서 잠금"};async function i(e,t){let{data:n,error:i}=await a.from("hr_contract_packages").select("id, notes").eq("id",e).single();if(i)throw Error(`감사추적 기록 실패 — 패키지 조회 오류: ${i.message}`);if(!n)throw Error(`감사추적 기록 실패 — 패키지를 찾을 수 없습니다: ${e}`);let r={};if(n.notes)try{let e=JSON.parse(n.notes);r="object"!=typeof e||null===e||Array.isArray(e)?Array.isArray(e)?{audit_trail:e}:{text:String(e)}:e}catch{r={text:n.notes}}let o=Array.isArray(r.audit_trail)?r.audit_trail:[];o.push({action:t.action,timestamp:t.timestamp||new Date().toISOString(),actor:t.actor,...t.ip?{ip:t.ip}:{},...t.userAgent?{userAgent:t.userAgent}:{},...t.details?{details:t.details}:{}}),r.audit_trail=o;let{error:s}=await a.from("hr_contract_packages").update({notes:JSON.stringify(r)}).eq("id",e);if(s)throw Error(`감사추적 기록 실패 — DB 업데이트 오류: ${s.message}`)}async function r(e){let{data:t,error:n}=await a.from("hr_contract_packages").select("notes").eq("id",e).single();if(n)throw Error(`감사추적 조회 실패: ${n.message}`);if(!t?.notes)return[];try{let e=JSON.parse(t.notes);if(Array.isArray(e))return e;if("object"==typeof e&&null!==e&&Array.isArray(e.audit_trail))return e.audit_trail}catch{}return[]}function o(e){let{packageTitle:t,companyName:a,employeeName:i,signerEmail:r,documentNames:o,auditEntries:s,documentHash:c}=e,d=new Date().toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1}),l=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),u=s.map((e,t)=>`
      <tr${t%2==1?' class="alt"':""}>
        <td class="seq">${t+1}</td>
        <td class="ts">${l((e=>{try{return new Date(e).toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}catch{return e}})(e.timestamp))}</td>
        <td class="action">${l(n[e.action]||e.action)}</td>
        <td class="actor">${l(e.actor)}</td>
        <td class="ip">${e.ip?l(e.ip):"-"}</td>
        <td class="details">${e.details?l(e.details):"-"}</td>
      </tr>`).join("\n"),p=o.map((e,t)=>`<li>${t+1}. ${l(e)}</li>`).join("\n");return`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>감사추적인증서 — ${l(t)}</title>
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
          <span class="info-value">${l(t)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">회사명</span>
          <span class="info-value">${l(a)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">서명자</span>
          <span class="info-value">${l(i)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <span class="info-value">${l(r)}</span>
        </div>
        <div class="info-row" style="grid-column: span 2;">
          <span class="info-label">문서 수</span>
          <span class="info-value">${o.length}건</span>
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
        <div class="hash-value">${l(c)}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p class="legal-notice">
        본 인증서는 전자서명법 제3조에 따라 전자서명의 진정성을 증명합니다
      </p>
      <p class="generated-at">생성일시: ${l(d)}</p>
      <p class="system-name">OwnerView 전자서명 시스템</p>
    </div>
  </div>
</body>
</html>`}e.s(["generateAuditTrailCertificateHTML",()=>o,"getAuditTrail",()=>r,"logAuditTrail",()=>i],53051);let s=t.supabase;async function c(e){let t=new TextEncoder().encode(e);return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",t))).map(e=>e.toString(16).padStart(2,"0")).join("")}async function d(e){let{data:t,error:a}=await s.from("hr_contract_package_items").select("id, sort_order, signature_data, documents(content_json)").eq("package_id",e).order("sort_order");if(a)throw Error(`패키지 아이템 조회 실패: ${a.message}`);if(!t||0===t.length)throw Error("패키지에 문서가 없습니다");let n=[];for(let e of t)e.documents?.content_json&&n.push(JSON.stringify(e.documents.content_json)),e.signature_data&&n.push(JSON.stringify(e.signature_data));return c(n.join("|"))}async function l(e,t){let{data:a,error:n}=await s.from("hr_contract_packages").select("notes").eq("id",e).single();if(n)throw Error(`패키지 조회 실패: ${n.message}`);let i={};if(a?.notes)try{i=JSON.parse(a.notes)}catch{i={text:a.notes}}i.document_hash=t,i.hash_generated_at=new Date().toISOString();let{error:r}=await s.from("hr_contract_packages").update({notes:JSON.stringify(i)}).eq("id",e);if(r)throw Error(`해시 저장 실패: ${r.message}`)}async function u(e){let{data:t,error:a}=await s.from("hr_contract_packages").select("notes").eq("id",e).single();if(a)throw Error(`패키지 조회 실패: ${a.message}`);let n="";if(t?.notes)try{n=JSON.parse(t.notes).document_hash||""}catch{}if(!n)throw Error("저장된 해시가 없습니다. 먼저 storeDocumentHash를 호출하세요.");let i=await d(e);return{valid:n===i,storedHash:n,currentHash:i}}e.s(["generatePackageHash",()=>d,"storeDocumentHash",()=>l,"verifyDocumentIntegrity",()=>u],53845)},39241,e=>{e.v(t=>Promise.all(["static/chunks/257c4fea2a281193.js"].map(t=>e.l(t))).then(()=>t(90001)))},33094,e=>{e.v(t=>Promise.all(["static/chunks/4147fc1dc4d9bed2.js"].map(t=>e.l(t))).then(()=>t(70869)))},90726,e=>{e.v(e=>Promise.resolve().then(()=>e(66705)))},48503,e=>{e.v(t=>Promise.all(["static/chunks/adabfc2d4bff09a9.js"].map(t=>e.l(t))).then(()=>t(15833)))},70653,e=>{e.v(t=>Promise.all(["static/chunks/049ce48f7172c019.js"].map(t=>e.l(t))).then(()=>t(24154)))},95111,e=>{e.v(t=>Promise.all(["static/chunks/dfff2fc9aec5c357.js"].map(t=>e.l(t))).then(()=>t(38201)))},52196,e=>{e.v(e=>Promise.resolve().then(()=>e(87304)))}]);