import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.CODEF_CLIENT_ID;
  const clientSecret = process.env.CODEF_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "CODEF credentials not configured" },
      { status: 500 },
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const res = await fetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=read",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `CODEF token request failed: ${res.status}` },
      { status: 502 },
    );
  }

  const data = await res.json();
  return NextResponse.json({ token: data.access_token });
}
