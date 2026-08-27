# codef-sync 배포 방법 (2026-08-27 부터)

이 함수는 소스가 ~185KB 라 MCP `deploy_edge_function` 한 호출에 전문을 못 넣는다(출력 한도).
2026-08-27 v201 에서 전문 대신 자리표시자가 배포되는 사고가 났고, v202 부터 배포본은 **얇은 로더**다:

```ts
import "https://raw.githubusercontent.com/motiveinno-jpg/lean-os/<commit>/supabase/functions/codef-sync/index.ts";
```

- 이 저장소는 public 이라 raw URL 이 열리고, 모듈 최상위 `serve(...)` 가 import 시점에 실행된다. `../_shared/sentry.ts` 도 raw 로 같이 해결된다.
- **갱신 순서**: ① 이 폴더의 index.ts 를 고쳐 `git push` ② 로더의 `<commit>` 을 새 해시로 바꿔 `deploy_edge_function`(파일 1개, verify_jwt true) ③ 로그인한 브라우저 쿠키 JWT 로 `list-accounts` 200 확인.
- 로컬 index.ts 는 계속 전문 소스다. 로더에는 절대 자리표시자를 넣지 않는다.
