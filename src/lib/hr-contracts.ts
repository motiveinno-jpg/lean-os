/**
 * OwnerView HR Contract Package Engine
 * 계약 패키지 생성 → 변수 채움 → 이메일 발송 → 서명 → 급여/연차 자동 세팅
 */

import { supabase } from './supabase';
import { fillVariables } from './documents';
import { calculatePayroll } from './payment-batch';
import { calculateAnnualLeave, autoInitLeaveBalance } from './hr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export interface ContractPackage {
  id: string;
  company_id: string;
  employee_id: string;
  title: string;
  status: 'draft' | 'sent' | 'partially_signed' | 'completed' | 'cancelled';
  created_by: string;
  sent_at?: string;
  completed_at?: string;
  expires_at?: string;
  sign_token?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ContractPackageItem {
  id: string;
  package_id: string;
  document_id?: string;
  template_id?: string;
  title: string;
  sort_order: number;
  status: 'pending' | 'signed' | 'rejected';
  signed_at?: string;
  signature_data?: { type: string; data: string };
  created_at: string;
}

export const PACKAGE_STATUS = {
  draft: { label: '초안', bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
  sent: { label: '발송됨', bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  partially_signed: { label: '서명 진행중', bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  completed: { label: '완료', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
  cancelled: { label: '취소', bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
} as const;

// ── Contract Template Categories ──

export const CONTRACT_TEMPLATE_CATEGORIES = [
  { value: 'salary_contract', label: '연봉계약서' },
  { value: 'nda', label: '비밀유지서약서' },
  { value: 'non_compete', label: '겸업금지서약서' },
  { value: 'privacy_consent', label: '개인정보 동의서' },
  { value: 'comprehensive_labor', label: '포괄임금 근로계약서' },
] as const;

// ── Build Contract Variables from Employee + Company Data ──

export async function buildContractVariables(
  companyId: string,
  employeeId: string,
  overrides?: Record<string, string>,
): Promise<Record<string, string>> {
  // Get employee data
  const { data: employee } = await db
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .single();

  if (!employee) throw new Error('직원 정보를 찾을 수 없습니다');

  // Get company data
  const { data: company } = await db
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();

  if (!company) throw new Error('회사 정보를 찾을 수 없습니다');

  // Calculate payroll deductions
  const monthlySalary = Math.round(Number(employee.salary || 0) / 12);
  const payroll = monthlySalary > 0 ? calculatePayroll(monthlySalary, employee.name, employeeId) : null;

  // Comprehensive labor: calculate base + OT split (roughly 83% base, 17% OT for 20hr/mo)
  const basePay = Math.round(monthlySalary * 0.83);
  const otPay = monthlySalary - basePay;

  const fmt = (n: number) => n.toLocaleString('ko-KR');

  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const nextYearStr = nextYear.toISOString().slice(0, 10);

  const vars: Record<string, string> = {
    // Employee
    직원명: employee.name || '',
    주민등록번호: employee.resident_number || '______-_______',
    부서: employee.department || '',
    직급: employee.position || '',
    입사일: employee.hire_date || today,

    // Company
    회사명: company.name || '',
    대표자명: company.representative || company.ceo_name || '',

    // Contract period
    계약시작일: employee.hire_date || today,
    계약종료일: nextYearStr,

    // Salary
    연봉: fmt(Number(employee.salary || 0)),
    월급여: fmt(monthlySalary),

    // Comprehensive labor splits
    기본급: fmt(basePay),
    고정연장근로수당: fmt(otPay),

    // Deductions
    국민연금_공제: fmt(payroll?.nationalPension || 0),
    건강보험_공제: fmt(payroll?.healthInsurance || 0),
    고용보험_공제: fmt(payroll?.employmentInsurance || 0),
    소득세_공제: fmt((payroll?.incomeTax || 0) + (payroll?.localIncomeTax || 0)),
    실수령액: fmt(payroll?.netPay || 0),
  };

  // Apply overrides
  if (overrides) {
    Object.assign(vars, overrides);
  }

  return vars;
}

// ── Create Contract Package ──

export async function createContractPackage(params: {
  companyId: string;
  employeeId: string;
  title: string;
  templateIds: string[];
  createdBy: string;
  variableOverrides?: Record<string, string>;
  notes?: string;
}): Promise<{ package: ContractPackage; items: ContractPackageItem[] }> {
  const { companyId, employeeId, title, templateIds, createdBy, variableOverrides, notes } = params;

  // Generate sign token
  const signToken = crypto.randomUUID() + '-' + crypto.randomUUID();

  // Create package
  const { data: pkg, error: pkgError } = await db
    .from('hr_contract_packages')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      title,
      status: 'draft',
      created_by: createdBy,
      sign_token: signToken,
      notes: notes || null,
    })
    .select()
    .single();

  if (pkgError) throw pkgError;

  // Build variables
  const variables = await buildContractVariables(companyId, employeeId, variableOverrides);

  // Create items: one per template
  const items: ContractPackageItem[] = [];

  for (let i = 0; i < templateIds.length; i++) {
    const templateId = templateIds[i];

    // Get template
    const { data: template } = await db
      .from('doc_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (!template) continue;

    // Fill variables in template content
    const filledContent = fillVariables(template.content_json as Record<string, any>, variables);

    // Create document from template
    const { data: doc, error: docError } = await db
      .from('documents')
      .insert({
        company_id: companyId,
        template_id: templateId,
        name: `${variables.직원명} - ${template.name}`,
        status: 'draft',
        content_json: filledContent,
        version: 1,
        created_by: createdBy,
      })
      .select()
      .single();

    if (docError) throw docError;

    // Create package item
    const { data: item, error: itemError } = await db
      .from('hr_contract_package_items')
      .insert({
        package_id: pkg.id,
        document_id: doc.id,
        template_id: templateId,
        title: template.name,
        sort_order: i,
        status: 'pending',
      })
      .select()
      .single();

    if (itemError) throw itemError;
    items.push(item);
  }

  return { package: pkg, items };
}

// ── Send Contract Package (email) ──

export async function sendContractPackage(
  packageId: string,
  baseUrl?: string,
): Promise<{ success: boolean; error?: string }> {
  // Get package with employee info
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('*, employees(name, email)')
    .eq('id', packageId)
    .single();

  if (!pkg) throw new Error('계약 패키지를 찾을 수 없습니다');
  if (!pkg.employees?.email) throw new Error('직원 이메일이 등록되지 않았습니다');

  // Get company name
  const { data: company } = await db
    .from('companies')
    .select('name')
    .eq('id', pkg.company_id)
    .single();

  // Get items count
  const { count } = await db
    .from('hr_contract_package_items')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId);

  // Build sign URL
  const signUrl = `${baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://owner-view.com'}/sign?token=${pkg.sign_token}`;

  // Set expiration (14 days from now)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14);

  // Call Edge Function to send email
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('인증 세션이 없습니다');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-contract-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        to: pkg.employees.email,
        employeeName: pkg.employees.name,
        companyName: company?.name || '',
        packageTitle: pkg.title,
        documentCount: count || 0,
        signUrl,
        expiresAt: expiresAt.toISOString(),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`이메일 발송 실패: ${err}`);
    }
  } catch (e: any) {
    // Update status but note the email failure
    await db.from('hr_contract_packages').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      notes: (pkg.notes ? pkg.notes + '\n' : '') + `이메일 발송 실패: ${e.message}`,
    }).eq('id', packageId);

    return { success: false, error: e.message };
  }

  // Update package status
  await db.from('hr_contract_packages').update({
    status: 'sent',
    sent_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
  }).eq('id', packageId);

  return { success: true };
}

