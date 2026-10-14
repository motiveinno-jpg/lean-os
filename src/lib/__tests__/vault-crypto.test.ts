import { describe, expect, it } from "vitest";
import { lockBytes, unlockBytes, lockPasswordProblem, WrongPasswordError, LOCK_MAGIC } from "../vault-crypto";

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("vault-crypto", () => {
  it("같은 비밀번호로 원본이 그대로 돌아온다", async () => {
    const plain = enc("사업자등록증 원본 — 1234567890");
    const { data, meta } = await lockBytes(plain, "correct horse", "application/pdf");
    expect(new TextDecoder().decode(data.subarray(0, LOCK_MAGIC.length))).toBe(LOCK_MAGIC);
    expect(meta).toMatchObject({ v: 1, alg: "AES-GCM", mime: "application/pdf", size: plain.byteLength });
    const back = await unlockBytes(data.buffer as ArrayBuffer, "correct horse", meta.iter);
    expect(new TextDecoder().decode(back)).toBe("사업자등록증 원본 — 1234567890");
  });

  it("잠긴 덩어리에는 원문이 보이지 않고, 같은 파일도 매번 다르게 잠긴다", async () => {
    const plain = enc("비밀 문구 SECRET-TEXT");
    const a = await lockBytes(plain, "password-1", "text/plain");
    const b = await lockBytes(plain, "password-1", "text/plain");
    expect(new TextDecoder().decode(a.data)).not.toContain("SECRET-TEXT");
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(false);
  });

  it("틀린 비밀번호는 WrongPasswordError", async () => {
    const { data } = await lockBytes(enc("x"), "password-1", "text/plain");
    await expect(unlockBytes(data.buffer as ArrayBuffer, "password-2")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("한 바이트라도 바뀌면 풀리지 않는다", async () => {
    const { data } = await lockBytes(enc("hello world"), "password-1", "text/plain");
    data[data.length - 1] ^= 1;
    await expect(unlockBytes(data.buffer as ArrayBuffer, "password-1")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("잠긴 파일이 아니면 형식 오류", async () => {
    await expect(unlockBytes(enc("plain file contents here....................."), "password-1")).rejects.toThrow("암호화된 파일 형식");
  });

  it("비밀번호 규칙", () => {
    expect(lockPasswordProblem("short")).toMatch("8자");
    expect(lockPasswordProblem("longenough", "different")).toMatch("다릅니다");
    expect(lockPasswordProblem("longenough", "longenough")).toBeNull();
  });
});
