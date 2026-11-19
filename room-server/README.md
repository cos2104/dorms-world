# 도름스 월드 방 서버

Cloudflare Workers + Durable Objects. 방 하나가 Durable Object 하나(방 코드로 찾는다), 공개 방 목록을 맡는 것이 하나 더 있다.
저장하지 않는다: 자리 번호, 조작 신호, 세계 요약, 방 정보만 지나가고 마지막 연결이 끊기면 방은 사라진다.
규칙(자리, 방장 넘기기, 크기 · 빈도 상한, 글 검사, 공개 방 목록)은 `../platform/room-rules.ts` 에 있고 시험(`../tests/online.test.ts`)이 같은 코드를 본다. 여기 `src/index.ts` 는 그것을 Workers 에 잇기만 한다.

```
npm i            # 처음 한 번
npm run dev      # 이 컴퓨터에 띄운다(로그인 필요 없음, http://localhost:8787)
npm run check    # 형식 검사
```

받는 주소:

- `GET /room/<방 코드>?mode=create|join&view=play|pad|auto&id=<창 번호>&pub=1&big=1` WebSocket
- `GET /public` 열려 있는 공개 방 목록 `[{ code, pack, stage, count }]`

받는 곳은 `https://dorms-world.vercel.app`, `https://dorms.school`, 이 컴퓨터(localhost)뿐이다(`ORIGINS`).

## 같은 와이파이의 휴대폰으로 해 보기

방 서버와 개발 서버를 바깥에서 닿는 주소로 띄운다(`npx wrangler dev --ip 0.0.0.0`, `npx vite --host`).
`room-server/.dev.vars`(커밋하지 않는다)에 `EXTRA_ORIGINS=http://<이 컴퓨터 주소>:5310` 을, 화면 쪽 빌드 변수에 `VITE_ROOM_URL=http://<이 컴퓨터 주소>:8787` 과 `VITE_PUBLIC_URL=http://<이 컴퓨터 주소>:5310`(QR 에 담길 주소)을 넣는다.

## 운영에 올리기

Cloudflare 계정 로그인이 필요하다.

```
cd room-server
npx wrangler login
npx wrangler deploy          # 끝에 나오는 주소(https://dorms-world-rooms.<계정>.workers.dev)를 적어 둔다
```

그다음 Vercel 프로젝트의 환경 변수에 `VITE_ROOM_URL=<그 주소>` 를 넣고 다시 배포한다.
`vercel.json` 의 CSP `connect-src` 에는 `https://*.workers.dev wss://*.workers.dev` 가 들어 있다. 운영 주소가 정해지면 그 주소 하나(`https://…workers.dev` 와 같은 주소의 `wss://`)로 좁힌다.
`EXTRA_ORIGINS` 는 운영에서 비워 둔다. 방 코드를 훑거나 방을 마구 만드는 것을 막으려면 Cloudflare 쪽에서 `/room/` 경로에 IP 당 연결 수 제한(Rate limiting rule)을 거는 것을 권한다(코드에는 IP 당 제한이 없다).
