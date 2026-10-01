import { createHash } from "node:crypto";
import type {
  Notice,
  Evidence,
  CompanyBasics,
  Settings,
  Workspace,
} from "./types";
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function noticeHash(notice: Notice): string {
  const { id: _id, ...body } = notice;
  return fingerprint(body);
}
export function evidenceHash(
  evidence: Evidence[],
  company: CompanyBasics,
  settings: Settings,
): string {
  return fingerprint({
    evidence: [...evidence].sort((a, b) => a.id.localeCompare(b.id)),
    company,
    minimumScore: settings.minimumScore,
  });
}
export function workforceHash(ws: Workspace) {
  const { observedAt: _at, ...data } = ws.workforce || { observedAt: null };
  return fingerprint({ workforce: data, profile: ws.profile });
}
