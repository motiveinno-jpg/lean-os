"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useToast } from "@/components/toast";

type NotifChannel = "email" | "push" | "telegram";
type NotifEvent =
  | "approval_pending"
  | "deal_status"
  | "payment_due"
  | "tax_invoice"
  | "chat_mention"
  | "weekly_report"
  | "system_alert";

interface NotifPrefs {
  email: { enabled: boolean; address: string; events: Record<NotifEvent, boolean> };
  push: { enabled: boolean; events: Record<NotifEvent, boolean> };
  telegram: { enabled: boolean; chatId: string; events: Record<NotifEvent, boolean> };
  quietHours: { enabled: boolean; start: string; end: string };
}

const NOTIF_EVENTS: { key: NotifEvent; label: string; desc: string }[] = [
  { key: "approval_pending", label: "결재 요청", desc: "내가 결재해야 할 항목이 새로 등록될 때" },
  { key: "deal_status", label: "프로젝트 상태 변경", desc: "프로젝트가 다음 단계로 이동하거나 완료될 때" },
  { key: "payment_due", label: "결제 마감 임박", desc: "D-7 이내 결제/지급 예정" },
  { key: "tax_invoice", label: "세금계산서 발행/수신", desc: "신규 세금계산서 발행 또는 매입 수신" },
  { key: "chat_mention", label: "채팅 멘션", desc: "팀 채팅에서 @멘션 받을 때" },
  { key: "weekly_report", label: "주간 리포트", desc: "매주 월요일 오전 9시 요약 리포트" },
  { key: "system_alert", label: "시스템 경고", desc: "런웨이/현금흐름 임계치 알림" },
];

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  email: {
    enabled: true,
    address: "",
    events: {
      approval_pending: true,
      deal_status: false,
      payment_due: true,
      tax_invoice: true,
      chat_mention: false,
      weekly_report: true,
      system_alert: true,
    },
  },
  push: {
    enabled: false,
    events: {
      approval_pending: true,
      deal_status: true,
      payment_due: true,
      tax_invoice: false,
      chat_mention: true,
      weekly_report: false,
      system_alert: true,
    },
  },
  telegram: {
    enabled: false,
    chatId: "",
    events: {
      approval_pending: true,
      deal_status: false,
      payment_due: true,
      tax_invoice: false,
      chat_mention: false,
      weekly_report: true,
      system_alert: true,
    },
  },
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
};

const NOTIF_STORAGE_KEY = "leanos-notification-prefs";

