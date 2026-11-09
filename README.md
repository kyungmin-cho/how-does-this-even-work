# assembly

AI 에이전트가 3D 화면을 직접 조작하며 제품의 조립과 이슈 해결 절차를 단계별로 보여 주는 웹 앱. pnpm 워크스페이스 모노레포.

## 구조

```
assembly/
  package.json            공통 스크립트, pnpm 워크스페이스 루트
  pnpm-workspace.yaml
  tsconfig.base.json      패키지 공통 TS 설정
  .env.example            OPENROUTER_API_KEY
  apps/
    web/                  Next.js 16 App Router 앱 (Turbopack, Tailwind 4, shadcn Base UI, AI Elements)
      src/app/            라우트, src/app/api/ 는 API 라우트 자리
      src/components/ui/  shadcn 프리미티브 (Base UI)
      src/components/ai-elements/  AI Elements 컴포넌트
      src/store/          zustand 단일 저장소 자리
      e2e/                Playwright 테스트 (headless)
  packages/
    engine/               3D 엔진 (three, camera-controls, gsap)
    ar/                   모바일 AR (iOS Quick Look, Android WebXR)
    products/             제품 모델 파일과 해결 지침서 (data/, zod 스키마)
```

`apps/web`에서는 `@assembly/engine`, `@assembly/ar`, `@assembly/products`로 import 한다 (`next.config.ts`의 `transpilePackages`).

## 스크립트 (루트에서)

| 명령 | 하는 일 |
| --- | --- |
| `pnpm dev` | web 개발 서버 |
| `pnpm build` | web 프로덕션 빌드 |
| `pnpm lint` | web ESLint |
| `pnpm typecheck` | 모든 패키지 `tsc --noEmit` (web은 `next typegen` 먼저) |
| `pnpm test:e2e` | Playwright 스모크 (headless, 포트 3100에 dev 서버 자동 기동) |

## 환경 변수

`.env.example`을 `apps/web/.env.local`로 복사해 `OPENROUTER_API_KEY`를 채운다. 키는 커밋하지 않는다.

## 참고

- `src/components/ui`, `src/components/ai-elements`, `src/hooks`는 CLI가 만든 코드다. ESLint에서 React Compiler 규칙 일부를 경고로 낮췄다.
- AI Elements는 Radix 기준으로 작성돼 Base UI판과 타입이 맞지 않는 곳이 있어 최소한으로 고쳤다 (HoverCard 지연 속성 제거, DropdownMenuItem `onSelect`를 `onClick`으로, ai v7 usage 필드 이름 등).
