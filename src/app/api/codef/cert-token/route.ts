import { NextResponse } from "next/server";

const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

export async function GET() {
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
