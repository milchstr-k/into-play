# 入境·GameCraft

AI驱动的资料游戏化引擎。

入境·GameCraft 是一个 Hackathon 版 Web demo：用户粘贴任意文字、SOP、课程材料、产品说明或活动规则，Agent 会理解内容信号，选择最合适的 playable 骨架，并生成一个可直接试玩的互动游戏。当前主力骨架包含 `Misconception Raid`、`Recall Defense` 和 `Memory Survivor`，结算时用 `Memory score` 与 `Play proof` 证明用户不是被动浏览，而是真的完成了记忆动作。

## Product Shape

比赛版只做一个核心页面：

```text
Paste text -> Agent picks skeleton -> Play -> Memory proof
```

它不是学习计划工具，也不是完整创作者后台。当前形态是一个 Web app：输入内容后进入 GameCraft 玩法库 / Playable stage，Agent 会展示选择理由，再渲染稳定可玩的游戏骨架并展示 proof。

## Run

```bash
npm install
npm run dev
```

Open the local or network URL printed by Vite.

To let other devices on the same LAN use the demo, run:

```bash
npm run dev:full
```

Then open the network URL from another device:

```text
http://<your-local-ip>:5173/
```

On this machine, you can find the current local IP with:

```bash
ipconfig getifaddr en0
```

The frontend listens on `0.0.0.0`, and Vite proxies `/api/*` to the local Agent server at `127.0.0.1:8787`, so other users do not need to configure the API address manually.

## Current Demo Flow

1. Paste ordinary text.
2. 入境·GameCraft extracts keywords and likely memory traps.
3. Agent chooses `Misconception Raid`, `Recall Defense`, or `Memory Survivor` and explains why.
4. The user plays through scan/break/repair, tower-defense, or survivor interactions.
5. The page produces `Memory score`, captured events, and `Play proof`.

## Current Frontend

- `src/App.tsx`: single-page Agent playable demo with Phaser Boss, dnd-kit card stack, proof events, and template atlas.
- `src/App.css`: responsive visual system, playable stage, game HUDs, proof states, and desktop-first layout.
- `public/assets/kenney-*`: included Kenney game assets. The bundled license files mark these packs as CC0 / public domain, with credit appreciated but not mandatory.

## Research And Plan

See [docs/research-and-plan.md](docs/research-and-plan.md).
