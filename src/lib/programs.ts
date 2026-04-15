import { supabase } from "./supabase";

// ─── Types ───────────────────────────────────────────────

export interface DealTemplate {
  classification?: string;
  defaultAmount?: number;
  paymentStages?: { label: string; ratio: number }[];
  serviceScope?: string;
  notes?: string;
}

export interface Program {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  total_budget: number;
  deal_template: DealTemplate;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface ProgramWithStats extends Program {
  totalDeals: number;
  completedDeals: number;
  inProgressDeals: number;
  pendingDeals: number;
  totalCollected: number;
  totalOutstanding: number;
  partnerCount: number;
}

export interface BulkDealRow {
  counterparty: string;
  contactName?: string;
  contactEmail?: string;
  amount?: number;
  partnerCompanyId?: string;
  partnerName?: string;
  customScope?: string;
}

// ─── Program CRUD ────────────────────────────────────────

export async function createProgram(params: {
  companyId: string;
  name: string;
  description?: string;
  totalBudget?: number;
  dealTemplate?: DealTemplate;
}) {
  const { data, error } = await supabase
    .from("programs")
    .insert({
      company_id: params.companyId,
      name: params.name,
      description: params.description || null,
      total_budget: params.totalBudget || 0,
      deal_template: (params.dealTemplate || {}) as any,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateProgram(
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    total_budget: number;
    deal_template: DealTemplate;
    status: "active" | "completed" | "archived";
  }>,
) {
  const { data, error } = await supabase
    .from("programs")
    .update(updates as any)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteProgram(id: string) {
  const { error } = await supabase.from("programs").delete().eq("id", id);
  if (error) throw error;
}

export async function getPrograms(companyId: string): Promise<Program[]> {
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("company_id", companyId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as Program[];
}

export async function getProgram(id: string): Promise<Program | null> {
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data as unknown as Program;
}

// ─── Program Stats ───────────────────────────────────────

export async function getProgramStats(
  programId: string,
): Promise<{
  totalDeals: number;
  completedDeals: number;
  inProgressDeals: number;
  pendingDeals: number;
  totalCollected: number;
  totalOutstanding: number;
  partners: { id: string; name: string; dealCount: number }[];
}> {
  const { data: deals, error } = await supabase
    .from("deals")
    .select("id, status, contract_total, partner_company_id")
    .eq("program_id", programId);

  if (error) throw error;
  const rows = deals || [];

  const excludedStatuses = ["archived", "dormant", "closed_lost"];
  const activeRows = rows.filter((d: any) => !excludedStatuses.includes(d.status));
  const completedStatuses = ["completed", "closed_won"];
  const inProgressStatuses = ["active", "in_progress", "contract_signed"];
  const pendingStatuses = ["pending", "negotiation", "proposal"];

  const completed = rows.filter((d: any) =>
    completedStatuses.includes(d.status),
  );
  const inProgress = rows.filter((d: any) =>
    inProgressStatuses.includes(d.status),
  );
  const pending = rows.filter((d: any) => pendingStatuses.includes(d.status));

  const totalCollected = completed.reduce(
    (s: number, d: any) => s + Number(d.contract_total || 0),
    0,
  );
  const totalOutstanding = [...inProgress, ...pending].reduce(
    (s: number, d: any) => s + Number(d.contract_total || 0),
    0,
  );

  // Partner aggregation
  const partnerMap = new Map<string, { count: number }>();
  for (const d of rows) {
    const pid = (d as any).partner_company_id;
    if (pid) {
      const existing = partnerMap.get(pid) || { count: 0 };
      existing.count++;
      partnerMap.set(pid, existing);
    }
  }

  // Fetch partner names
  const partnerIds = Array.from(partnerMap.keys());
  let partners: { id: string; name: string; dealCount: number }[] = [];
  if (partnerIds.length > 0) {
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", partnerIds);

    partners = (companies || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      dealCount: partnerMap.get(c.id)?.count || 0,
    }));
  }

  return {
    totalDeals: activeRows.length,
    completedDeals: completed.length,
    inProgressDeals: inProgress.length,
    pendingDeals: pending.length,
    totalCollected,
    totalOutstanding,
    partners,
  };
}

// ─── Bulk Deal Creation ──────────────────────────────────

export async function bulkCreateDeals(params: {
  programId: string;
  companyId: string;
  template: DealTemplate;
  rows: BulkDealRow[];
}): Promise<{ success: number; failed: number; errors: string[] }> {
  const { programId, companyId, template, rows } = params;
  if (!companyId) throw new Error("Company ID is required");
  if (!programId) throw new Error("Program ID is required");

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const amount = row.amount || template.defaultAmount || 0;
      const { error } = await supabase.from("deals").insert({
        company_id: companyId,
        program_id: programId,
        name: row.counterparty,
        counterparty: row.counterparty,
        classification: template.classification || "B2B",
        contract_total: amount,
        status: "pending",
        partner_company_id: row.partnerCompanyId || null,
        custom_scope: {
          serviceScope: row.customScope || template.serviceScope || "",
          contactName: row.contactName || "",
          contactEmail: row.contactEmail || "",
          partnerName: row.partnerName || "",
        },
      });

      if (error) {
        failed++;
        errors.push(`${row.counterparty}: ${error.message}`);
      } else {
        success++;
      }
    } catch (err: any) {
      failed++;
      errors.push(`${row.counterparty}: ${err.message}`);
    }
  }

  return { success, failed, errors };
}

// ─── Bulk Status Update ──────────────────────────────────

export async function bulkUpdateDealStatus(
  dealIds: string[],
  status: string,
): Promise<{ success: number; failed: number }> {
  const { error } = await supabase
    .from("deals")
    .update({ status })
    .in("id", dealIds);

  if (error) return { success: 0, failed: dealIds.length };
  return { success: dealIds.length, failed: 0 };
}

// ─── CSV Parser ──────────────────────────────────────────

export function parseProgramCsv(text: string): {
  rows: BulkDealRow[];
  errors: string[];
} {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return { rows: [], errors: [] };

  const startIndex = lines[0].toLowerCase().includes("업체") ||
    lines[0].toLowerCase().includes("company") ||
    lines[0].toLowerCase().includes("counterparty")
    ? 1
    : 0;

  const rows: BulkDealRow[] = [];
  const errors: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line
      .split(",")
      .map((p) => p.trim().replace(/^["']|["']$/g, ""));
    const [counterparty, contactName, contactEmail, amountRaw, partnerName] =
      parts;

    if (!counterparty) {
      errors.push(`${i + 1}행: 업체명 누락`);
      continue;
    }

    const amount = amountRaw ? Number(amountRaw.replace(/[^0-9]/g, "")) : undefined;
    if (amountRaw && (isNaN(amount!) || amount! <= 0)) {
      errors.push(`${i + 1}행: 금액 형식 오류 (${amountRaw})`);
      continue;
    }

    rows.push({
      counterparty,
      contactName: contactName || undefined,
      contactEmail: contactEmail || undefined,
      amount: amount || undefined,
      partnerName: partnerName || undefined,
    });
  }

  return { rows, errors };
}

// ─── Get Program Deals (with partner filter) ─────────────

export async function getProgramDeals(
  programId: string,
  filters?: {
    status?: string;
    partnerCompanyId?: string;
    search?: string;
  },
) {
  let query = supabase
    .from("deals")
    .select("*")
    .eq("program_id", programId)
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.partnerCompanyId) {
    query = query.eq("partner_company_id", filters.partnerCompanyId);
  }

  const { data, error } = await query;
  if (error) throw error;

  let results = data || [];

  if (filters?.search) {
    const term = filters.search.toLowerCase();
    results = results.filter(
      (d: any) =>
        d.name?.toLowerCase().includes(term) ||
        d.counterparty?.toLowerCase().includes(term),
    );
  }

  return results;
}