export function NotificationsTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unknown">("unknown");
  const [telegramTesting, setTelegramTesting] = useState(false);
  // iOS(사파리)는 '홈 화면에 추가'한 standalone 앱에서만 백그라운드 푸시 지원 — 안내용
  const [iosNeedsA2HS, setIosNeedsA2HS] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        setPrefs({ ...DEFAULT_NOTIF_PREFS, ...stored });
      }
    } catch {}
    setLoaded(true);

    if (typeof window !== "undefined" && "Notification" in window) {
      setPushSupported(true);
      setPushPermission(Notification.permission);
    }
    if (typeof window !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent)
        && !window.matchMedia("(display-mode: standalone)").matches) {
      setIosNeedsA2HS(true);
    }

    // Try to load user email
    getCurrentUser().then((u) => {
      if (u?.email) {
        setPrefs((p) => ({ ...p, email: { ...p.email, address: p.email.address || u.email } }));
      }
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(prefs));
      // Best-effort persist to supabase if a notification_prefs table exists
      if (companyId) {
        const u = await getCurrentUser();
        if (u) {
          await (supabase as any)
            .from("notification_prefs")
            .upsert({
              user_id: u.id,
              company_id: companyId,
              prefs,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" })
            .then(() => {}, () => {}); // ignore if table missing
        }
      }
      toast("알림 설정 저장됨", "success");
    } catch (err: any) {
      toast(`저장 실패: ${err.message || err}`, "error");
    } finally {
      setSaving(false);
    }
  }

  // 푸시 켜기 — 권한이 이미 허용돼 있어도 항상 구독을 만든다(기존엔 granted 면 구독을 안 만들어
  //   push_subscriptions 0건 → 백그라운드 알림이 영영 안 오던 원인).
  async function enablePush() {
    if (!pushSupported) return;
    const result = await Notification.requestPermission();
    setPushPermission(result);
    if (result !== "granted") {
      toast("푸시 알림 권한 거부됨 — 브라우저 설정에서 허용해주세요", "error");
      return;
    }
    setPrefs((p) => ({ ...p, push: { ...p.push, enabled: true } }));
    try {
      const [{ subscribeWebPush, webPushSupported }, { getCurrentUser }] = await Promise.all([
        import("@/lib/web-push"),
        import("@/lib/queries"),
      ]);
      if (!webPushSupported()) {
        toast("이 브라우저는 백그라운드 푸시를 지원하지 않습니다 — 아이폰은 '홈 화면에 추가' 후 홈 화면 앱에서 켜주세요", "info");
        return;
      }
      const u = await getCurrentUser();
      const ok = u ? await subscribeWebPush(companyId, u.id) : false;
      toast(
        ok ? "브라우저 푸시 켜짐 — 창을 닫아도 알림을 받습니다" : "권한은 허용됐지만 구독에 실패했습니다. 다시 시도해주세요",
        ok ? "success" : "error",
      );
    } catch {
      toast("푸시 알림 권한 허용됨 (백그라운드 구독은 실패 — 다시 시도)", "info");
    }
  }

  // 푸시 끄기 — 구독 해제 + DB 정리(서버가 더 이상 이 브라우저로 발송 안 함).
  async function disablePush() {
    setPrefs((p) => ({ ...p, push: { ...p.push, enabled: false } }));
    try {
      const { unsubscribeWebPush } = await import("@/lib/web-push");
      await unsubscribeWebPush();
    } catch { /* best-effort */ }
    toast("브라우저 푸시를 껐습니다", "info");
  }

  // 자동 복구 — 설정상 켜져 있고 권한도 허용인데 이 브라우저에 구독이 없으면 조용히 재구독.
  //   (토글 버그로 구독 없이 '켜짐'으로 저장된 기존 사용자 자동 치유)
  useEffect(() => {
    if (!loaded || !prefs.push.enabled) return;
    if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
    (async () => {
      try {
        const [{ subscribeWebPush, isWebPushSubscribed, webPushSupported }, { getCurrentUser }] = await Promise.all([
          import("@/lib/web-push"),
          import("@/lib/queries"),
        ]);
        if (!webPushSupported()) return;
        if (await isWebPushSubscribed()) return;
        const u = await getCurrentUser();
        if (u) await subscribeWebPush(companyId, u.id);
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, prefs.push.enabled, companyId]);

  async function testTelegram() {
    if (!prefs.telegram.chatId.trim()) {
      toast("텔레그램 Chat ID를 입력해주세요", "error");
      return;
    }
    setTelegramTesting(true);
    try {
      const res = await fetch("/api/notifications/telegram-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: prefs.telegram.chatId }),
      });
      if (res.ok) {
        toast("테스트 메시지 발송 — 텔레그램을 확인하세요", "success");
      } else {
        const body = await res.json().catch(() => ({}));
        toast(body?.error || "발송 실패 — Chat ID를 확인하세요", "error");
      }
    } catch {
      toast("네트워크 오류 — 잠시 후 다시 시도하세요", "error");
    } finally {
      setTelegramTesting(false);
    }
  }

  function setEventEnabled(channel: NotifChannel, event: NotifEvent, enabled: boolean) {
    setPrefs((p) => ({
      ...p,
      [channel]: {
        ...(p[channel] as any),
        events: { ...(p[channel] as any).events, [event]: enabled },
      },
    }));
  }

  function setAllEvents(channel: NotifChannel, enabled: boolean) {
    setPrefs((p) => {
      const next = { ...((p[channel] as any).events) };
      for (const ev of NOTIF_EVENTS) next[ev.key] = enabled;
      return { ...p, [channel]: { ...(p[channel] as any), events: next } };
    });
  }

  if (!loaded) {
    return <div className="text-sm text-[var(--text-muted)] py-8 text-center">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="notification-settings-header glass-card">
        <h2 className="text-base font-bold mb-1">알림 설정</h2>
        <p className="text-xs text-[var(--text-muted)]">
          이메일 · 푸시 · 텔레그램 — 채널별로 받고 싶은 이벤트를 선택하세요. 변경 후 하단의 저장 버튼을 눌러주세요.
        </p>
      </div>

      {/* Email Channel */}
      <ChannelSection
        title="📧 이메일"
        desc="가장 중요한 알림 — 결재/세금계산서/주간 리포트에 권장"
        enabled={prefs.email.enabled}
        onToggle={(v) => setPrefs((p) => ({ ...p, email: { ...p.email, enabled: v } }))}
      >
        <div className="notification-email-address-field">
          <label className="field-label">수신 이메일 주소</label>
          <input
            type="email"
            value={prefs.email.address}
            onChange={(e) => setPrefs((p) => ({ ...p, email: { ...p.email, address: e.target.value } }))}
            placeholder="you@example.com"
            disabled={!prefs.email.enabled}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm disabled:opacity-50"
          />
        </div>
        <EventGrid
          channel="email"
          enabled={prefs.email.enabled}
          values={prefs.email.events}
          onChange={setEventEnabled}
          onAll={setAllEvents}
        />
      </ChannelSection>

      {/* Push Channel */}
      <ChannelSection
        title="🔔 브라우저 푸시"
        desc="실시간 데스크톱 알림 — 채팅 멘션/긴급 알림에 적합"
        enabled={prefs.push.enabled}
        onToggle={(v) => (v ? enablePush() : disablePush())}
        disabled={!pushSupported}
      >
        {!pushSupported && (
          <div className="text-xs text-[var(--warning)] mb-3">
            현재 브라우저에서 푸시 알림을 지원하지 않습니다.
          </div>
        )}
        {iosNeedsA2HS && (
          <div className="text-xs text-[var(--warning)] mb-3 leading-relaxed">
            📱 아이폰/아이패드는 Safari <b>공유 → &lsquo;홈 화면에 추가&rsquo;</b> 후, 홈 화면의 오너뷰 앱에서 켜야
            창을 닫아도 알림이 옵니다 (iOS 정책).
          </div>
        )}
        {pushSupported && pushPermission === "denied" && (
          <div className="text-xs text-[var(--danger)] mb-3">
            푸시 권한이 거부되었습니다. 브라우저 주소창 옆 자물쇠 아이콘에서 알림을 허용해주세요.
          </div>
        )}
        {pushSupported && pushPermission !== "granted" && pushPermission !== "denied" && (
          <button
            onClick={enablePush}
            className="mb-3 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 transition"
          >
            푸시 권한 요청
          </button>
        )}
        <EventGrid
          channel="push"
          enabled={prefs.push.enabled && pushSupported}
          values={prefs.push.events}
          onChange={setEventEnabled}
          onAll={setAllEvents}
        />
      </ChannelSection>

      {/* Telegram Channel */}
      <ChannelSection
        title="✈️ 텔레그램"
        desc="모바일에서 가장 빠른 알림 — @motive_hajun_bot에게 /start 입력 후 Chat ID 발급받으세요"
        enabled={prefs.telegram.enabled}
        onToggle={(v) => setPrefs((p) => ({ ...p, telegram: { ...p.telegram, enabled: v } }))}
      >
        <div className="mb-4">
          <label className="field-label">Telegram Chat ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={prefs.telegram.chatId}
              onChange={(e) => setPrefs((p) => ({ ...p, telegram: { ...p.telegram, chatId: e.target.value } }))}
              placeholder="예: 123456789"
              disabled={!prefs.telegram.enabled}
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm disabled:opacity-50"
            />
            <button
              onClick={testTelegram}
              disabled={!prefs.telegram.enabled || telegramTesting}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--primary-light)] text-[var(--primary)] hover:opacity-90 transition disabled:opacity-50"
            >
              {telegramTesting ? "발송중..." : "테스트"}
            </button>
          </div>
          <p className="caption mt-1.5">
            텔레그램에서 @motive_hajun_bot에게 메시지를 보낸 뒤, Chat ID를 입력하세요.
          </p>
        </div>
        <EventGrid
          channel="telegram"
          enabled={prefs.telegram.enabled}
          values={prefs.telegram.events}
          onChange={setEventEnabled}
          onAll={setAllEvents}
        />
      </ChannelSection>

      {/* Quiet Hours */}
      <div className="notification-quiet-hours-card glass-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold">방해금지 시간대</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">설정한 시간에는 긴급 알림을 제외하고 모든 알림이 보류됩니다.</p>
          </div>
          <Toggle
            checked={prefs.quietHours.enabled}
            onChange={(v) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, enabled: v } }))}
          />
        </div>
        {prefs.quietHours.enabled && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">시작</label>
              <input
                type="time"
                value={prefs.quietHours.start}
                onChange={(e) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, start: e.target.value } }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">종료</label>
              <input
                type="time"
                value={prefs.quietHours.end}
                onChange={(e) => setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, end: e.target.value } }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* 자금일보 카카오 알림톡 — 매일 KST 09:00 자동 발송 */}
      <DailyReportCard companyId={companyId} />

      {/* Slack 알림 — 결제/결재/큰 거래 자동 알림 (Granter 패턴) */}
      <SlackNotifyCard companyId={companyId} />

      {/* Save bar */}
      <div className="notification-save-bar">
        <button
          onClick={() => setPrefs(DEFAULT_NOTIF_PREFS)}
          className="btn-ghost"
        >
          기본값으로
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary px-5"
        >
          {saving ? "저장중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

function DailyReportCard({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [phones, setPhones] = useState<string[]>([]);
  const [phoneInput, setPhoneInput] = useState("");
  const [sendHour, setSendHour] = useState(9);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data } = await (supabase as any).from("notification_settings")
        .select("*").eq("company_id", companyId).maybeSingle();
      if (data) {
        setEnabled(!!data.daily_report_enabled);
        setPhones(data.daily_report_phones || []);
        setSendHour(data.daily_report_send_hour ?? 9);
        setLastSentAt(data.last_sent_at);
        setLastStatus(data.last_sent_status);
      }
      setLoaded(true);
    })();
  }, [companyId]);

  const addPhone = () => {
    const cleaned = phoneInput.replace(/[^0-9]/g, "");
    if (cleaned.length < 10) { toast("전화번호 형식이 올바르지 않습니다", "error"); return; }
    if (phones.includes(cleaned)) { toast("이미 등록된 번호입니다", "info"); return; }
    setPhones([...phones, cleaned]);
    setPhoneInput("");
  };

  const removePhone = (p: string) => setPhones(phones.filter(x => x !== p));

  const save = async () => {
    if (!companyId || saving) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("notification_settings").upsert({
        company_id: companyId,
        daily_report_enabled: enabled,
        daily_report_phones: phones,
        daily_report_send_hour: sendHour,
      }, { onConflict: "company_id" });
      if (error) throw error;
      toast("자금일보 알림 설정 저장 완료", "success");
    } catch (e: any) {
      toast(`저장 실패: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    if (!companyId || testing) return;
    if (phones.length === 0) { toast("수신 번호를 먼저 등록하세요", "error"); return; }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast("세션이 만료되었습니다", "error"); return; }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/daily-report`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "send-now", companyId }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast(`발송 실패: ${result.error || res.status}`, "error");
        return;
      }
      if (result.skipped === "solapi_not_configured") {
        toast(`Solapi 키 미설정 — 검수 통과 후 환경변수 추가 필요. 데이터: ${JSON.stringify(result.report).slice(0, 100)}...`, "info");
      } else if (result.skipped) {
        toast(`발송 skip: ${result.skipped}`, "info");
      } else {
        toast(`발송 ${result.sent}/${result.total} 건 완료`, result.sent > 0 ? "success" : "error");
      }
      setLastSentAt(new Date().toISOString());
      setLastStatus(result.skipped || `sent ${result.sent}/${result.total ?? 0}`);
    } catch (e: any) {
      toast(`발송 실패: ${e.message}`, "error");
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="notification-daily-report-card glass-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            💰 자금일보 카카오 알림톡
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--warning-dim)] text-[var(--warning)] font-semibold">신규</span>
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">매일 정해진 시간에 전일 자금 요약을 카톡으로 발송 (Solapi 검수 통과 후 활성화).</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="sr-only peer" />
          <div className="w-10 h-6 bg-[var(--bg-surface)] peer-checked:bg-[var(--primary)] rounded-full transition relative">
            <div className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full transition ${enabled ? "translate-x-4" : ""}`} />
          </div>
        </label>
      </div>

      {enabled && (
        <div className="space-y-3 mt-4">
          {/* 발송 시각 */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--text-muted)]">발송 시각:</label>
            <select
              value={sendHour}
              onChange={(e) => setSendHour(Number(e.target.value))}
              className="px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, "0")}:00 (KST)</option>
              ))}
            </select>
          </div>

          {/* 수신 번호 */}
          <div>
            <label className="field-label">수신 번호 (카톡 등록된 휴대폰 번호)</label>
            <div className="flex gap-2 mb-2">
              <input
                type="tel"
                inputMode="numeric"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPhone(); } }}
                placeholder="01012345678"
                className="flex-1 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm"
              />
              <button onClick={addPhone} className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90">추가</button>
            </div>
            {phones.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {phones.map(p => (
                  <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--bg-surface)] rounded-lg text-xs border border-[var(--border)]">
                    {p.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}
                    <button onClick={() => removePhone(p)} className="text-[var(--text-dim)] hover:text-red-400 ml-1">×</button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="caption">등록된 번호 없음. 카톡 알림 받을 번호를 추가하세요.</p>
            )}
          </div>

          {/* 마지막 발송 상태 */}
          {lastSentAt && (
            <div className="p-2.5 bg-[var(--bg-surface)] rounded-lg text-[11px] text-[var(--text-dim)]">
              마지막 발송: {new Date(lastSentAt).toLocaleString("ko-KR")} · {lastStatus}
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary flex-1"
            >
              {saving ? "저장중..." : "설정 저장"}
            </button>
            <button
              onClick={testSend}
              disabled={testing || phones.length === 0}
              className="btn-secondary flex-1"
            >
              {testing ? "발송중..." : "테스트 발송 (어제 데이터)"}
            </button>
          </div>

          <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">
            검수 진행 상태: Solapi 환경변수(SOLAPI_API_KEY/SECRET/PFID/TEMPLATE_ID) 미설정 시 데이터만 집계되고 실제 발송은 skip.
            검수 통과 후 환경변수 4개 입력하면 즉시 활성화. pg_cron 'daily-report-tick' 매시간 실행 중.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Slack 알림 카드 (Granter 벤치마킹) ──
function SlackNotifyCard({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notifyPayment, setNotifyPayment] = useState(true);
  const [notifyApproval, setNotifyApproval] = useState(true);
  const [notifyLargeTx, setNotifyLargeTx] = useState(true);
  const [largeThreshold, setLargeThreshold] = useState("1000000");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data } = await (supabase as any).from("company_settings")
        .select("slack_webhook_url, slack_notify_payment, slack_notify_approval, slack_notify_large_tx, slack_large_tx_threshold")
        .eq("company_id", companyId).maybeSingle();
      if (data) {
        setWebhookUrl(data.slack_webhook_url || "");
        setNotifyPayment(data.slack_notify_payment ?? true);
        setNotifyApproval(data.slack_notify_approval ?? true);
        setNotifyLargeTx(data.slack_notify_large_tx ?? true);
        setLargeThreshold(String(data.slack_large_tx_threshold || 1000000));
      }
      setLoaded(true);
    })();
  }, [companyId]);

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("company_settings").upsert({
        company_id: companyId,
        slack_webhook_url: webhookUrl || null,
        slack_notify_payment: notifyPayment,
        slack_notify_approval: notifyApproval,
        slack_notify_large_tx: notifyLargeTx,
        slack_large_tx_threshold: Number(largeThreshold) || 1000000,
      }, { onConflict: "company_id" });
      if (error) throw error;
      toast("Slack 알림 설정이 저장되었습니다", "success");
    } catch (e: any) {
      toast(`저장 실패: ${e.message}`, "error");
    } finally { setSaving(false); }
  };

  const testSend = async () => {
    if (!companyId || !webhookUrl) { toast("webhook URL 을 먼저 입력하세요", "error"); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/slack/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          payload: {
            event: "test",
            title: "OwnerView Slack 연동 테스트",
            message: "이 메시지가 보이면 슬랙 알림이 정상 작동합니다 🎉",
            fields: [
              { label: "테스트 시각", value: new Date().toLocaleString("ko-KR") },
            ],
          },
        }),
      });
      const r = await res.json();
      if (r.ok) toast("Slack 테스트 메시지 발송 완료 — 슬랙 채널을 확인하세요", "success");
      else toast(`발송 실패: ${r.error || r.skipped || "알 수 없는 오류"}`, "error");
    } catch (e: any) {
      toast(`발송 실패: ${e.message}`, "error");
    } finally { setTesting(false); }
  };

  if (!loaded) return null;

  return (
    <div className="notification-slack-card glass-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            💬 Slack 알림 연동
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--warning-dim)] text-[var(--warning)] font-semibold">신규</span>
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">결제 요청/결재 대기/큰 거래 발생 시 슬랙 채널에 자동 알림.</p>
        </div>
      </div>

      <div className="space-y-3 mt-4">
        <div>
          <label className="field-label">Slack Incoming Webhook URL</label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/T.../B.../..."
            className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
          />
          <p className="text-[10px] text-[var(--text-dim)] mt-1">
            슬랙 워크스페이스 → Apps → "Incoming Webhooks" 추가 → 채널 선택 → URL 복사.
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="ml-1 text-[var(--primary)] underline">설정 가이드</a>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="flex items-center gap-2 p-3 bg-[var(--bg-surface)] rounded-lg cursor-pointer">
            <input type="checkbox" checked={notifyPayment} onChange={(e) => setNotifyPayment(e.target.checked)} className="accent-[var(--primary)]" />
            <span className="text-xs">결제 요청</span>
          </label>
          <label className="flex items-center gap-2 p-3 bg-[var(--bg-surface)] rounded-lg cursor-pointer">
            <input type="checkbox" checked={notifyApproval} onChange={(e) => setNotifyApproval(e.target.checked)} className="accent-[var(--primary)]" />
            <span className="text-xs">결재 대기</span>
          </label>
          <label className="flex items-center gap-2 p-3 bg-[var(--bg-surface)] rounded-lg cursor-pointer">
            <input type="checkbox" checked={notifyLargeTx} onChange={(e) => setNotifyLargeTx(e.target.checked)} className="accent-[var(--primary)]" />
            <span className="text-xs">큰 거래</span>
          </label>
        </div>

        {notifyLargeTx && (
          <div>
            <label className="field-label">큰 거래 기준 금액 (원)</label>
            <input
              type="text"
              inputMode="numeric"
              value={largeThreshold ? Number(largeThreshold).toLocaleString("ko-KR") : ""}
              onChange={(e) => setLargeThreshold(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="1,000,000"
              className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-xs"
            />
            <p className="text-[10px] text-[var(--text-dim)] mt-1">이 금액 이상의 거래 발생 시 슬랙 알림.</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? "저장중..." : "설정 저장"}
          </button>
          <button onClick={testSend} disabled={testing || !webhookUrl} className="btn-secondary flex-1">
            {testing ? "발송중..." : "테스트 발송"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelSection({
  title,
  desc,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`notification-channel-card glass-card ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">{title}</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{desc}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} disabled={disabled} />
      </div>
      <div className={enabled ? "" : "opacity-50 pointer-events-none"}>{children}</div>
    </div>
  );
}