// ── Get Package by Sign Token (for external signing page) ──

export async function getPackageByToken(token: string) {
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('*, employees(name, email, department, position)')
    .eq('sign_token', token)
    .single();

  if (!pkg) return null;

  // Check expiration
  if (pkg.expires_at && new Date(pkg.expires_at) < new Date()) {
    return { ...pkg, expired: true, items: [] };
  }

  // Get items with document content
  const { data: items } = await db
    .from('hr_contract_package_items')
    .select('*, documents(name, content_json, status)')
    .eq('package_id', pkg.id)
    .order('sort_order');

  return { ...pkg, expired: false, items: items || [] };
}

// ── Sign a Contract Item ──

export async function signContractItem(
  itemId: string,
  signatureData: { type: 'draw' | 'type' | 'upload'; data: string },
  ipAddress?: string,
): Promise<{ allSigned: boolean }> {
  // Update item
  const { data: item, error } = await db
    .from('hr_contract_package_items')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signature_data: { ...signatureData, ip: ipAddress || null },
    })
    .eq('id', itemId)
    .select('package_id, document_id')
    .single();

  if (error) throw error;

  // Lock the associated document
  if (item?.document_id) {
    await db.from('documents').update({
      status: 'locked',
      locked_at: new Date().toISOString(),
    }).eq('id', item.document_id);
  }

  // Check if all items in the package are signed
  const { data: allItems } = await db
    .from('hr_contract_package_items')
    .select('id, status')
    .eq('package_id', item.package_id);

  const allSigned = (allItems || []).every((i: any) => i.status === 'signed');
  const someSigned = (allItems || []).some((i: any) => i.status === 'signed');

  if (allSigned) {
    // Complete the package
    await db.from('hr_contract_packages').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', item.package_id);

    // Trigger post-signing actions
    await onAllContractsSigned(item.package_id);
  } else if (someSigned) {
    await db.from('hr_contract_packages').update({
      status: 'partially_signed',
    }).eq('id', item.package_id);
  }

  return { allSigned };
}

