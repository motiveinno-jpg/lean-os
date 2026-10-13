// 점검 결과를 운영자 오류 기록(error_logs)에 남긴다 — 운영자 페이지 > 시스템 > 에러 해석과 아침 점검 메일에 그대로 뜬다.
//   전부 통과하면 지난 점검이 남긴 미해결 기록을 '해결'로 돌려 지난 실패가 계속 떠 있지 않게 한다.
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { BASE_URL, rest } from "./env";

export default class ReportToDb implements Reporter {
  private failed: { title: string; error: string }[] = [];
  private total = 0;
  onTestEnd(test: TestCase, result: TestResult) {
    this.total++;
    //   재시도로 통과한 건 실패로 치지 않는다(마지막 시도만 본다)
    if (result.status === "failed" || result.status === "timedOut") {
      if (result.retry < test.retries) return;
      const err = (result.error?.message || result.status).replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 3).join(" ").slice(0, 400);
      this.failed.push({ title: test.titlePath().slice(-1)[0], error: err });
    }
  }
  async onEnd(result: FullResult) {
    if (!process.env.SMOKE_REPORT) return;   // 로컬 시험 실행은 기록하지 않는다
    const sha = (process.env.SMOKE_SHA || process.env.GITHUB_SHA || "").slice(0, 8);
    const runUrl = process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
    try {
      if (this.failed.length === 0 && result.status === "passed") {
        await rest(`error_logs?source=eq.smoke&resolved=eq.false`, { method: "PATCH", body: JSON.stringify({ resolved: true }) });
        return;
      }
      for (const f of this.failed) {
        await rest("error_logs", { method: "POST", body: JSON.stringify({
          source: "smoke", error_type: "deploy_check",
          message: `[배포 후 점검] ${f.title} 실패 — ${f.error}`,
          url: BASE_URL, context: { sha, runUrl, failedCount: this.failed.length, total: this.total },
        }) });
      }
    } catch (e) {
      console.error("점검 결과 기록 실패", e);
    }
  }
}
