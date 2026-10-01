"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import {
  ProcurementWorkspace,
  type Action,
} from "@/components/procurement/workspace";
import type { Workspace } from "@/lib/procurement/types";
import { useFeature } from "@/lib/use-feature";

export default function ProcurementPage() {
  const { user, loading } = useUser();
  const { isMaster, loading: permissionLoading } = useMyPermissions();
  const feature = useFeature("procurement", user?.company_id);
  if (loading || permissionLoading || feature.isLoading)
    return <p className="p-6">회사 정보를 확인하고 있습니다.</p>;
  if (!isMaster || !user?.company_id || feature.data !== true)
    return (
      <AccessDenied detail="입찰 검토는 회사 마스터만 사용할 수 있습니다." />
    );
  return <ProcurementInner companyId={user.company_id!} />;
}
function ProcurementInner({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const key = ["procurement-workspace", companyId];
  const query = useQuery<Workspace>({
    queryKey: key,
    refetchInterval: (q) =>
      q.state.data?.jobs?.some((j) => ["queued", "running"].includes(j.status))
        ? 10000
        : false,
    queryFn: async () => {
      const res = await fetch("/api/procurement", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "회사 자료를 읽지 못했습니다.");
      return data;
    },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
  };
  const onAction: Action = async (body) => {
    const res = await fetch("/api/procurement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "처리하지 못했습니다.");
    await qc.invalidateQueries({ queryKey: key });
  };
  if (query.isLoading)
    return (
      <p className="p-6">오너뷰 회사정보와 입찰 자료를 불러오고 있습니다.</p>
    );
  if (query.error)
    return (
      <div className="p-6" role="alert">
        <p>{query.error.message}</p>
        <button className="btn-secondary mt-3" onClick={refresh}>
          다시 불러오기
        </button>
      </div>
    );
  if (!query.data) return null;
  return (
    <ProcurementWorkspace
      ws={query.data}
      onAction={onAction}
      refresh={refresh}
    />
  );
}
