# 도름스 월드 방 서버

Cloudflare Workers + Durable Objects. 방 하나가 Durable Object 하나(방 코드로 찾는다), 공개 방 목록을 맡는 것이 하나 더 있다.
저장하지 않는다: 자리 번호, 조작 신호, 세계 요약, 방 정보만 지나가고 마지막 연결이 끊기면 방은 사라진다. 선생님 방의 방 제목과 닉네임도 방이 있는 동안 메모리에만 있다.
규칙(자리, 방장 넘기기, 크기 · 빈도 상한, 글 검사, 공개 방 목록, 선생님 방, 주소마다의 횟수 제한)은 `../platform/room-rules.ts` 에 있고 시험(`../tests/online.test.ts`, `../tests/teacher.test.ts`)이 같은 코드를 본다. 여기 `src/index.ts` 는 그것을 Workers 에 잇기만 한다.
바깥으로 나가는 것은 둘뿐이다: 선생님 방의 순위 기록(`POST https://dorms.school/api/world/ranks`)과 팩 쓰임 알림(`POST https://dorms.school/api/world/uses`). 둘 다 `Authorization: Bearer <WORLD_ROOM_SECRET>` 로 보내고, 실패해도 방은 그대로 간다.

```
npm i            # 처음 한 번
npm run dev      # 이 컴퓨터에 띄운다(로그인 필요 없음, http://localhost:8787)
npm run check    # 형식 검사
```

받는 주소:

- `GET /room/<방 코드>?mode=create|join&view=play|pad|auto&id=<창 번호>&pub=1&big=1` WebSocket
- `GET /public` 열려 있는 공개 방 목록 `[{ code, pack, stage, count }]`

받는 곳은 `https://dorms-world.vercel.app`, `https://dorms.school`, 이 컴퓨터(localhost)뿐이다(`ORIGINS`).

## 환경 값

| 이름 | 어디에 | 뜻 |
|---|---|---|
| `WORLD_ROOM_SECRET` | 운영: `npx wrangler secret put WORLD_ROOM_SECRET` · 로컬: `.dev.vars` | 도름스와 함께 아는 비밀값(32자 이상). 출입증의 서명을 확인하고 도름스에 적을 때 쓴다. **없으면 어떤 출입증도 받지 않고(모든 방이 보통 방) 도름스에 아무것도 적지 않는다** |
| `RANKS_URL`, `USES_URL` | 로컬 `.dev.vars` 에만 | 순위 · 쓰임을 적을 흉내 서버 주소. `http://localhost` · `http://127.0.0.1` 주소만 받고 그 밖의 값은 무시한다(운영 주소로 간다). 운영에서는 넣지 않는다 |
| `GATE_OFF` | 로컬 `.dev.vars` 에만 | `1` 이면 주소마다의 횟수 제한을 끈다(시험이 한 주소에서 방을 잇달아 만든다). 운영에서는 넣지 않는다 |
| `EXTRA_ORIGINS` | 로컬 `.dev.vars` 에만 | 같은 와이파이의 휴대폰으로 시험할 때 받을 주소 |

로컬에서 선생님 방을 해 보려면 `.dev.vars`(커밋하지 않는다)에 시험용 값을 넣는다. 출입증은 `scripts/net-check.mjs` 의 `makePass` 와 같은 식으로 만든다.

```
WORLD_ROOM_SECRET=test-secret-0123456789abcdef0123456789
GATE_OFF=1
```

## 신호 규약

연결: `GET /room/<방 코드>?mode=create|join&view=play|pad|auto&id=<창 번호 16자리>&pub=1&big=1` (WebSocket). 모든 글은 JSON 한 통이고, `ping` 글자에는 방을 깨우지 않고 `pong` 으로 답한다.

