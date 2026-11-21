# 도름스 월드

도름이 2~30명이 힘을 합쳐야 풀리는 2D 협력 게임이에요. 선생님이 자기 수업 내용으로 스테이지를 만들어 올리고, 학생들이 함께 풀어요.

- 하러 가기: https://dorms.school/world
- 만들러 가기: 위 주소의 '게임 만들기'. 안내문을 복사해 내 컴퓨터의 코딩 AI 에 붙여 넣으면 시작돼요.

## 선생님이 게임을 만들 때

내 컴퓨터에서 도는 코딩 AI(Claude Code, Codex 등)에 `kit/COPY_PROMPT.md` 의 안내문을 붙여 넣으세요. AI 가 이 저장소를 내려받고, 게임을 내 컴퓨터에 띄우고, 수업 자료를 물은 뒤 아이디어부터 도름스로 보내기까지 함께 해요.

| 순서 | 하는 일 |
|---|---|
| 준비 | `npm i`, `npm run dev` 로 게임을 띄워 화면으로 본다 |
| 자료 읽기, 아이디어, 설계 | AI 와 주고받으며 "게임을 깨는 일이 곧 그 개념을 쓰는 일"이 되게 정한다 |
| 만들기 | `packs/<교과>/<팩>/` 에 지도, 설정, 그림을 쓴다 |
| 직접 해 보기 | 내 컴퓨터 화면에서 2명, 8명, 30명으로 끝까지 |
| 도름스로 보내기 | `npm run submit -- <교과>/<팩>` (도름스 로그인만 있으면 돼요) |
| 실리기 | 운영자가 직접 해 보고 승인하면 `dorms.school/world` 에 실린다 |

수업 자료는 선생님 컴퓨터에서 선생님의 AI 가 읽어요. 이 저장소나 도름스로 올라가지 않아요. 보내는 것은 팩 폴더의 글 파일(설계서, 지도, 그림)이고, 운영자가 승인하면 도름스 닉네임과 함께 실려요.

## 폴더

- `platform/` 판: 지도 읽기(`stage.ts`), 물리와 장치(`sim.ts`), 저울의 식(`equation.ts`), 글자 그림(`sprite.ts`), 그리기(`render.ts`), 화풍(`look.ts`), 화면 부품(`ui/`), 온라인(`room-rules.ts`, `net.ts`, `sync.ts`)
- `packs/<교과>/<팩>/` 스테이지 묶음: `pack.json`, `DESIGN.md`, `stages/NN.map.txt`, `stages/NN.json`, `sprites/*.txt`
- `kit/` 선생님의 AI 가 읽는 하네스: 순서(`skills/coop-game/SKILL.md`), 형식(`STAGE_FORMAT.md`), 그림(`ART_GUIDE.md`), 새 장치(`DEVICE_GUIDE.md`), 설계서 틀(`DESIGN.template.md`)
- `src/` 화면: 처음 화면, 팩 화면, 게임 화면, 게임 만들기, 요청 검토, 온라인으로 함께 하기(`online.ts`)
- `room-server/` 방 서버(Cloudflare Workers + Durable Objects). 따로 설치하고 따로 올린다(`room-server/README.md`)
- `tests/` 물리, 저울, 글자 그림, 팩 검사, 봇이 끝까지 깨 보기, 온라인 규칙(방 · 요약 · 연결)
- `scripts/` 도름스로 보내기(`submit-pack.mjs`), 승인된 팩 싣기(`publish-approved.mjs`, GitHub Actions 가 돌림), 팩 파일 검사, 화면 찍기, 온라인 끝까지 돌려 보기(`net-check.mjs`)

```
npm i
npm run dev          # http://localhost:5310/world/
npm test             # 전체 시험
npm run check:packs  # 팩 검사만
npm run build
npm run check:security          # 도름스체크 보안 점검(코드만)
npm run units -- ms1 수학        # 오락실 단원 이름 찾기
npm run submit -- <교과>/<팩>   # 도름스로 보내기
```

조작: 움직이기 ← →(A D), 뛰기 스페이스(↑ W Z), 확인 엔터(E X: 문에 들어가기, 들고 놓기, 레버 당기기), 도름이 바꾸기 Tab.

## 화풍을 하나로 지키는 약속

- 스테이지의 그림은 글자로 찍는다. 쓸 수 있는 물감이 정해져 있고 가장자리는 남색 윤곽으로 두른다(`kit/ART_GUIDE.md`). 검사가 본다.
- 화면 부품(창, 단추)은 판의 것만 쓴다.
- 팩 안에는 자료만 둔다(코드 없음). 새 움직임이 필요하면 판에 장치를 더하고(`kit/DEVICE_GUIDE.md`), 그 요청은 운영자가 코드를 살펴본 뒤 싣는다.

## 온라인으로 함께 하기

방을 만들고(공개 여부 · 방식 고르기) QR, 방 코드, 공개 방 목록으로 들어온다. 가입도 이름 입력도 없고, 들어온 차례대로 색과 번호가 정해진다. 한 방에 30명까지.
방식은 둘이고 한 방에 섞여도 된다: **각자 화면**(자기 기기에서 게임 화면을 보며 조작) / **함께 보기**(방을 연 큰 화면에 모두가 보이고, 다른 사람은 휴대폰을 조작기로만 씀).
물리는 방장 기기만 돌리고, 손님은 조작만 보내며 방장이 초당 스무 번 보내는 세계 요약을 받아 그린다. 방장이 나가면 그다음으로 오래된 사람이 이어받는다.
방 서버는 저장하지 않는다. 자리 번호, 조작 신호, 세계 요약, 방 정보만 지나가고, 화면에 뜨는 글은 모두 그 기기의 코드가 만든 것이다(다른 기기가 보낸 글자를 그리는 칸이 없다).

방 서버 주소는 빌드 변수 `VITE_ROOM_URL` 로 준다. **이 값이 비어 있으면 온라인 들머리(방 만들기 · 방 코드 · 공개 방)를 아예 그리지 않는다.**

```
npm --prefix room-server i                      # 처음 한 번(wrangler)
npm --prefix room-server run dev                # 방 서버를 이 컴퓨터에 띄운다(로그인 필요 없음, http://localhost:8787)
VITE_ROOM_URL=http://localhost:8787 npm run dev # 또는 .env.development.local 에 같은 줄(커밋하지 않는다)
node scripts/net-check.mjs --shots              # 방 서버와 개발 서버를 스스로 띄워 브라우저 여러 대로 끝까지 돌려 본다
```

운영에 올리는 순서와 같은 와이파이의 휴대폰으로 해 보는 법은 `room-server/README.md`.

## 권리

- 코드와 하네스 글: © 도름스. 라이선스는 정하는 중이에요. 도름스 월드에 실을 팩을 만들려고 내려받아 실행하고 고치는 것은 괜찮아요.
- 보낸 팩은 만든 선생님의 것이고, 도름스 월드에 실어 누구나 하고 다른 선생님이 본보기로 볼 수 있게 하는 데 동의하고 보내는 것으로 봐요.
- `public/sprites/doreumi-atlas.png`: 도름이 © 아인T, CC BY-NC 4.0.
- `public/sprites/hf_*.png`: Higgsfield 로 뽑은 타일과 장치 그림.
- `public/fonts/`: Galmuri(SIL OFL 1.1, `OFL.txt`).
- 하네스가 참고한 것: `kit/NOTICE.md`.
