// 브라우저 클라이언트 re-export (기존 import 호환성 유지)
// 서버 컴포넌트에서는 supabase-server.ts 사용
// 관리자 작업에는 supabase-admin.ts 사용
export { supabase, createSupabaseBrowserClient } from './supabase-browser';