// ── Post-signing: Update salary + leave balance ──

async function onAllContractsSigned(packageId: string) {
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('company_id, employee_id')
    .eq('id', packageId)
    .single();

  if (!pkg) return;

  // Get salary from the latest contract item (연봉계약서 or 포괄임금)
  const { data: items } = await db
    .from('hr_contract_package_items')
    .select('document_id, title')
    .eq('package_id', packageId);

  for (const item of (items || [])) {
    if (!item.document_id) continue;

    // Check if this is a salary-related contract
    const isSalaryContract = item.title.includes('연봉') || item.title.includes('포괄임금');
    if (!isSalaryContract) continue;

    const { data: doc } = await db
      .from('documents')
      .select('content_json')
      .eq('id', item.document_id)
      .single();

    if (!doc?.content_json) continue;

    // Extract salary from content (look for 연봉 field in the filled template)
    const content = JSON.stringify(doc.content_json);
    const salaryMatch = content.match(/연간 총 금\s*([\d,]+)/);
    if (salaryMatch) {
      const annualSalary = Number(salaryMatch[1].replace(/,/g, ''));
      if (annualSalary > 0) {
        // Update employee salary
        await db.from('employees').update({
          salary: Math.round(annualSalary / 12),
        }).eq('id', pkg.employee_id);

        // Add salary history
        await db.from('salary_history').insert({
          company_id: pkg.company_id,
          employee_id: pkg.employee_id,
          effective_date: new Date().toISOString().slice(0, 10),
          salary: Math.round(annualSalary / 12),
          change_reason: '연봉계약 체결',
        });

        // Create employee_contracts record
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        await db.from('employee_contracts').insert({
          company_id: pkg.company_id,
          employee_id: pkg.employee_id,
          contract_type: 'full_time',
          start_date: new Date().toISOString().slice(0, 10),
          end_date: nextYear.toISOString().slice(0, 10),
          salary: Math.round(annualSalary / 12),
          status: 'active',
        });
      }
    }
  }

  // Update employee status to active (onboarding complete)
  await db.from('employees').update({ status: 'active' }).eq('id', pkg.employee_id);

  // Auto-init leave balance for current year
  const { data: employee } = await db
    .from('employees')
    .select('hire_date')
    .eq('id', pkg.employee_id)
    .single();

  if (employee?.hire_date) {
    const year = new Date().getFullYear();
    await autoInitLeaveBalance(pkg.company_id, pkg.employee_id, employee.hire_date, year);
  }
}

// ── Get Contract Packages List ──

export async function getContractPackages(companyId: string, status?: string) {
  let query = db
    .from('hr_contract_packages')
    .select('*, employees(name, department, position)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data } = await query;
  return data || [];
}

// ── Get Package with Items ──

export async function getContractPackageWithItems(packageId: string) {
  const { data: pkg } = await db
    .from('hr_contract_packages')
    .select('*, employees(name, email, department, position)')
    .eq('id', packageId)
    .single();

  if (!pkg) return null;

  const { data: items } = await db
    .from('hr_contract_package_items')
    .select('*, documents(name, content_json, status)')
    .eq('package_id', packageId)
    .order('sort_order');

  return { ...pkg, items: items || [] };
}

// ── Cancel Package ──

export async function cancelContractPackage(packageId: string) {
  await db.from('hr_contract_packages').update({
    status: 'cancelled',
    updated_at: new Date().toISOString(),
  }).eq('id', packageId);
}

// ── Get Contract Templates ──

export async function getContractTemplates(companyId: string) {
  const { data } = await db
    .from('doc_templates')
    .select('*')
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .in('category', ['salary_contract', 'nda', 'non_compete', 'privacy_consent', 'comprehensive_labor', 'contract_labor'])
    .eq('is_active', true)
    .order('name');

  return data || [];
}

// ── Resend Contract Email ──

export async function resendContractEmail(packageId: string, baseUrl?: string) {
  return sendContractPackage(packageId, baseUrl);
}
