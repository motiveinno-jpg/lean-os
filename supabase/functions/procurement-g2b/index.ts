// 나라장터 키는 기존 Edge 비밀설정을 재사용한다. 서버 service-role만 호출 가능.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
serve(async (req:Request) => {
  const secret=Deno.env.get("PROCUREMENT_PROXY_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!secret || req.headers.get("authorization")!==`Bearer ${secret}`) return Response.json({error:"unauthorized"},{status:401});
  try{
    const body=await req.json();
    if(!Deno.env.get("PROCUREMENT_COMPANY_ID") || body.companyId!==Deno.env.get("PROCUREMENT_COMPANY_ID")) return Response.json({error:"company scope"},{status:403});
    const key=Deno.env.get("G2B_SERVICE_KEY")||Deno.env.get("DATA_GO_KR_API_KEY");
    if(!key) return Response.json({error:"나라장터 인증키 없음"},{status:503});
    const p=body.parameters||{};
    if(!/^\d{12}$/.test(p.inqryBgnDt)||!/^\d{12}$/.test(p.inqryEndDt)||!/^\d{1,2}$/.test(String(p.pageNo))||Number(p.pageNo)<1||Number(p.pageNo)>20||typeof p.bidNtceNm!=="string"||p.bidNtceNm.length>50) return Response.json({error:"invalid parameters"},{status:400});
    const url=new URL("https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch");
    url.search=new URLSearchParams({serviceKey:key,type:"json",numOfRows:"100",inqryDiv:"1",pageNo:String(p.pageNo),inqryBgnDt:p.inqryBgnDt,inqryEndDt:p.inqryEndDt,bidNtceNm:p.bidNtceNm}).toString();
    const response=await fetch(url,{signal:AbortSignal.timeout(18000),redirect:"error"});
    const raw=await response.text();
    if(!response.ok) return Response.json({error:"나라장터 API 응답 실패",upstreamStatus:response.status,reasonCode:raw.match(/<returnReasonCode>(\w+)<\/returnReasonCode>/)?.[1]||null},{status:502});
    if(raw.length>2000000) return Response.json({error:"나라장터 응답 한도 초과"},{status:502});
    try{return Response.json(JSON.parse(raw));}catch{return Response.json({error:"나라장터 JSON 응답 확인 필요. 활용신청 승인 여부를 확인하세요.",reasonCode:raw.match(/<returnReasonCode>(\w+)<\/returnReasonCode>/)?.[1]||null},{status:502});}
  }catch(e){return Response.json({error:"나라장터 연결 처리 실패",errorKind:e instanceof Error?e.name:"unknown"},{status:502});}
});