function EventGrid({
  channel,
  enabled,
  values,
  onChange,
  onAll,
}: {
  channel: NotifChannel;
  enabled: boolean;
  values: Record<NotifEvent, boolean>;
  onChange: (channel: NotifChannel, event: NotifEvent, enabled: boolean) => void;
  onAll: (channel: NotifChannel, enabled: boolean) => void;
}) {
  return (
    <div className="notification-event-grid">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">이벤트별 수신</span>
        <div className="flex gap-2 text-[10px]">
          <button
            onClick={() => onAll(channel, true)}
            disabled={!enabled}
            className="text-[var(--primary)] hover:underline disabled:opacity-50"
          >
            모두 켜기
          </button>
          <span className="text-[var(--text-dim)]">·</span>
          <button
            onClick={() => onAll(channel, false)}
            disabled={!enabled}
            className="text-[var(--text-muted)] hover:underline disabled:opacity-50"
          >
            모두 끄기
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {NOTIF_EVENTS.map((ev) => (
          <label
            key={ev.key}
            className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--border)] transition cursor-pointer"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--text)]">{ev.label}</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{ev.desc}</div>
            </div>
            <Toggle
              checked={!!values[ev.key]}
              onChange={(v) => onChange(channel, ev.key, v)}
              disabled={!enabled}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
        checked ? "bg-[var(--primary)]" : "bg-[var(--border)]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
