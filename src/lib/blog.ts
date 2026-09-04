// 블로그 — 저장소의 마크다운(content/blog/*.md)을 읽어 목록·본문을 만든다.
//   글은 사람이 쓰든 클라우드 루틴이 쓰든 파일 하나면 된다(docs/BLOG_PLAYBOOK.md). 빌드 시 정적으로 굳는다.
//   머리말(frontmatter) 키: title(필수) · description(필수) · date(YYYY-MM-DD, 필수) · tags(쉼표) · cover(/blog/<slug>/파일) · draft(true 면 숨김)
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  cover: string | null;
  draft: boolean;
  html: string;
  readMinutes: number;
};

const DIR = path.join(process.cwd(), "content", "blog");

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

function toPost(slug: string, raw: string): BlogPost | null {
  const { meta, body } = parseFrontmatter(raw);
  if (!meta.title || !meta.date) return null;
  const html = marked.parse(body, { gfm: true, breaks: false }) as string;
  const words = body.replace(/[#*_`>\-\[\]()!]/g, " ").split(/\s+/).filter(Boolean).length;
  return {
    slug,
    title: meta.title,
    description: meta.description || "",
    date: meta.date,
    tags: (meta.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
    cover: meta.cover || null,
    draft: meta.draft === "true",
    html,
    //   한글은 글자 수로 읽는 시간을 어림한다 — 분당 500자
    readMinutes: Math.max(1, Math.round(Math.max(words * 2, body.length) / 500)),
  };
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(DIR)) return [];
  const posts: BlogPost[] = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".md")) continue;
    const slug = f.replace(/\.md$/, "");
    const post = toPost(slug, fs.readFileSync(path.join(DIR, f), "utf8"));
    if (post && !post.draft) posts.push(post);
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function getPost(slug: string): BlogPost | null {
  const file = path.join(DIR, `${slug}.md`);
  if (!/^[a-z0-9-]+$/.test(slug) || !fs.existsSync(file)) return null;
  const post = toPost(slug, fs.readFileSync(file, "utf8"));
  return post && !post.draft ? post : null;
}