| 글 | 보내는 쪽 → 받는 쪽 | 내용 | 방 서버가 하는 일 |
|---|---|---|---|
| `hi` | 서버 → 새 연결 | `me`, `host`, `seats`, `room`. 선생님 방이면 `cls`(아래 `class` 와 같다), `names`, `ask`(내가 신청해 둔 닉네임) | 자리는 빈 번호 가운데 가장 작은 수 |
| `who` | 서버 → 모두 | `host`, `seats` | 들고 나거나 방장 · 보기 방식이 바뀔 때 |
| `no` | 서버 → 거절된 연결 | `c` 까닭 번호 | 글로 먼저 알리고 끊는다 |
| `p` | 손님 → 방장만 | `m` `j` `a` `n`(방장에게는 `s` 자리 번호가 붙는다) | 검사한 값으로 다시 써서 전달 |
| `s` | 방장 → 게임 화면을 보는 손님 | `d` 세계 요약 | 방장 것만, 32KB 까지 |
| `room` | 방장 → 모두 | `room` 방 정보 | 모양 검사. 새 판이 열린 때를 적어 둔다. 선생님 방에서 그 팩이 처음 열렸으면 쓰임을 알린다(팩마다 한 번, 한 방에서 열두 팩까지, 팩 모양과 스테이지 번호를 다시 본다) |
| `view` `yield` `hb` | 그대로 | | |
| `pass` | 누구나 → 서버 | `v` 출입증, `title` 방 제목, `rank` 0/1 | 연결마다 3초에 한 번, 1KB 까지. 서명(HMAC-SHA256)과 기한을 확인한다. **방을 만든 연결**의 것이면 그 방이 선생님 방이 되고(`title` · `rank` 는 이때만 쓴다), 이미 선생님 방이면 같은 교사의 것만 받는다 |
| `pass` | 서버 → 낸 연결 | `ok` 1/0 | |
| `class` | 서버 → 모두 | `cls`: `title`, `rank` 0/1, `t` 선생님 연결의 자리 번호들 · `names`: `[[자리, 닉네임]]` | 선생님 방 정보 · 승인된 닉네임 · 선생님 연결이 바뀔 때. 교사의 회원 번호와 닉네임은 싣지 않는다 |
| `name` | 누구나 → 서버 | `v` 닉네임(10자) | 선생님 방에서만. 한 줄 글로 다듬고, 연결마다 10초에 한 번(반려받으면 바로 다시). 승인 전에는 선생님 연결에게만 간다 |
| `me` | 서버 → 신청한 연결 | `st`: `wait` 보는 중 · `ok` 승인 · `no` 반려 · `bad` 쓸 수 없는 글 · `slow` 너무 자주, `v` | |
| `asks` | 서버 → 선생님 연결만 | `list`: `[[자리, 닉네임]]` 신청한 차례대로 | 신청이 바뀌거나 선생님이 확인될 때 |
| `ok` | 선생님 연결 → 서버 | `s` 자리, `y` 1 승인 / 0 반려, `v` 선생님이 본 그 닉네임 | 선생님 연결의 것만. `v` 가 지금 신청(또는 지울 닉네임)과 같을 때만 |
| `won` | 방장 → 서버 | `r` 판 번호, `ms` 방장이 잰 시간 | 아래를 모두 지나야 도름스에 적는다: 선생님 방 · 순위 켜짐 · 방 제목 있음 · 방장이 보냄 · **선생님 연결이 방에 있음** · 지금 열려 있는 판 · 팩 모양과 스테이지 번호(0~29)가 맞음 · 같은 (팩, 스테이지, 판)은 한 번 · 방 전체로 1분에 6번까지. **걸린 시간은 방 서버가 잰다**(판이 열린 때부터 이 글이 온 때까지, 3초 이상 3시간 이하). 방장이 알린 `ms` 는 견주는 데만 쓴다: 방 서버가 잰 시간보다 1.5초 넘게 길거나 2초 넘게 짧으면 받지 않는다. 팩 · 스테이지 · 방 제목 · 교사 · 사람 수(방 서버가 아는 자리 수. 함께 보기로 만든 방의 큰 화면 한 자리는 뺀다)도 방 서버가 아는 값으로 적는다 |
| `rank` | 서버 → 모두 | `r`, `ms` 방 서버가 잰 시간, `rank` 등수(0 이면 적지 못함), `best` 0/1 | 도름스가 답한 뒤 |

끊을 때의 까닭 번호: 4003 가득 참, 4004 그런 방 없음, 4009 이미 있는 코드, 4007 너무 큰 글, 4008 너무 빠름(주소마다의 횟수 제한 포함), 4010 같은 창이 다시 붙음, 4000 그 밖.
상한: 손님 글 256바이트(출입증 글만 1KB), 방장 글 32KB(방 정보 2KB), 연결마다 초당 40통(몰림 80통), 방마다 30자리.

## 주소마다의 횟수 제한

같은 인터넷 주소(`CF-Connecting-IP`, IPv6 는 앞 64비트)에서 방 만들기는 1분에 10번 · 한 시간에 60번까지, 서로 다른 틀린 방 코드를 1분에 30개 넘게 넣으면 그 주소의 들어오기를 1분 쉰다(4008). 맞는 코드로 들어오는 것은 세지 않으므로 한 반이 한꺼번에 들어와도 걸리지 않는다.
세는 곳은 `Lobby` 하나(메모리)이고, 주소는 그대로 두지 않는다: 그때그때 뽑은 값과 섞어 갈아 낸 값으로만 세고 어디에도 적지 않는다.

## 같은 와이파이의 휴대폰으로 해 보기

방 서버와 개발 서버를 바깥에서 닿는 주소로 띄운다(`npx wrangler dev --ip 0.0.0.0`, `npx vite --host`).
`room-server/.dev.vars`(커밋하지 않는다)에 `EXTRA_ORIGINS=http://<이 컴퓨터 주소>:5310` 을, 화면 쪽 빌드 변수에 `VITE_ROOM_URL=http://<이 컴퓨터 주소>:8787` 과 `VITE_PUBLIC_URL=http://<이 컴퓨터 주소>:5310`(QR 에 담길 주소)을 넣는다.

## 운영에 올리기

Cloudflare 계정 로그인이 필요하다.

```
cd room-server
npx wrangler login
npx wrangler secret list     # WORLD_ROOM_SECRET 이 있는지 본다(없으면 npx wrangler secret put WORLD_ROOM_SECRET)
npx wrangler deploy          # 끝에 나오는 주소(https://dorms-world-rooms.<계정>.workers.dev)를 적어 둔다
```

그다음 Vercel 프로젝트의 환경 변수에 `VITE_ROOM_URL=<그 주소>` 를 넣고 다시 배포한다.
`vercel.json` 의 CSP `connect-src` 에는 `https://*.workers.dev wss://*.workers.dev` 가 들어 있다. 운영 주소가 정해지면 그 주소 하나(`https://…workers.dev` 와 같은 주소의 `wss://`)로 좁힌다.
`EXTRA_ORIGINS` · `RANKS_URL` · `USES_URL` · `GATE_OFF` 는 운영에서 넣지 않는다.
