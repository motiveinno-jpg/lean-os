import { authorize, workspace } from "@/lib/procurement/server";
import { ProcurementError } from "@/lib/procurement/validation";
import { validateProposal } from "@/lib/procurement/ai";
import {
  proposalMarkdown,
  proposalDocx,
  proposalPrintHtml,
} from "@/lib/procurement/documents";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, companyId } = await authorize();
    const ws = await workspace(db, companyId);
    const { id } = await params;
    const a = ws.artifacts?.find((a) => a.id === id && a.kind === "proposal");
    if (!a)
      throw new ProcurementError(
        "현재 회사의 작성 문서를 찾을 수 없습니다.",
        404,
      );
    if (a.stale)
      throw new ProcurementError(
        "공고·회사·인력 자료가 바뀌었습니다. 문서를 다시 작성하세요.",
        409,
      );
    const notice = ws.notices.find((n) => n.id === a.notice_id)!.payload;
    const proposal = validateProposal(a.body, notice, ws);
    const markdown = proposalMarkdown(proposal, notice, ws);
    const format = new URL(req.url).searchParams.get("format") || "docx";
    if (format === "html")
      return new Response(proposalPrintHtml(markdown), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        },
      });
    if (format === "md")
      return new Response(markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": "attachment; filename=procurement-proposal.md",
          "Cache-Control": "no-store",
        },
      });
    return new Response((await proposalDocx(markdown)) as BodyInit, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": "attachment; filename=procurement-proposal.docx",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof ProcurementError
            ? e.message
            : "문서 내보내기에 실패했습니다.",
      },
      { status: e instanceof ProcurementError ? e.status : 500 },
    );
  }
}
