import { GET as run } from "../route";
export const runtime = "nodejs";
export const maxDuration = 300;
export function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.set("mode", "collect");
  return run(new Request(url, { headers: req.headers }));
}
