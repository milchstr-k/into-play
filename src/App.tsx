import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, MutableRefObject, PointerEvent, ReactNode, SyntheticEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { gsap } from "gsap";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { useDropzone } from "react-dropzone";
import Particles, { ParticlesProvider, useParticlesProvider } from "@tsparticles/react";
import type { Engine, ISourceOptions } from "@tsparticles/engine";
import { loadSlim } from "@tsparticles/slim";
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  Code2,
  Cpu,
  FileUp,
  Gamepad2,
  Layers3,
  Play,
  RefreshCcw,
  Rocket,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Zap,
} from "lucide-react";

type Phase = "input" | "generating" | "play" | "proof";
type View = "upload" | "games" | "play";
type MaterialType = "notes" | "pdf" | "slides" | "video" | "quiz";
// 骨架（Skeleton）。每个骨架背后是一套验证过的、自洽可玩的真实组件。
// "cards"：误区围剿（Phaser Boss 战）。"lane"：知识塔防（PvZ 式格子塔防）。
// "survivor"：知识幸存者（吸血鬼幸存者式肉鸽，答题得金币升级，人物自动杀怪）。
type GameMode = "cards" | "lane" | "survivor";

// 一回合的内容。结构受所属骨架约束：
// - misconception-raid 骨架：用 choices + answerIndex 做 Boss 战选项
// - lane 骨架：每道题 choices + answerIndex，答对产建塔能量
type Stage = {
  id: string;
  title: string;
  prompt: string;
  trap: string;
  choices: string[];
  answerIndex: number;
  feedback: string;
};

// 动效气质：同一骨架下，不同气质映射到不同的动效参数，让玩法「不像换皮」。
type Mood = "tense" | "calm" | "playful";

// 六维玩法方案（Agent 的产出）。Agent 自由生成 goal/feedback/mood，
// scene(skeleton)/interaction/rules 受骨架槽位约束。stages 即每回合内容（PlayRound[]）。
type PlaySpec = {
  skeleton: GameMode;
  goal: string;
  mood: Mood;
  feedback: { hit: string; miss: string };
  stages: Stage[];
};

type QuestGame = {
  title: string;
  materialLabel: string;
  modeLabel: string;
  schema: string;
  keywords: string[];
  boss: string;
  decision: AgentDecision;
  spec: PlaySpec;
  stages: Stage[];
  exports: string[];
};

type AgentDecision = {
  confidence: number;
  mode: GameMode;
  reasons: string[];
  signals: string[];
  title: string;
};

type PlayEvent = {
  id: string;
  advances: boolean;
  correct: boolean;
  choice: string;
  feedback: string;
  kind: "guarded" | "hit" | "miss";
  runtimeStatus: string;
  stageId: string;
  stageTitle: string;
};

type FeedbackTone = "stack" | "success" | "miss";
type LaneEnergyOrigin = { x: number; y: number; streak?: number };
type AgentStatus = "local" | "extracting" | "model" | "fallback";
type ModelPlaySpecResult = { decision: AgentDecision; spec: PlaySpec };
type KnowledgeUnit = { anchor: string; fact: string; example?: string; kind: "definition" | "fact" };

const audioAssets: Partial<Record<FeedbackTone, string>> = {
  miss: "/assets/kenney-boardgame/chipsCollide1.ogg",
  stack: "/assets/kenney-boardgame/cardPlace1.ogg",
  success: "/assets/kenney-boardgame/cardPlace1.ogg",
};

const materialTypes: Array<{ id: MaterialType; label: string; sample: string }> = [
  {
    id: "notes",
    label: "逃生训练",
    sample: "起火撤离：宿舍或教室起火时，先判断烟雾方向，低姿弯腰沿安全出口撤离。\n电梯误区：不要乘坐电梯，因为断电或烟囱效应会让电梯井聚烟。\n门把判断：门把手发烫时不要开门，应堵住门缝，到窗口发出求救信号。\n身上着火：不要奔跑，应就地打滚或用厚衣物覆盖灭火。\n湿毛巾作用：只能减少吸入烟尘，不能当作穿越浓烟的通行证。\n集合点规则：必须清点人数，不要返回火场拿物品。\n报警信息：拨打119时要说清地址、起火物、是否有人被困和联系电话。",
  },
  {
    id: "pdf",
    label: "反诈识别",
    sample: "客服退款：冒充客服说退款或理赔时，先在官方App内核验订单，不要点击短信里的陌生链接。\n屏幕共享：任何人要求开启屏幕共享、远程控制或下载会议软件，都可能看到验证码和银行卡信息。\n安全账户：公安机关不会要求把钱转到安全账户，转账自证清白就是诈骗。\n验证码规则：验证码只用于本人确认操作，不能告诉客服、同学或群管理员。\n冻结威胁：遇到马上冻结账户这类威胁时，先挂断电话，通过官方客服电话或96110核实。\n下载风险：不要安装对方发来的非官方App，尤其是要求读取短信、通讯录或通知权限的应用。",
  },
  {
    id: "slides",
    label: "发布SOP",
    sample: "发布边界：产品发布前必须写清目标用户、核心场景、成功指标和不做什么。\n灰度发布：先给低风险用户，观察崩溃率、转化率和投诉关键词。\n扩量判断：指标异常时先暂停扩量，不要为了赶进度继续放量。\n回滚开关：每个版本都要准备回滚开关，不能只依赖重新发版。\n客服口径：要说明变化、影响范围和用户下一步动作。\n复盘格式：比较预期指标和实际指标，记录一个保留动作、一个停止动作和一个下次实验。",
  },
  {
    id: "video",
    label: "AED急救",
    sample: "现场安全：使用AED前先确认现场安全，再拍打双肩呼叫患者。\n启动救援：没有反应且呼吸异常时，立即让旁人拨打120并取AED。\n按压位置：胸外按压在两乳头连线中点，频率每分钟100到120次，深度约5到6厘米。\n贴片位置：AED贴片按图示贴在右上胸和左侧胸下。\n分析心律：机器分析心律时所有人不要触碰患者。\n电击操作：提示电击时确认无人接触再按下电击键。\n继续按压：电击后立刻继续胸外按压，不要停下来观察太久。",
  },
  {
    id: "quiz",
    label: "极值错题",
    sample: "极值入口：函数极值不能只看导数等于0，驻点、不可导点和区间端点都要检查。\n一阶导判断：导数从正变负是极大值，从负变正是极小值。\n非极值情况：导数不变号通常不是极值，即使该点导数等于0。\n二阶导判断：二阶导大于0常用于判断极小值，小于0常用于判断极大值。\n二阶导失效：二阶导等于0时不能直接下结论，需要回到一阶导或函数值比较。\n闭区间最值：要把端点函数值和内部极值一起比较。",
  },
];
const gameModeIds = new Set<GameMode>(["cards", "lane", "survivor"]);
const moodIds = new Set<Mood>(["tense", "calm", "playful"]);
const maxContentChars = 12000;
const modelGenerationTimeoutMs = 15000;
const structuralLabels = new Set([
  "english",
  "meaning",
  "example",
  "definition",
  "content",
  "source",
  "material",
  "prompt",
  "file",
  "title",
  "note",
  "notes",
  "question",
  "answer",
  "choice",
]);

const gameModes: Array<{
  id: GameMode;
  label: string;
  short: string;
  schema: string;
  filter: "solo" | "multi";
  rating: string;
  accent: string;
  fit: string;
  mechanic: string;
}> = [
  { id: "cards", label: "Misconception Raid", short: "误区围剿", schema: "misconception_raid_quest", filter: "solo", rating: "4.8", accent: "gold", fit: "常见错误、培训纠偏", mechanic: "识别 · 破盾 · 修正" },
  { id: "lane", label: "Recall Defense", short: "记忆塔防", schema: "lane_defense_quest", filter: "solo", rating: "4.9", accent: "mint", fit: "流程、规则、概念记忆", mechanic: "答题得能量 · 建塔防御" },
  { id: "survivor", label: "Memory Survivor", short: "记忆幸存", schema: "survivor_quest", filter: "solo", rating: "4.9", accent: "rose", fit: "碎片科普、记忆点、趣味闯关", mechanic: "答题得金币 · 自动杀怪 · 升级变强" },
];
const showcasedGameModes = gameModes;
const productName = "入境·GameCraft";
const productPositioning = "AI驱动的资料游戏化引擎";
const productHeadline = `${productName}：${productPositioning}`;
const productIntro = "AI 解析资料结构，动态匹配玩法、反馈与通关规则，生成可试玩的游戏化内容。";

const steps = ["解析", "改编", "生成", "试玩", "Proof"];
const orbitLabels = ["资料", "信号", "玩法", "运行", "Proof", "分享"];
const particleOptions: ISourceOptions = {
  fullScreen: { enable: false },
  detectRetina: true,
  background: { color: { value: "transparent" } },
  fpsLimit: 60,
  particles: {
    number: { value: 74, density: { enable: true } },
    color: { value: ["#1769ff", "#18c8ff", "#82f44a", "#7c6cff"] },
    links: {
      enable: true,
      color: "#63d7ff",
      distance: 136,
      opacity: 0.22,
      width: 1,
    },
    move: {
      enable: true,
      speed: 0.58,
      direction: "none",
      outModes: { default: "out" },
    },
    opacity: {
      value: { min: 0.22, max: 0.78 },
      animation: { enable: true, speed: 0.75, sync: false },
    },
    shape: { type: "circle" },
    size: {
      value: { min: 1.2, max: 3.7 },
      animation: { enable: true, speed: 1.8, sync: false },
    },
  },
  interactivity: {
    events: {
      onHover: { enable: true, mode: "repulse" },
      resize: { enable: true },
    },
    modes: {
      repulse: { distance: 86, duration: 0.35 },
    },
  },
};

const materialLabel = new Map(materialTypes.map((item) => [item.id, item.label]));
const modeLabel = new Map(gameModes.map((item) => [item.id, item.label]));
const modeSchema = new Map(gameModes.map((item) => [item.id, item.schema]));
const modeRouteLabel = new Map<GameMode, string>([
  ["cards", "误区围剿路线"],
  ["lane", "记忆塔防路线"],
  ["survivor", "幸存闯关路线"],
]);
const initParticles = async (engine: Engine) => {
  await loadSlim(engine);
};

function trackSpotlight(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--px", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--py", `${event.clientY - rect.top}px`);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

let audioContext: AudioContext | null = null;

function playFeedbackTone(type: FeedbackTone) {
  if (typeof window === "undefined") return;
  const asset = audioAssets[type];
  if (asset) {
    const audio = new Audio(asset);
    audio.volume = type === "miss" ? 0.34 : 0.28;
    void audio.play().catch(() => undefined);
    return;
  }

  const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;

  audioContext ??= new AudioCtor();
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const frequency = type === "miss" ? 136 : type === "stack" ? 392 : 620;

  oscillator.type = type === "miss" ? "sawtooth" : "triangle";
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(type === "miss" ? 92 : frequency * 1.35, now + 0.16);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(type === "miss" ? 0.07 : 0.052, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.22);
}

function extractKeywords(content: string) {
  const chinese = content.match(/[\p{Script=Han}]{2,6}/gu) ?? [];
  const english = content
    .replace(/[^\p{Script=Han}a-zA-Z0-9\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => /^[a-zA-Z0-9]{4,}$/.test(word) && !structuralLabels.has(word.toLowerCase()));
  return Array.from(new Set([...chinese, ...english])).slice(0, 7);
}

function compact(value: string | null | undefined, max = 9) {
  const text = value?.trim() || "未命名";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function cleanLearningText(value: string | null | undefined, max = 120) {
  return compact(
    (value ?? "")
      .replace(/\s+/g, " ")
      .replace(/^[-*•\d.)\s]+/, "")
      .replace(/^(meaning|definition|example|content|source|title)\s*[:：]\s*/i, "")
      .trim(),
    max,
  );
}

function isStructuralLabel(value: string) {
  if (/\p{Script=Han}/u.test(value)) return false;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return !normalized || structuralLabels.has(normalized);
}

function misconceptionChoiceFromFact(fact: string) {
  const text = cleanLearningText(fact, 120);
  const inversePatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/不会要求([^，。；;,.]+)/u, (match) => `会要求${cleanLearningText(match[1], 30)}`],
    [/不要([^，。；;,.]+)/u, (match) => `可以${cleanLearningText(match[1], 30)}，问题不大`],
    [/不能([^，。；;,.]+)/u, (match) => `可以${cleanLearningText(match[1], 30)}，不会影响结果`],
    [/必须([^，。；;,.]+)/u, (match) => `可以跳过${cleanLearningText(match[1], 30)}`],
    [/先([^，。；;,.]+).*再([^，。；;,.]+)/u, (match) => `先${cleanLearningText(match[2], 24)}，再${cleanLearningText(match[1], 24)}`],
    [/立即([^，。；;,.]+)/u, (match) => `等情况明朗后再${cleanLearningText(match[1], 30)}`],
  ];

  for (const [pattern, build] of inversePatterns) {
    const match = text.match(pattern);
    if (match) return build(match);
  }

  return "";
}

function extractKnowledgeUnits(content: string): KnowledgeUnit[] {
  const text = content.replace(/\r/g, "").trim();
  const units: KnowledgeUnit[] = [];
  const seen = new Set<string>();

  function addUnit(anchor: string, fact: string, example = "", kind: KnowledgeUnit["kind"] = "fact") {
    const cleanedAnchor = cleanLearningText(anchor, 36).replace(/[：:]+$/, "");
    const cleanedFact = cleanLearningText(fact, 140);
    const cleanedExample = cleanLearningText(example, 140);
    const key = `${cleanedAnchor.toLowerCase()}::${cleanedFact.toLowerCase()}`;
    if (isStructuralLabel(cleanedAnchor) || cleanedFact.length < 5 || seen.has(key)) return;
    seen.add(key);
    units.push({ anchor: cleanedAnchor, fact: cleanedFact, example: cleanedExample, kind });
  }

  const vocabPattern = /(?:^|\n)\s*(?:\d+[\).]\s*)?([A-Za-z][A-Za-z -]{1,40})\s*\n\s*(?:Meaning|Definition)\s*[:：]\s*([^\n]+)(?:\n\s*(?:Example|Sentence)\s*[:：]\s*([^\n]+))?/gi;
  for (const match of text.matchAll(vocabPattern)) {
    addUnit(match[1], match[2], match[3] ?? "", "definition");
  }

  const inlineVocabPattern = /(?:^|\s)(?:\d+[\).]\s*)?([A-Za-z][A-Za-z -]{1,40})\s+(?:Meaning|Definition)\s*[:：]\s*(.*?)(?:\s+(?:Example|Sentence)\s*[:：]\s*(.*?))(?=\s+\d+[\).]\s*[A-Za-z]|\s*$)/gi;
  for (const match of text.matchAll(inlineVocabPattern)) {
    addUnit(match[1], match[2], match[3] ?? "", "definition");
  }

  for (const line of text.split(/\n+/)) {
    const pair = line.match(/^\s*(?:[-*•]\s*)?([^:：]{2,36})[:：]\s*(.{6,180})$/u);
    if (pair) addUnit(pair[1], pair[2], "", "fact");
  }

  const sentences = text
    .replace(/[【】「」《》]/g, "")
    .split(/[。！？!?；;\n]+/u)
    .map((item) => cleanLearningText(item, 160))
    .filter((item) => item.length >= 8);
  for (const sentence of sentences) {
    const anchor =
      sentence.match(/^([A-Za-z][A-Za-z -]{1,32})\s+(?:means|refers to|is|are)\s+/i)?.[1]
      ?? sentence.match(/^([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 -]{1,24}?)(?:是|指|需要|必须|可以|能够|包含|包括|用于)/u)?.[1]
      ?? sentence.split(/\s+/).find((word) => /^[A-Za-z0-9-]{4,}$/.test(word) && !structuralLabels.has(word.toLowerCase()))
      ?? sentence.match(/[\p{Script=Han}]{2,8}/u)?.[0]
      ?? `要点${units.length + 1}`;
    addUnit(anchor, sentence, "", "fact");
  }

  return units.slice(0, 16);
}

function unitWrongChoices(unit: KnowledgeUnit, units: KnowledgeUnit[]) {
  const otherFacts = units
    .filter((item) => item !== unit)
    .map((item) => cleanLearningText(item.fact, 74))
    .filter(Boolean);
  const wrongs = [misconceptionChoiceFromFact(unit.fact), ...otherFacts].filter(Boolean);
  if (unit.kind === "definition") {
    wrongs.push(`把 ${unit.anchor} 理解成另一条资料概念`);
    wrongs.push(`${unit.anchor} 表示和原文相反的意思`);
  } else {
    wrongs.push(`只看表面，没有抓住「${unit.anchor}」的资料事实`);
    wrongs.push(`把「${unit.anchor}」解释成资料没有提到的结论`);
  }
  return wrongs.slice(0, 2);
}

function buildStagesFromUnits(mode: GameMode, units: KnowledgeUnit[]) {
  const count = mode === "cards" ? 3 : 12;
  return Array.from({ length: count }, (_, index): Stage => {
    const unit = units[index % units.length];
    const [wrongA, wrongB] = unitWrongChoices(unit, units);
    const answerIndex = index % 3;
    const correct = cleanLearningText(unit.fact, 74);
    const prompt = unit.kind === "definition"
      ? `“${unit.anchor}” 的含义更接近哪一项？`
      : `关于“${unit.anchor}”，哪一项最符合资料？`;
    return {
      id: mode === "cards" ? ["scan", "break", "repair"][index] ?? `q${index + 1}` : `q${index + 1}`,
      title: mode === "cards" ? ["识别", "破盾", "修正"][index] ?? `Q${index + 1}` : `Q${index + 1}`,
      prompt,
      trap: cleanLearningText(wrongA, 64),
      choices: arrangeChoices(correct, cleanLearningText(wrongA, 74), cleanLearningText(wrongB, 74), answerIndex),
      answerIndex,
      feedback: unit.example ? `${unit.anchor}: ${correct} 例句：${cleanLearningText(unit.example, 86)}` : `${unit.anchor}: ${correct}`,
    };
  });
}

function extractContentFacts(content: string, keywords: string[]) {
  const normalized = content
    .replace(/[【】「」《》]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const rawFacts = normalized
    .split(/[。！？!?；;\n]+/u)
    .map((item) => item.replace(/^[^:：]{1,10}[:：]/, "").trim())
    .map((item) => item.replace(/^(示例内容|章节资料|PDF资料|视频字幕|市场课件|错题本|课程资料|课件)\s*[:：]?/, "").trim())
    .filter((item) => item.length >= 5);
  const facts = Array.from(new Set(rawFacts)).slice(0, 12);
  if (facts.length >= 3) return facts;

  const keywordFacts = keywords
    .filter((item) => item.length >= 2)
    .slice(0, 8)
    .map((item) => `${item}是这份资料里的关键记忆点`);
  return keywordFacts.length >= 3
    ? keywordFacts
    : ["内容要点需要被准确提炼", "互动反馈帮助用户记住重点", "错误选择应该暴露误区来源"];
}

function cleanAnchor(value: string) {
  const cleaned = value
    .replace(/[，,。！？!?；;：:\s]+/g, "")
    .replace(/[把和与及的了是要需应会能可]+$/u, "")
    .trim();
  return compact(cleaned || value, 8);
}

function formatFactForChoice(fact: string) {
  const stripped = fact.trim().replace(/^[^:：]{1,10}[:：]/, "");
  const baPattern = stripped.match(/^(.{2,10}?)把(.+)$/u);
  if (baPattern) return `${cleanAnchor(baPattern[1])}：${baPattern[2].trim()}`;
  return stripped;
}

function factAnchor(fact: string, keywords: string[]) {
  const readable = fact.replace(/[【】「」《》]/g, "").trim();
  const explicitSubject = readable.match(/^(.{2,10}?)(?:把|需要|应该|必须|可以|要|能|会|是|为|写清|记录|拆成|提供|控制|储存|提升|减少|建立|判断)/u)?.[1];
  if (explicitSubject) return cleanAnchor(explicitSubject);

  const keyword = keywords.find((item) => item.length >= 2 && fact.includes(item));
  if (keyword) return cleanAnchor(keyword);

  const chinese = fact.match(/[\p{Script=Han}]{2,6}/u)?.[0];
  if (chinese) return cleanAnchor(chinese);

  return compact(fact.replace(/[^a-zA-Z0-9]+/g, " "), 8);
}

function arrangeChoices(correct: string, wrongA: string, wrongB: string, answerIndex: number) {
  if (answerIndex === 1) return [wrongA, correct, wrongB];
  if (answerIndex === 2) return [wrongA, wrongB, correct];
  return [correct, wrongA, wrongB];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function textValue(value: unknown, max = 80) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return compact(text, max);
}

function stringList(value: unknown, maxItems = 4, maxChars = 24) {
  return Array.isArray(value) ? value.map((item) => textValue(item, maxChars)).filter(Boolean).slice(0, maxItems) : [];
}

function agentApiUrls(path: string) {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const base = env?.VITE_INTOPLAY_AGENT_URL?.replace(/\/$/, "");
  const sameHost =
    typeof window === "undefined" || !window.location.hostname
      ? ""
      : `http://${window.location.hostname}:8787${path}`;
  return Array.from(new Set([
    base ? `${base}${path}` : "",
    path,
    sameHost,
    `http://127.0.0.1:8787${path}`,
  ].filter(Boolean)));
}

async function postFileToAgent<T>(path: string, file: File, timeout = 20000): Promise<T | null> {
  for (const url of agentApiUrls(path)) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
      window.clearTimeout(timer);
      if (!response.ok) continue;
      return await response.json() as T;
    } catch {
      window.clearTimeout(timer);
    }
  }
  return null;
}

async function postJsonToAgent<T>(path: string, payload: unknown, timeout = 30000): Promise<T | null> {
  for (const url of agentApiUrls(path)) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      if (!response.ok) continue;
      return await response.json() as T;
    } catch {
      window.clearTimeout(timer);
    }
  }
  return null;
}

function normalizeIncomingStage(value: unknown, index: number, mode: GameMode): Stage | null {
  if (!isRecord(value)) return null;
  const choices = stringList(value.choices, 3, 90);
  if (choices.length < 2) return null;
  const answerIndex = typeof value.answerIndex === "number" && Number.isInteger(value.answerIndex) ? value.answerIndex : 0;
  if (answerIndex < 0 || answerIndex >= choices.length) return null;

  return {
    id: textValue(value.id, 18) || (mode === "cards" ? ["scan", "break", "repair"][index] ?? `q${index + 1}` : `q${index + 1}`),
    title: textValue(value.title, 18) || (mode === "cards" ? ["Scan", "Break", "Repair"][index] ?? `Q${index + 1}` : `Q${index + 1}`),
    prompt: textValue(value.prompt, 150),
    trap: textValue(value.trap, 90) || textValue(choices.find((_, choiceIndex) => choiceIndex !== answerIndex), 90),
    choices,
    answerIndex,
    feedback: textValue(value.feedback, 160) || `命中资料要点：${choices[answerIndex]}`,
  };
}

function normalizeIncomingPlaySpec(value: unknown, requestedMode: GameMode): PlaySpec | null {
  if (!isRecord(value)) return null;
  const skeleton = gameModeIds.has(value.skeleton as GameMode) ? value.skeleton as GameMode : requestedMode;
  if (skeleton !== requestedMode) return null;
  const stages = Array.isArray(value.stages)
    ? value.stages.map((stage, index) => normalizeIncomingStage(stage, index, skeleton)).filter((stage): stage is Stage => Boolean(stage))
    : [];
  if (stages.length < (skeleton === "cards" ? 3 : 6)) return null;

  const feedbackValue = isRecord(value.feedback) ? value.feedback : {};
  const fallback = defaultPlaySpec(skeleton);
  return validatePlaySpec({
    skeleton,
    goal: textValue(value.goal, 68) || fallback.goal,
    mood: moodIds.has(value.mood as Mood) ? value.mood as Mood : fallback.mood,
    feedback: {
      hit: textValue(feedbackValue.hit, 48) || fallback.feedback.hit,
      miss: textValue(feedbackValue.miss, 48) || fallback.feedback.miss,
    },
    stages: skeleton === "cards" ? stages.slice(0, 3) : stages.slice(0, 12),
  });
}

function normalizeIncomingDecision(value: unknown, fallback: AgentDecision, mode: GameMode): AgentDecision {
  const record = isRecord(value) ? value : {};
  const confidence = typeof record.confidence === "number" ? record.confidence : fallback.confidence;
  return {
    confidence: Math.max(70, Math.min(98, Math.round(confidence))),
    mode,
    reasons: stringList(record.reasons, 3, 24).length ? stringList(record.reasons, 3, 24) : fallback.reasons,
    signals: stringList(record.signals, 5, 18).length ? stringList(record.signals, 5, 18) : fallback.signals,
    title: textValue(record.title, 36) || "Model generated playable",
  };
}

function bossName(material: MaterialType) {
  const map: Record<MaterialType, string> = {
    notes: "遗忘 Boss",
    pdf: "概念 Boss",
    slides: "走神 Boss",
    video: "跳看 Boss",
    quiz: "错题 Boss",
  };
  return map[material];
}

function chooseAgentDecision(content: string, material: MaterialType, requestedMode?: GameMode): AgentDecision {
  const source = content.toLowerCase();
  const misconceptionSignals = ["错题", "错误", "误区", "混淆", "纠偏", "判断", "风险", "陷阱", "不要", "避免"];
  const laneSignals = ["步骤", "流程", "规则", "顺序", "操作", "防御", "应对", "对应", "结构"];
  const survivorSignals = ["趣味", "挑战", "通关", "记忆", "闯关", "限时", "科普", "知识", "记住", "要点", "快速"];
  const hitMisconception = misconceptionSignals.filter((item) => source.includes(item.toLowerCase()));
  const hitLane = laneSignals.filter((item) => source.includes(item.toLowerCase()));
  const hitSurvivor = survivorSignals.filter((item) => source.includes(item.toLowerCase()));
  const misconceptionScore = hitMisconception.length * 2 + (material === "quiz" ? 4 : 0) + (material === "video" ? 1 : 0);
  const laneScore = hitLane.length * 2 + (material === "pdf" ? 2 : 0) + (material === "slides" ? 1 : 0);
  const survivorScore = hitSurvivor.length * 2 + (material === "video" ? 3 : 0) + (material === "notes" ? 2 : 0);

  function autoMode(): GameMode {
    const best = Math.max(misconceptionScore, laneScore, survivorScore);
    if (best <= 0) return "cards";
    if (best === survivorScore) return "survivor";
    if (best === laneScore) return "lane";
    return "cards";
  }
  const mode = requestedMode ?? autoMode();
  const signalMap: Record<GameMode, string[]> = { cards: hitMisconception, lane: hitLane, survivor: hitSurvivor };
  const signals = signalMap[mode].slice(0, 3);
  const score = mode === "lane" ? laneScore : mode === "survivor" ? survivorScore : misconceptionScore;
  const reasonMap: Record<GameMode, string[]> = {
    cards: ["误区/错题信号更强", "用 Boss 战放大纠偏反馈"],
    lane: ["流程/规则信号更强", "用答题塔防边玩边记"],
    survivor: ["碎片科普/趣味信号更强", "用幸存者肉鸽边杀怪边记忆"],
  };
  const titleMap: Record<GameMode, string> = {
    cards: "Agent picked Misconception Raid",
    lane: "Agent picked Recall Defense",
    survivor: "Agent picked Memory Survivor",
  };

  return {
    confidence: requestedMode ? 92 : Math.min(96, 82 + score * 3),
    mode,
    reasons: reasonMap[mode],
    signals: signals.length ? signals : requestedMode ? ["manual pick"] : ["内容结构", materialLabel.get(material) ?? "资料"],
    title: requestedMode ? titleMap[mode].replace("picked", "confirmed") : titleMap[mode],
  };
}

// Agent 选动效气质：误区/纠偏类内容偏紧张，塔防/幸存者按题材在紧张/轻快间切换。
function pickMood(mode: GameMode, material: MaterialType): Mood {
  if (mode === "cards") return "tense";
  if (mode === "survivor") return "tense";
  return material === "quiz" || material === "video" ? "tense" : "playful";
}

const moodDescriptor: Record<Mood, string> = {
  tense: "紧张急促",
  calm: "沉稳推进",
  playful: "轻快弹跳",
};

// 动效气质 → 具体动效参数。同一骨架下不同气质有可见差异（这是「不像换皮」的关键）。
const moodMotion: Record<Mood, { dur: number; shake: number; ease: string; pop: number }> = {
  tense: { dur: 0.18, shake: 0.012, ease: "power4.out", pop: 1.16 },
  calm: { dur: 0.34, shake: 0.004, ease: "power2.out", pop: 1.05 },
  playful: { dur: 0.46, shake: 0.006, ease: "elastic.out(1, 0.45)", pop: 1.22 },
};

// 按骨架槽位产出每回合内容（PlayRound[]）。先从用户输入抽事实，再映射到不同骨架的合法槽位。
function buildStages(mode: GameMode, core: string, trap: string, action: string, content = ""): Stage[] {
  const keywords = extractKeywords(content || `${core} ${trap} ${action}`);
  const knowledgeUnits = extractKnowledgeUnits(content || `${core}。${trap}。${action}。`);
  if (knowledgeUnits.length >= 3) return buildStagesFromUnits(mode, knowledgeUnits);

  const facts = extractContentFacts(content || `${core}。${trap}。${action}。`, keywords);

  function stageFromFact(index: number): Stage {
    const fact = facts[index % facts.length];
    const nextFact = facts[(index + 1) % facts.length];
    const anchor = factAnchor(fact, keywords);
    const otherAnchor = factAnchor(nextFact, keywords.filter((item) => item !== anchor));
    const answerIndex = index % 3;
    const correct = compact(formatFactForChoice(fact), 30);
    const wrongA = compact(`把「${anchor}」解释成「${otherAnchor}」`, 30);
    const wrongB = compact(index % 2 === 0 ? `只看表面，没有抓住${anchor}` : `资料没有强调${anchor}`, 30);
    const prompts = [
      `这份内容里，「${anchor}」真正表达的是？`,
      `如果要把「${anchor}」做成关卡，应该保留哪条原文要点？`,
      `学习「${anchor}」时，应该记住哪件事？`,
      `下面哪一项最接近资料中的「${anchor}」？`,
    ];

    return {
      id: `q${index + 1}`,
      title: `Q${index + 1}`,
      prompt: prompts[index % prompts.length],
      trap: wrongA,
      choices: arrangeChoices(correct, wrongA, wrongB, answerIndex),
      answerIndex,
      feedback: `原文要点：${correct}`,
    };
  }

  if (mode === "lane" || mode === "survivor") {
    // lane/survivor 骨架：每道题答对获得资源（能量/金币），题目内容来自当前资料事实。
    return Array.from({ length: 12 }, (_, index) => stageFromFact(index));
  }

  // misconception-raid 骨架：每回合 choices + answerIndex 驱动 Phaser Boss 战的破盾选项。
  return [0, 1, 2].map((index) => {
    const stage = stageFromFact(index);
    const labels = [
      { id: "scan", title: "Scan", prompt: `先扫描「${factAnchor(facts[index % facts.length], keywords)}」里的哪类误区？` },
      { id: "break", title: "Break", prompt: `破盾需要引用哪条资料证据？` },
      { id: "repair", title: "Repair", prompt: `修正卡应该写入哪条可复述要点？` },
    ];
    return {
      ...stage,
      id: labels[index].id,
      title: labels[index].title,
      prompt: labels[index].prompt,
      feedback: index === 0
        ? `误区被标记：${stage.feedback}`
        : index === 1
        ? `证据命中：${stage.feedback}`
        : `修正卡写入：${stage.feedback}`,
    };
  });
}

// 骨架的默认安全方案：当 Agent 产出的 PlaySpec 不合法时降级到它，保证永不白屏。
function defaultPlaySpec(mode: GameMode): PlaySpec {
  const stages = buildStages(mode, "核心概念", "常见误区", "正确路径");
  const goalMap: Record<GameMode, string> = {
    cards: "扫描并破除内容里的常见误区",
    lane: "答对知识题获得能量，建塔守住知识防线",
    survivor: "答对知识题得金币升级，扛过怪潮活下来",
  };
  const feedbackMap: Record<GameMode, { hit: string; miss: string }> = {
    cards: { hit: "证据命中，护盾裂开。", miss: "噪声命中，重新瞄准弱点。" },
    lane: { hit: "答对！获得能量，可以种防御了。", miss: "答错，能量没到手，防线吃紧。" },
    survivor: { hit: "答对！金币入袋，去买升级吧。", miss: "答错，没拿到金币，怪潮更凶了。" },
  };
  return {
    skeleton: mode,
    goal: goalMap[mode],
    mood: mode === "cards" ? "tense" : "playful",
    feedback: feedbackMap[mode],
    stages,
  };
}

// Runtime 护栏：校验 PlaySpec 槽位是否齐全、有无通关出口、mood 是否合法。
// 任一不过 → 降级到该骨架的 defaultPlaySpec。这是「带护栏的 Creative Runtime」的落地。
function validatePlaySpec(spec: PlaySpec): PlaySpec {
  const moodOk = spec.mood === "tense" || spec.mood === "calm" || spec.mood === "playful";
  const hasGoal = Boolean(spec.goal && spec.goal.trim());
  const hasRounds = Array.isArray(spec.stages) && spec.stages.length > 0;
  const roundsOk = hasRounds && spec.stages.every((stage) => {
    const choicesOk = Array.isArray(stage.choices) && stage.choices.length >= 2;
    // 通关出口：必须存在合法 answerIndex 指向一个真实选项。
    const exitOk = stage.answerIndex >= 0 && stage.answerIndex < (stage.choices?.length ?? 0);
    return choicesOk && exitOk;
  });
  if (moodOk && hasGoal && roundsOk) return spec;
  return defaultPlaySpec(spec.skeleton);
}

// Agent 产出六维玩法方案：scene(skeleton)/rules(stages) 受骨架约束，goal/feedback/mood 自由生成。
function buildPlaySpec(content: string, material: MaterialType, mode: GameMode): PlaySpec {
  const keywords = extractKeywords(content);
  const core = keywords[0] ?? "核心概念";
  const trap = keywords[1] ?? "常见误区";
  const action = keywords[2] ?? "正确路径";
  const mood = pickMood(mode, material);

  const spec: PlaySpec = {
    skeleton: mode,
    goal: mode === "lane"
      ? `答对「${compact(core, 8)}」知识题获得能量，建塔守住防线`
      : mode === "survivor"
      ? `答对「${compact(core, 8)}」知识题得金币升级，扛过怪潮`
      : `扫描并破除「${compact(trap, 8)}」这类常见误区`,
    mood,
    feedback: mode === "lane"
      ? { hit: `答对！获得建塔能量。`, miss: `答错，能量没到手。` }
      : mode === "survivor"
      ? { hit: `答对！金币入袋。`, miss: `答错，没拿到金币。` }
      : { hit: `命中 ${compact(action, 8)}，护盾裂开。`, miss: `误区「${compact(trap, 8)}」反噬，重新瞄准。` },
    stages: buildStages(mode, core, trap, action, content),
  };
  return validatePlaySpec(spec);
}

function buildQuest(content: string, material: MaterialType, mode: GameMode, fileName?: string, decision = chooseAgentDecision(content, material, mode)): QuestGame {
  const keywords = extractKeywords(content);
  const spec = buildPlaySpec(content, material, decision.mode);

  return {
    title: fileName ? compact(fileName.replace(/\.[^.]+$/, ""), 12) : `${materialLabel.get(material)} Quest`,
    materialLabel: materialLabel.get(material) ?? "资料",
    modeLabel: modeLabel.get(spec.skeleton) ?? "Misconception Raid",
    schema: modeSchema.get(spec.skeleton) ?? "misconception_raid_quest",
    keywords: keywords.length ? keywords : ["概念", "误区", "例题", "复习"],
    boss: bossName(material),
    decision,
    spec,
    stages: spec.stages,
    exports: ["Playable H5", "Share link", "Embed", "PlaySpec"],
  };
}

function buildQuestFromSpec(content: string, material: MaterialType, mode: GameMode, fileName: string | undefined, decision: AgentDecision, spec: PlaySpec): QuestGame {
  const keywords = extractKeywords(content);
  return {
    title: fileName ? compact(fileName.replace(/\.[^.]+$/, ""), 12) : `${materialLabel.get(material)} Quest`,
    materialLabel: materialLabel.get(material) ?? "资料",
    modeLabel: modeLabel.get(spec.skeleton) ?? "Misconception Raid",
    schema: modeSchema.get(spec.skeleton) ?? "misconception_raid_quest",
    keywords: keywords.length ? keywords : decision.signals.length ? decision.signals : ["概念", "误区", "例题", "复习"],
    boss: bossName(material),
    decision: { ...decision, mode },
    spec,
    stages: spec.stages,
    exports: ["Playable H5", "Share link", "Embed", "PlaySpec"],
  };
}

// 让本地 Agent 调模型生成玩法方案。模型 key 只在本地 agent server 里读取，不进入前端 bundle。
// 任何失败（未配置 / 超时 / JSON 不合法 / 护栏不过）→ 返回 null，由上层回退本地生成，保证不白屏。
async function requestModelPlaySpec(content: string, material: MaterialType, mode: GameMode, fileName: string): Promise<ModelPlaySpecResult | null> {
  const trimmed = content.trim().slice(0, maxContentChars);
  if (!trimmed) return null;

  type GenerateResponse = {
    ok?: boolean;
    decision?: unknown;
    spec?: unknown;
    source?: unknown;
  };
  const parsed = await postJsonToAgent<GenerateResponse>("/api/generate-play-spec", {
    mode,
    material,
    fileName,
    content: trimmed,
  }, modelGenerationTimeoutMs);
  if (!parsed?.ok || !isRecord(parsed)) return null;

  // 模型可自由选 mode（除非用户在 Atlas 手动指定了骨架）。
  const modelMode = isRecord(parsed.decision) && gameModeIds.has((parsed.decision as { mode?: GameMode }).mode as GameMode)
    ? (parsed.decision as { mode: GameMode }).mode
    : mode;
  const spec = normalizeIncomingPlaySpec(parsed.spec, modelMode);
  if (!spec) return null;

  const fallbackDecision = chooseAgentDecision(content, material, modelMode);
  return {
    spec,
    decision: normalizeIncomingDecision(parsed.decision, fallbackDecision, modelMode),
  };
}

async function extractFileWithAgent(file: File): Promise<string | null> {
  type ExtractResponse = { ok?: boolean; text?: unknown };
  const response = await postFileToAgent<ExtractResponse>("/api/extract-file", file);
  return response?.ok && typeof response.text === "string" ? response.text.trim().slice(0, maxContentChars) : null;
}

function choiceClass(index: number, selectedChoice: number | null, answerIndex: number) {
  const selected = selectedChoice === index;
  const correct = selected && index === answerIndex;
  return `${selected ? "selected" : ""} ${correct ? "correct" : ""}`.trim();
}

function TemplatePreview({ mode, quest, activeMode }: { mode: GameMode; quest: QuestGame; activeMode: (typeof gameModes)[number] }) {
  const stage = quest.stages[0];
  const keywords = quest.keywords.length ? quest.keywords : ["概念", "误区", "行动"];

  return (
    <div className={`template-preview template-${mode}`}>
      <div className="stage-copy template-intro">
        <em>{activeMode.short}</em>
        <h2>{activeMode.label}</h2>
        <div className="stage-meta">
          <span>{activeMode.fit}</span>
          <span>{activeMode.mechanic}</span>
        </div>
      </div>

      {mode === "cards" ? (
        <div className="raid-preview" aria-hidden="true">
          <div className="raid-boss">
            <ShieldCheck size={30} />
            <strong>{compact(stage.trap, 8)}</strong>
            <span>shield 72%</span>
          </div>
          <div className="raid-actions">
            <span>Scan</span>
            <span>Break</span>
            <span>Repair</span>
          </div>
        </div>
      ) : null}

      {mode === "lane" ? (
        <div className="lane-preview" aria-hidden="true">
          <div className="lane-preview-grid">
            {Array.from({ length: 15 }).map((_, index) => (
              <span className={index === 4 || index === 9 ? "plant" : index === 2 || index === 13 ? "zombie" : ""} key={index} />
            ))}
          </div>
          <div className="lane-preview-tags">
            <em>答题得能量</em>
            <em>建塔挡怪兽</em>
          </div>
        </div>
      ) : null}

      {mode === "survivor" ? (
        <div className="survivor-preview" aria-hidden="true">
          <span className="survivor-preview-hero" />
          {Array.from({ length: 8 }).map((_, index) => (
            <i key={index} style={{ "--a": `${index * 45}deg` } as CSSProperties} />
          ))}
          <div className="survivor-preview-tags">
            <em>答题得金币</em>
            <em>自动杀怪升级</em>
          </div>
        </div>
      ) : null}

      <div className="template-json-mini">
        <Code2 size={14} />
        <code>{quest.schema}</code>
      </div>
    </div>
  );
}

function AtlasRouteStandby({ fileName, ready }: { fileName: string; ready: boolean }) {
  return (
    <div className="atlas-standby" aria-label="Route picker standby">
      <div className="stage-copy template-intro">
        <em>GameCraft Atlas</em>
        <h2>选择玩法路线</h2>
        <div className="stage-meta">
          <span>{fileName ? compact(fileName, 18) : "资料已就绪"}</span>
          <span>{ready ? "Ready" : "Waiting"}</span>
        </div>
      </div>

      <div className="atlas-standby-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
        {gameModes.map((item, index) => (
          <i key={item.id} style={{ "--a": `${index * 120 - 90}deg` } as CSSProperties}>
            {item.short}
          </i>
        ))}
      </div>

      <div className="template-json-mini">
        <Layers3 size={14} />
        <code>route_picker</code>
      </div>
    </div>
  );
}

function MisconceptionBossPlayable({
  quest,
  stage,
  stageBaseHp,
  targetHp,
  selectedChoice,
  onChoice,
  disabled,
}: {
  quest: QuestGame;
  stage: Stage;
  stageBaseHp: number;
  targetHp: number;
  selectedChoice: number | null;
  onChoice: (index: number) => void;
  disabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const disabledRef = useRef(disabled);
  const onChoiceRef = useRef(onChoice);

  disabledRef.current = disabled;
  onChoiceRef.current = onChoice;

  useEffect(() => {
    const handler = (event: Event) => {
      const index = (event as CustomEvent<{ index: number }>).detail?.index;
      if (typeof index !== "number" || disabledRef.current) return;
      onChoiceRef.current(index);
    };

    window.addEventListener("intoplay:boss-choice", handler);
    return () => window.removeEventListener("intoplay:boss-choice", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let game: { destroy: (removeCanvas: boolean, noReturn?: boolean) => void } | null = null;
    const host = hostRef.current;
    if (!host) return undefined;

    host.innerHTML = "";

    void import("phaser").then((module) => {
      if (cancelled || !hostRef.current) return;
      const Phaser = module.default ?? module;
      const choices = stage.choices;
      const correctIndex = stage.answerIndex;
      const trapLabel = compact(stage.trap, 12);
      const bossLabel = compact(quest.boss, 12);
      const initialHpScale = Math.max(0.02, stageBaseHp / 100);
      const moodFx = moodMotion[quest.spec.mood];

      class BossScene extends Phaser.Scene {
        private hpFill?: any;
        private shield?: any;
        private bossCore?: any;
        private actionNodes: any[] = [];

        constructor() {
          super("MisconceptionBoss");
        }

        preload() {
          this.load.image("dungeonTile", "/assets/kenney-dungeon/tile_0084.png");
          this.load.image("dungeonRune", "/assets/kenney-dungeon/tile_0109.png");
          this.load.image("bossBody", "/assets/kenney-monster/body_redF.png");
          this.load.image("bossArm", "/assets/kenney-monster/arm_redD.png");
          this.load.image("bossLeg", "/assets/kenney-monster/leg_redE.png");
          this.load.image("bossHorn", "/assets/kenney-monster/detail_yellow_horn_large.png");
          this.load.image("bossEye", "/assets/kenney-monster/eye_angry_red.png");
          this.load.image("bossMouth", "/assets/kenney-monster/mouth_closed_fangs.png");
        }

        create() {
          const width = 1100;
          const height = 360;
          this.cameras.main.setBackgroundColor("rgba(5, 10, 28, 0)");

          const dungeonFloor = this.add.tileSprite(width / 2, height / 2, width, height, "dungeonTile");
          dungeonFloor.setAlpha(0.12);
          dungeonFloor.setTint(0x7ee8ff);
          dungeonFloor.setTileScale(4, 4);

          const grid = this.add.graphics();
          grid.lineStyle(1, 0x7ee8ff, 0.12);
          for (let x = 32; x < width; x += 32) grid.lineBetween(x, 0, x, height);
          for (let y = 28; y < height; y += 28) grid.lineBetween(0, y, width, y);

          const platform = this.add.ellipse(width / 2, 218, 250, 76, 0x071124, 0.6);
          platform.setStrokeStyle(2, 0x43e7ff, 0.34);
          const runeLeft = this.add.image(width / 2 - 172, 224, "dungeonRune").setScale(3.6).setAlpha(0.24).setTint(0xffd45f);
          const runeRight = this.add.image(width / 2 + 172, 224, "dungeonRune").setScale(3.6).setAlpha(0.24).setTint(0x9dff6a);
          this.tweens.add({ targets: [runeLeft, runeRight], alpha: 0.48, yoyo: true, repeat: -1, duration: 980, ease: "Sine.easeInOut" });

          const tunnel = this.add.container(width / 2, 170);
          for (let i = 0; i < 4; i += 1) {
            const ring = this.add.ellipse(0, 0, 210 + i * 70, 72 + i * 26);
            ring.setStrokeStyle(1, i % 2 ? 0x9dff6a : 0x43e7ff, 0.2 - i * 0.025);
            tunnel.add(ring);
          }
          this.tweens.add({ targets: tunnel, angle: 360, duration: 24000, repeat: -1, ease: "Linear" });

          const hpBack = this.add.rectangle(width / 2, 28, 360, 9, 0xffffff, 0.12).setOrigin(0.5);
          hpBack.setStrokeStyle(1, 0xffffff, 0.16);
          this.hpFill = this.add.rectangle(width / 2 - 180, 28, 360, 9, 0x9dff6a, 1).setOrigin(0, 0.5);
          this.hpFill.setScale(initialHpScale, 1);
          this.add.text(width / 2, 50, "Misconception shield", {
            color: "#dbe7ff",
            fontFamily: "system-ui, sans-serif",
            fontSize: "12px",
            fontStyle: "700",
          }).setOrigin(0.5);

          this.bossCore = this.add.container(width / 2, 146);
          const aura = this.add.circle(0, 0, 116, 0xffd45f, 0.12);
          const shadow = this.add.ellipse(0, 96, 122, 26, 0x000000, 0.32);
          const leftLeg = this.add.image(-32, 78, "bossLeg").setScale(0.62).setAngle(8);
          const rightLeg = this.add.image(32, 78, "bossLeg").setScale(0.62).setFlipX(true).setAngle(-8);
          const leftArm = this.add.image(-74, 6, "bossArm").setScale(0.66).setFlipX(true).setAngle(-18);
          const rightArm = this.add.image(74, 6, "bossArm").setScale(0.66).setAngle(18);
          const body = this.add.image(0, 14, "bossBody").setScale(0.68);
          const leftHorn = this.add.image(-34, -90, "bossHorn").setScale(0.86).setAngle(-12);
          const rightHorn = this.add.image(34, -90, "bossHorn").setScale(0.86).setFlipX(true).setAngle(12);
          const eye = this.add.image(0, -24, "bossEye").setScale(1.18);
          const mouth = this.add.image(0, 30, "bossMouth").setScale(1.04);
          this.shield = this.add.circle(0, 0, 94, 0xffffff, 0);
          this.shield.setStrokeStyle(3, 0xffd45f, 0.72);
          const bossText = this.add.text(0, -124, bossLabel, {
            align: "center",
            backgroundColor: "rgba(7, 17, 36, 0.82)",
            color: "#f7fbff",
            fontFamily: "system-ui, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
            padding: { x: 10, y: 5 },
          }).setOrigin(0.5);
          const trapText = this.add.text(0, 124, trapLabel, {
            align: "center",
            backgroundColor: "rgba(255, 109, 154, 0.22)",
            color: "#ffffff",
            fontFamily: "system-ui, sans-serif",
            fontSize: "12px",
            fontStyle: "900",
            padding: { x: 9, y: 5 },
          }).setOrigin(0.5);
          this.bossCore.add([aura, shadow, leftLeg, rightLeg, leftArm, rightArm, body, leftHorn, rightHorn, eye, mouth, this.shield, bossText, trapText]);

          this.tweens.add({ targets: aura, scale: 1.18, alpha: 0.2, yoyo: true, repeat: -1, duration: 1300, ease: "Sine.easeInOut" });
          this.tweens.add({ targets: [leftArm, rightArm], angle: "+=8", yoyo: true, repeat: -1, duration: 940, ease: "Sine.easeInOut" });
          this.tweens.add({ targets: [eye, mouth], y: "-=3", yoyo: true, repeat: -1, duration: 820, ease: "Sine.easeInOut" });
          this.tweens.add({ targets: this.shield, angle: 360, repeat: -1, duration: 5600, ease: "Linear" });

          choices.forEach((choice, index) => {
            const node = this.add.container(width / 2 - 300 + index * 300, height - 58);
            const base = this.add.circle(0, 0, 48, index === correctIndex ? 0x9dff6a : 0x43e7ff, index === correctIndex ? 0.32 : 0.18);
            base.setStrokeStyle(2, index === correctIndex ? 0x9dff6a : 0x43e7ff, 0.76);
            const orb = this.add.circle(0, 0, 18, index === correctIndex ? 0x9dff6a : 0xffd45f, 0.96);
            const label = this.add.text(0, 50, compact(choice, 10), {
              align: "center",
              color: "#f7fbff",
              fontFamily: "system-ui, sans-serif",
              fontSize: "13px",
              fontStyle: "900",
            }).setOrigin(0.5);
            const role = this.add.text(0, -62, index === 0 ? "Scan" : index === 1 ? "Break" : "Repair", {
              align: "center",
              color: "#dbe7ff",
              fontFamily: "system-ui, sans-serif",
              fontSize: "11px",
              fontStyle: "900",
            }).setOrigin(0.5);
            const hit = this.add.rectangle(0, 0, 142, 128, 0x000000, 0).setInteractive({ useHandCursor: true });
            hit.on("pointerdown", () => window.dispatchEvent(new CustomEvent("intoplay:boss-choice", { detail: { index } })));
            node.add([base, orb, label, role, hit]);
            this.actionNodes.push(node);
            this.tweens.add({ targets: node, y: height - 66, yoyo: true, repeat: -1, duration: 1300 + index * 120, ease: "Sine.easeInOut" });
          });

          const hitHandler = (event: Event) => this.playHit((event as CustomEvent<{ index: number; correct: boolean; hpPercent: number; label: string }>).detail);
          window.addEventListener("intoplay:boss-hit", hitHandler);
          this.events.once("shutdown", () => window.removeEventListener("intoplay:boss-hit", hitHandler));
        }

        playHit(detail?: { index: number; correct: boolean; hpPercent: number; label: string }) {
          if (!detail || !this.hpFill || !this.bossCore || !this.shield || !this.sys?.displayList || !this.sys?.updateList) return;
          const node = this.actionNodes[detail.index];
          if (!node) return;
          const color = detail.correct ? 0x9dff6a : 0xff6d9a;
          const nextHpScale = Math.max(0.02, detail.hpPercent / 100);
          const beam = this.add.graphics();
          beam.lineStyle(detail.correct ? 5 : 3, color, 0.92);
          beam.lineBetween(node.x, node.y - 34, this.bossCore.x, this.bossCore.y + 12);
          beam.setBlendMode(Phaser.BlendModes.ADD);

          for (let i = 0; i < 24; i += 1) {
            const particle = this.add.circle(node.x, node.y - 34, Phaser.Math.Between(2, 5), color, 0.95);
            particle.setBlendMode(Phaser.BlendModes.ADD);
            this.tweens.add({
              targets: particle,
              x: this.bossCore.x + Phaser.Math.Between(-50, 50),
              y: this.bossCore.y + Phaser.Math.Between(-46, 48),
              alpha: 0,
              scale: 0.2,
              duration: 420 + Phaser.Math.Between(0, 220),
              ease: "Cubic.easeOut",
              onComplete: () => particle.destroy(),
            });
          }

          this.tweens.add({ targets: beam, alpha: 0, duration: 260, ease: "Quad.easeOut", onComplete: () => beam.destroy() });
          this.tweens.add({ targets: this.bossCore, scale: detail.correct ? moodFx.pop : 1.04, yoyo: true, duration: Math.round(moodFx.dur * 1000), ease: "Quad.easeOut" });
          this.tweens.add({ targets: this.shield, alpha: detail.correct ? 0.18 : 0.78, scale: detail.correct ? 1.32 : 1.1, yoyo: true, duration: detail.correct ? 330 : 180, ease: "Quad.easeOut" });
          this.tweens.add({ targets: this.hpFill, scaleX: nextHpScale, duration: 480, ease: "Cubic.easeOut" });
          this.cameras.main.shake(detail.correct ? 160 : 90, detail.correct ? moodFx.shake : moodFx.shake * 0.4);

          const feedback = this.add.text(this.bossCore.x, this.bossCore.y - 128, detail.correct ? "CRITICAL BREAK" : "NOISE HIT", {
            color: detail.correct ? "#9dff6a" : "#ff6d9a",
            fontFamily: "system-ui, sans-serif",
            fontSize: "18px",
            fontStyle: "900",
          }).setOrigin(0.5);
          this.tweens.add({ targets: feedback, y: feedback.y - 28, alpha: 0, duration: 680, ease: "Cubic.easeOut", onComplete: () => feedback.destroy() });
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: 1100,
        height: 360,
        transparent: true,
        audio: { noAudio: true },
        scene: BossScene,
        scale: {
          mode: Phaser.Scale.NONE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      });
    });

    return () => {
      cancelled = true;
      game?.destroy(true);
      if (host) host.innerHTML = "";
    };
  }, [quest.boss, quest.spec.mood, stage.answerIndex, stage.choices, stage.id, stage.trap, stageBaseHp]);

  useEffect(() => {
    if (hudRef.current) {
      gsap.fromTo(hudRef.current, { y: 10, opacity: 0.72 }, { y: 0, opacity: 1, duration: 0.28, ease: "power3.out" });
    }
  }, [stage.id]);

  useEffect(() => {
    if (selectedChoice === null) return;
    const correct = selectedChoice === stage.answerIndex;
    window.dispatchEvent(
      new CustomEvent("intoplay:boss-hit", {
        detail: {
          index: selectedChoice,
          correct,
          hpPercent: targetHp,
          label: stage.choices[selectedChoice],
        },
      }),
    );
    if (hudRef.current) {
      gsap.fromTo(hudRef.current, { x: correct ? 0 : -8, filter: "brightness(1.2)" }, { x: 0, filter: "brightness(1)", duration: 0.34, ease: "power3.out" });
    }
  }, [selectedChoice, stage.answerIndex, stage.choices, targetHp]);

  return (
    <div className="template-play template-cards boss-runtime">
      <div className="boss-runtime-top" ref={hudRef}>
        <div>
          <span>Agent picked</span>
          <strong>Misconception Boss</strong>
        </div>
        <p>{stage.prompt}</p>
      </div>

      <div className="boss-canvas-shell" aria-label="Playable misconception boss stage">
        <div ref={hostRef} className="boss-canvas-host" />
      </div>

      <div className="boss-action-panel" aria-label="Boss actions">
        {stage.choices.map((choice, index) => (
          <motion.button
            className={choiceClass(index, selectedChoice, stage.answerIndex)}
            disabled={disabled}
            key={choice}
            type="button"
            onClick={() => onChoice(index)}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
          >
            <span>{index === 0 ? "Scan" : index === 1 ? "Break" : "Repair"}</span>
            <strong>{choice}</strong>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// 知识塔防（PvZ 式格子塔防）。右侧答题获得建塔能量（通过 window 事件总线注入），
// 左侧 Phaser 画 5 车道格子：建造防御塔/护墙挡从右涌入的怪兽，怪兽到最左 = 失败。
// 复用 MisconceptionBossPlayable 的 Phaser 接入模式 + window 事件总线 + moodMotion 动效。
function LaneDefensePlayable({
  quest,
  onRuntimeEvent,
  onComplete,
  disabled,
}: {
  quest: QuestGame;
  onRuntimeEvent: (event: Omit<PlayEvent, "id">) => void;
  onComplete: (survived: boolean) => void;
  disabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onRuntimeEventRef = useRef(onRuntimeEvent);
  const onCompleteRef = useRef(onComplete);
  onRuntimeEventRef.current = onRuntimeEvent;
  onCompleteRef.current = onComplete;

  type LanePlantKind = "shooter" | "cannon" | "frost" | "missile" | "wall" | "mine";
  type LaneSkillKind = "freeze" | "blast" | "repair";

  const [energy, setEnergy] = useState(130);
  const [baseHp, setBaseHp] = useState(220);
  const [wave, setWave] = useState(1);
  const [kills, setKills] = useState(0);
  const [endlessMode, setEndlessMode] = useState(false);
  const [skillCooldowns, setSkillCooldowns] = useState<Record<LaneSkillKind, number>>({ freeze: 0, blast: 0, repair: 0 });
  const [selectedPlant, setSelectedPlant] = useState<LanePlantKind>("shooter");
  const energyRef = useRef(energy);
  const endlessRef = useRef(endlessMode);
  const selectedPlantRef = useRef(selectedPlant);
  energyRef.current = energy;
  endlessRef.current = endlessMode;
  selectedPlantRef.current = selectedPlant;

  const laneTotalWaves = 12;
  const plantCost: Record<LanePlantKind, number> = { shooter: 45, cannon: 90, frost: 70, missile: 120, wall: 35, mine: 55 };
  const plantLabel: Record<LanePlantKind, string> = { shooter: "射手", cannon: "重炮", frost: "冰塔", missile: "导弹", wall: "护墙", mine: "地雷" };
  const skillCost: Record<LaneSkillKind, number> = { freeze: 80, blast: 110, repair: 75 };
  const skillLabel: Record<LaneSkillKind, string> = { freeze: "冰冻全场", blast: "知识爆破", repair: "修复防线" };
  const skillCooldownSeconds: Record<LaneSkillKind, number> = { freeze: 9, blast: 14, repair: 12 };
  const upgradeCost = (kind: LanePlantKind, level: number) => {
    const base = kind === "wall" ? 42 : kind === "mine" ? 38 : kind === "missile" ? 86 : 62;
    return base + level * (kind === "missile" ? 42 : kind === "wall" ? 30 : 34);
  };
  const [energyBursts, setEnergyBursts] = useState<Array<{ id: number; x: number; y: number; dx: number; dy: number; label: string }>>([]);
  const [laneNotice, setLaneNotice] = useState("");
  const burstIdRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);
  const flashLaneNotice = useCallback((message: string, timeout = 1600) => {
    setLaneNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setLaneNotice(""), timeout);
  }, []);

  // 右侧答题面板答对 → window 事件加能量。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ amount: number; from?: LaneEnergyOrigin }>).detail;
      const amount = detail?.amount ?? 25;
      setEnergy((value) => Math.min(999, value + amount));
      const targetRect = document.querySelector(".lane-stat.energy")?.getBoundingClientRect();
      if (detail?.from && targetRect) {
        const id = burstIdRef.current + 1;
        burstIdRef.current = id;
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;
        setEnergyBursts((current) => [
          ...current,
          {
            id,
            x: detail.from!.x,
            y: detail.from!.y,
            dx: targetX - detail.from!.x,
            dy: targetY - detail.from!.y,
            label: `+${amount}`,
          },
        ]);
        window.setTimeout(() => {
          setEnergyBursts((current) => current.filter((item) => item.id !== id));
        }, 760);
      }
    };
    window.addEventListener("intoplay:lane-energy", handler);
    return () => window.removeEventListener("intoplay:lane-energy", handler);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSkillCooldowns((current) => {
        if (!Object.values(current).some((value) => value > 0)) return current;
        return {
          freeze: Math.max(0, current.freeze - 1),
          blast: Math.max(0, current.blast - 1),
          repair: Math.max(0, current.repair - 1),
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let game: { destroy: (removeCanvas: boolean, noReturn?: boolean) => void } | null = null;
    const host = hostRef.current;
    if (!host) return undefined;
    host.innerHTML = "";
    const moodFx = moodMotion[quest.spec.mood];

    void import("phaser").then((module) => {
      if (cancelled || !hostRef.current) return;
      const Phaser = module.default ?? module;
      const COLS = 9;
      const ROWS = 5;
      const W = 1280;
      const H = 620;
      const originX = 118;
      const originY = 118;
      const cellW = 118;
      const cellH = 78;
      const boardW = COLS * cellW;
      const boardH = ROWS * cellH;
      const bulletSpeed = moodFx.dur < 0.3 ? 620 : 500;
      const totalWaves = 12;
      const monsterIds = [1, 7, 9] as const;
      const monsterRoster = [
        { key: "grunt", id: 1, label: "Grunt", hp: 112, speed: 0.72, scale: 0.86, damage: 18, armor: 1, color: 0xff6d4f },
        { key: "runner", id: 7, label: "Runner", hp: 82, speed: 1.12, scale: 0.74, damage: 12, armor: 1, color: 0x63d7ff, tint: 0x63d7ff },
        { key: "brute", id: 9, label: "Brute", hp: 238, speed: 0.46, scale: 1.08, damage: 34, armor: 0.94, color: 0xffd45f, tint: 0xffd45f },
        { key: "shield", id: 1, label: "Shield", hp: 168, speed: 0.6, scale: 0.94, damage: 22, armor: 0.72, color: 0xa76bff, tint: 0xa76bff },
        { key: "swarm", id: 7, label: "Swarm", hp: 64, speed: 1.38, scale: 0.68, damage: 10, armor: 1.08, color: 0x9dff6a, tint: 0x9dff6a },
        { key: "elite", id: 9, label: "Elite", hp: 330, speed: 0.54, scale: 1.18, damage: 40, armor: 0.82, color: 0xff6d9a, tint: 0xff6d9a },
        { key: "boss", id: 9, label: "Boss", hp: 520, speed: 0.38, scale: 1.34, damage: 56, armor: 0.76, color: 0xffb15f, tint: 0xff8f3d },
      ] as const;
      const wavePattern = [
        [0, 1, 0, 0],
        [1, 0, 1, 2, 0, 1],
        [4, 1, 0, 2, 4, 0, 1],
        [2, 0, 1, 3, 1, 0, 2, 4],
        [1, 3, 2, 0, 1, 3, 2, 0, 1, 4],
        [5, 4, 2, 3, 1, 0, 2, 4, 3],
        [1, 4, 3, 2, 5, 0, 4, 2, 1, 3, 5],
        [6, 4, 2, 5, 1, 3, 0, 4, 2, 5, 6],
        [4, 4, 1, 3, 5, 2, 4, 0, 3, 5, 2, 4],
        [5, 2, 6, 4, 3, 1, 5, 4, 6, 0, 2, 3],
        [4, 5, 4, 6, 2, 3, 5, 4, 1, 6, 2, 5, 4],
        [6, 5, 4, 2, 6, 3, 5, 4, 6, 1, 5, 4, 6],
      ] as const;
      const monsterFrameKeys = (id: number) => (
        Array.from({ length: 8 }, (_, index) => `monster${id}Run${String(index).padStart(3, "0")}`)
      );
      const cellPoint = (r: number, c: number) => ({
        x: originX + c * cellW + cellW / 2,
        y: originY + r * cellH + cellH / 2,
      });
      const pointerToCell = (x: number, y: number) => {
        return {
          c: Math.floor((x - originX) / cellW),
          r: Math.floor((y - originY) / cellH),
        };
      };

      type Cell = {
        plant: null | {
          kind: LanePlantKind;
          obj: any;
          hp: number;
          maxHp: number;
          cd: number;
          level: number;
          badge?: any;
        };
      };

      class LaneScene extends Phaser.Scene {
        grid: Cell[][] = [];
        zombies: any[] = [];
        bullets: any[] = [];
        laneSaves: boolean[] = Array.from({ length: ROWS }, () => true);
        hoverTile: any = null;
        waveBanner: any = null;
        spawnTimer = 6.2;
        waveIndex = 0;
        spawnedThisWave = 0;
        over = false;
        endlessMode = false;
        baseHpLocal = 220;
        sceneId = `lane-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        constructor() { super("LaneScene"); }

        preload() {
          const tower = "/assets/basic-towers";
          const tank = "/assets/kenney-topdown-tanks";
          const stone = "/assets/craftpix-stone-td";
          const monsters = "/assets/monster-enemies";
          const kenneyTd = "/assets/kenney-tower-defense";
          const tdMarket = "/assets/td-market";
          this.load.image("laneGrass", `${tank}/grass.png`);
          this.load.image("laneDirt", `${tank}/dirt.png`);
          this.load.image("laneSand", `${tank}/sand.png`);
          this.load.image("laneBullet", `${tank}/bulletYellowSilver.png`);
          this.load.image("laneBulletRed", `${tank}/bulletRedSilver.png`);
          this.load.image("laneSmoke", `${tank}/smokeOrange3.png`);
          this.load.image("laneDust", `${tank}/smokeGrey3.png`);
          this.load.image("treeLarge", `${tank}/treeLarge.png`);
          this.load.image("treeSmall", `${tank}/treeSmall.png`);
          this.load.image("sandbag", `${tank}/sandbagBrown.png`);
          this.load.image("barrelSide", `${tank}/barrelRed_side.png`);
          this.load.image("towerBase", `${tower}/Tower.png`);
          this.load.image("towerCannon", `${tower}/Cannon.png`);
          this.load.image("towerCannon2", `${tower}/Cannon2.png`);
          this.load.image("towerMG", `${tower}/MG.png`);
          this.load.image("towerMissileAmmo", `${tower}/Missile.png`);
          this.load.image("towerMissile", `${tower}/Missile_Launcher.png`);
          this.load.image("towerShell", `${tower}/Bullet_Cannon.png`);
          this.load.image("fireShrine", `${stone}/fire-shrine.png`);
          this.load.image("woodPlatform", `${stone}/wood-platform.png`);
          this.load.image("debrisRing", `${stone}/debris-ring.png`);
          this.load.image("debrisSmall", `${stone}/debris-small.png`);
          this.load.image("tdGrass", `${kenneyTd}/towerDefense_tile157.png`);
          this.load.image("tdDirt", `${kenneyTd}/towerDefense_tile158.png`);
          this.load.image("tdStone", `${kenneyTd}/towerDefense_tile159.png`);
          this.load.image("tdRoadGreen", `${kenneyTd}/towerDefense_tile222.png`);
          this.load.image("tdRoadDirt", `${kenneyTd}/towerDefense_tile223.png`);
          this.load.image("tdTree", `${kenneyTd}/towerDefense_tile130.png`);
          this.load.image("tdRock", `${kenneyTd}/towerDefense_tile136.png`);
          this.load.image("tdCrystal", `${kenneyTd}/towerDefense_tile134.png`);
          this.load.image("tdWall", `${kenneyTd}/towerDefense_tile228.png`);
          this.load.image("tdProjectile", `${tdMarket}/projectile.png`);
          this.load.image("tdImpact", `${tdMarket}/impact.png`);
          this.load.spritesheet("laneExplosion", "/assets/game-fx/pixel-explosion.png", { frameWidth: 80, frameHeight: 80 });
          for (const id of monsterIds) {
            monsterFrameKeys(id).forEach((key, index) => {
              this.load.image(key, `${monsters}/monster-${id}-run-${String(index).padStart(3, "0")}.png`);
            });
            this.load.image(`monster${id}Hurt`, `${monsters}/monster-${id}-hurt.png`);
            this.load.image(`monster${id}Die`, `${monsters}/monster-${id}-die.png`);
          }
        }

        create() {
          (window as unknown as { __intoPlayLaneSceneId?: string }).__intoPlayLaneSceneId = this.sceneId;
          this.cameras.main.setBackgroundColor("rgba(5,12,28,0)");
          for (const id of monsterIds) {
            const animKey = `monster${id}Run`;
            if (!this.anims.exists(animKey)) {
              this.anims.create({
                key: animKey,
                frames: monsterFrameKeys(id).map((key) => ({ key })),
                frameRate: 10,
                repeat: -1,
              });
            }
          }
          if (!this.anims.exists("laneExplosionBoom")) {
            this.anims.create({
              key: "laneExplosionBoom",
              frames: this.anims.generateFrameNumbers("laneExplosion", { start: 0, end: 11 }),
              frameRate: 24,
              repeat: 0,
            });
          }

          const panel = this.add.graphics();
          panel.fillStyle(0x05111f, 0.78).fillRoundedRect(38, 32, W - 76, H - 68, 30);
          panel.fillStyle(0x0b201c, 0.68).fillRoundedRect(originX - 52, originY - 50, boardW + 106, boardH + 100, 28);
          panel.lineStyle(2, 0xa7ff63, 0.22).strokeRoundedRect(originX - 52, originY - 50, boardW + 106, boardH + 100, 28);
          panel.lineStyle(1, 0x45e9ff, 0.18).strokeRoundedRect(originX - 36, originY - 34, boardW + 74, boardH + 68, 20);
          panel.fillStyle(0x071124, 0.42).fillRoundedRect(originX - 24, originY - 20, boardW + 48, boardH + 40, 16);

          for (let r = 0; r < ROWS; r += 1) {
            const laneY = originY + r * cellH;
            panel.fillStyle(r % 2 === 0 ? 0x123926 : 0x17321f, 0.34).fillRoundedRect(originX - 8, laneY + 7, boardW + 16, cellH - 14, 14);
            panel.lineStyle(1, 0xa7ff63, 0.1).lineBetween(originX + 8, laneY + cellH / 2, originX + boardW - 8, laneY + cellH / 2);
            for (let c = 0; c < COLS; c += 1) {
              const { x, y } = cellPoint(r, c);
              const isEnemyGate = c === COLS - 1;
              const isLanePath = c >= COLS - 3;
              const tileKey = isEnemyGate ? "tdStone" : isLanePath ? "tdDirt" : (r + c) % 5 === 0 ? "tdRoadGreen" : "tdGrass";
              this.add.image(x, y, tileKey).setDisplaySize(cellW + 2, cellH + 2).setAlpha(isEnemyGate ? 0.64 : isLanePath ? 0.58 : 0.48).setDepth(y);
              this.add.rectangle(x, y, cellW - 8, cellH - 8, isLanePath ? 0x2c2215 : 0x0a241a, isLanePath ? 0.2 : 0.1)
                .setStrokeStyle(1, isEnemyGate ? 0xffb15f : 0xa7ff63, isEnemyGate ? 0.28 : 0.09)
                .setDepth(y + 1);
              if (!isEnemyGate) {
                const pad = this.add.rectangle(x, y + 1, cellW - 30, cellH - 22, 0x173c2c, 0.08)
                  .setStrokeStyle(1, 0xa7ff63, (r + c) % 2 === 0 ? 0.16 : 0.09)
                  .setDepth(y + 1);
                if (isLanePath) pad.setStrokeStyle(1, 0xffd45f, 0.12);
              }
              if (c === COLS - 1) {
                this.add.rectangle(x, y, cellW - 12, cellH - 12, 0xff6d4f, 0.12).setStrokeStyle(1, 0xffb15f, 0.32).setDepth(y + 2);
                const gate = this.add.circle(x + 32, y, 8, 0xff6d4f, 0.65).setDepth(y + 3);
                gate.setBlendMode(Phaser.BlendModes.ADD);
                this.tweens.add({ targets: gate, scale: 1.7, alpha: 0.08, yoyo: true, repeat: -1, duration: 780, ease: "Sine.easeInOut" });
              }
            }
          }

          this.add.image(originX + boardW + 42, originY + 10, "barrelSide").setDisplaySize(48, 72).setAngle(90).setAlpha(0.78).setDepth(580);
          this.add.image(originX + boardW + 30, originY + boardH - 6, "tdTree").setDisplaySize(88, 88).setAlpha(0.9).setDepth(620);
          this.add.image(originX - 40, originY - 20, "tdTree").setDisplaySize(70, 70).setAlpha(0.82).setDepth(90);
          this.add.image(originX + 72, originY + boardH + 16, "tdRock").setDisplaySize(62, 50).setAlpha(0.76).setDepth(640);
          this.add.image(originX + boardW - 86, originY - 28, "tdCrystal").setDisplaySize(58, 58).setAlpha(0.72).setDepth(100);
          this.add.text(originX - 52, originY + boardH + 18, "CORE LINE", {
            fontFamily: "SFMono-Regular, Consolas, monospace",
            fontSize: "14px",
            color: "#9dff6a",
            fontStyle: "700",
          }).setDepth(1000);
          this.add.text(originX + boardW + 10, originY - 30, "ENEMY GATE", {
            fontFamily: "SFMono-Regular, Consolas, monospace",
            fontSize: "13px",
            color: "#ffb15f",
            fontStyle: "700",
          }).setOrigin(1, 0).setDepth(1000);

          for (let r = 0; r < ROWS; r += 1) {
            const p = cellPoint(r, -1);
            this.add.image(p.x + 24, p.y - 14, "sandbag").setDisplaySize(70, 34).setDepth(p.y + 18);
            this.add.image(p.x + 24, p.y + 14, "sandbag").setDisplaySize(70, 34).setDepth(p.y + 19);
          }

          this.grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ plant: null } as Cell)));
          this.hoverTile = this.add.rectangle(0, 0, cellW - 18, cellH - 14, 0xa7ff63, 0.13)
            .setStrokeStyle(2, 0xa7ff63, 0.58)
            .setVisible(false)
            .setDepth(12000);
          this.tweens.add({ targets: this.hoverTile, alpha: 0.48, yoyo: true, repeat: -1, duration: 680, ease: "Sine.easeInOut" });

          // 点格子种植
          this.input.on("pointermove", (p: any) => {
            if (this.over || !this.hoverTile) return;
            const { r, c } = pointerToCell(p.x, p.y);
            const valid = c >= 0 && c < COLS - 1 && r >= 0 && r < ROWS;
            if (!valid) {
              this.hoverTile.setVisible(false);
              return;
            }
            const { x, y } = cellPoint(r, c);
            const occupied = Boolean(this.grid[r]?.[c]?.plant);
            this.hoverTile
              .setPosition(x, y)
              .setFillStyle(occupied ? 0x63d7ff : 0xa7ff63, occupied ? 0.09 : 0.13)
              .setStrokeStyle(2, occupied ? 0x63d7ff : 0xa7ff63, occupied ? 0.54 : 0.58)
              .setVisible(true);
          });
          this.input.on("pointerout", () => this.hoverTile?.setVisible(false));
          this.input.on("pointerdown", (p: any) => {
            if (this.over) return;
            const { r, c } = pointerToCell(p.x, p.y);
            if (c < 0 || c >= COLS - 1 || r < 0 || r >= ROWS) return;
            if (this.grid[r]?.[c]?.plant) {
              const plant = this.grid[r][c].plant!;
              window.dispatchEvent(new CustomEvent("intoplay:lane-upgrade-attempt", { detail: { r, c, kind: plant.kind, level: plant.level } }));
              return;
            }
            window.dispatchEvent(new CustomEvent("intoplay:lane-plant-attempt", { detail: { r, c } }));
          });

          window.addEventListener("intoplay:lane-do-plant", this.plantHandler);
          window.addEventListener("intoplay:lane-do-upgrade", this.upgradeHandler);
          window.addEventListener("intoplay:lane-skill", this.skillHandler);
          window.addEventListener("intoplay:lane-mode", this.modeHandler);
          this.events.once("shutdown", () => {
            window.removeEventListener("intoplay:lane-do-plant", this.plantHandler);
            window.removeEventListener("intoplay:lane-do-upgrade", this.upgradeHandler);
            window.removeEventListener("intoplay:lane-skill", this.skillHandler);
            window.removeEventListener("intoplay:lane-mode", this.modeHandler);
            if ((window as unknown as { __intoPlayLaneSceneId?: string }).__intoPlayLaneSceneId === this.sceneId) {
              delete (window as unknown as { __intoPlayLaneSceneId?: string }).__intoPlayLaneSceneId;
            }
          });
          this.spawnTimer = 6.2;
          this.showBanner("Prep Phase", "Answer once, build first defense");
        }

        showBanner(title: string, subtitle: string) {
          this.waveBanner?.destroy();
          const banner = this.add.container(W / 2, 60).setDepth(24000).setAlpha(0);
          const shell = this.add.rectangle(0, 0, 420, 58, 0x071124, 0.78)
            .setStrokeStyle(1, 0xa7ff63, 0.5);
          const titleText = this.add.text(0, -12, title, {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "24px",
            color: "#f7fbff",
            fontStyle: "900",
          }).setOrigin(0.5);
          const subtitleText = this.add.text(0, 15, subtitle, {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "12px",
            color: "#9dff6a",
            fontStyle: "800",
          }).setOrigin(0.5);
          banner.add([shell, titleText, subtitleText]);
          this.waveBanner = banner;
          this.tweens.add({ targets: banner, y: 72, alpha: 1, duration: 220, ease: "Quad.easeOut" });
          this.time.delayedCall(1180, () => {
            this.tweens.add({ targets: banner, y: 54, alpha: 0, duration: 260, ease: "Quad.easeIn", onComplete: () => banner.destroy() });
          });
        }

        showFloat(x: number, y: number, label: string, color = 0xf7fbff) {
          const text = this.add.text(x, y, label, {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "18px",
            color: `#${color.toString(16).padStart(6, "0")}`,
            fontStyle: "900",
            stroke: "#071124",
            strokeThickness: 4,
          }).setOrigin(0.5).setDepth(22000);
          this.tweens.add({ targets: text, y: y - 34, alpha: 0, scale: 1.12, duration: 520, ease: "Quad.easeOut", onComplete: () => text.destroy() });
        }

        playExplosion(x: number, y: number, scale = 1) {
          const boom = this.add.sprite(x, y, "laneExplosion").setScale(scale).setDepth(y + 130);
          boom.setBlendMode(Phaser.BlendModes.ADD);
          boom.play("laneExplosionBoom");
          boom.once("animationcomplete", () => boom.destroy());
        }

        refreshPlantBadge(plant: NonNullable<Cell["plant"]>) {
          plant.badge?.destroy();
          const badge = this.add.container(28, -42);
          const shell = this.add.rectangle(0, 0, 42, 20, 0x071124, 0.82)
            .setStrokeStyle(1, plant.level >= 3 ? 0xffd45f : 0x63d7ff, 0.82);
          const text = this.add.text(0, 0, `Lv${plant.level}`, {
            fontFamily: "SFMono-Regular, Consolas, monospace",
            fontSize: "10px",
            color: plant.level >= 3 ? "#ffd45f" : "#63d7ff",
            fontStyle: "900",
          }).setOrigin(0.5);
          badge.add([shell, text]);
          plant.obj.add(badge);
          plant.badge = badge;
        }

        upgradeHandler = (event: Event) => {
          const d = (event as CustomEvent<{ r: number; c: number; kind: LanePlantKind; level: number }>).detail;
          if (!d || this.over || (window as unknown as { __intoPlayLaneSceneId?: string }).__intoPlayLaneSceneId !== this.sceneId || !(this as any).sys?.isActive()) return;
          const cell = this.grid[d.r]?.[d.c];
          const plant = cell?.plant;
          if (!plant || plant.level >= 3) return;
          plant.level += 1;
          const hpGain = plant.kind === "wall" ? 165 : plant.kind === "mine" ? 1 : 54;
          plant.maxHp += hpGain;
          plant.hp = Math.min(plant.maxHp, plant.hp + hpGain);
          plant.cd = Math.max(0, plant.cd * 0.66);
          plant.obj.setScale(1 + (plant.level - 1) * 0.08);
          this.refreshPlantBadge(plant);
          const { x, y } = cellPoint(d.r, d.c);
          const ringColor = plant.level >= 3 ? 0xffd45f : 0x63d7ff;
          const ring = this.add.circle(x, y, 28).setStrokeStyle(4, ringColor, 0.72).setDepth(y + 96);
          ring.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 460, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
          this.showFloat(x, y - 50, plant.level >= 3 ? "MAX LV" : `UP Lv${plant.level}`, ringColor);
          window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "upgrade", kind: plant.kind, level: plant.level } }));
        };

        skillHandler = (event: Event) => {
          const detail = (event as CustomEvent<{ kind: LaneSkillKind }>).detail;
          const kind = detail?.kind;
          if (!kind || this.over || (window as unknown as { __intoPlayLaneSceneId?: string }).__intoPlayLaneSceneId !== this.sceneId || !(this as any).sys?.isActive()) return;
          if (kind === "freeze") {
            this.showBanner("Freeze Field", "All enemies slowed");
            for (const z of this.zombies) {
              (z as any).slowUntil = Math.max((z as any).slowUntil ?? 0, this.time.now + 3400);
              (z as any).slowFactor = Math.min((z as any).slowFactor ?? 1, 0.16);
              const ring = this.add.circle(z.x, z.y - 18, 38, 0x63d7ff, 0.1)
                .setStrokeStyle(2, 0x63d7ff, 0.74)
                .setDepth(z.depth + 6);
              ring.setBlendMode(Phaser.BlendModes.ADD);
              this.tweens.add({ targets: ring, scale: 1.9, alpha: 0, duration: 640, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
            }
          } else if (kind === "blast") {
            this.showBanner("Knowledge Blast", "Misconceptions broken");
            this.cameras.main.shake(230, 0.012);
            for (const z of this.zombies) {
              this.playExplosion(z.x, z.y - 10, 0.82);
              this.damageZombie(z, 128 + this.waveIndex * 8, 0xffd45f, 0.72, 1200);
            }
          } else if (kind === "repair") {
            this.baseHpLocal = Math.min(260, this.baseHpLocal + 45);
            const x = originX - 28;
            const y = originY + boardH / 2;
            const shield = this.add.circle(x, y, 52, 0xa7ff63, 0.08).setStrokeStyle(3, 0xa7ff63, 0.72).setDepth(18000);
            shield.setBlendMode(Phaser.BlendModes.ADD);
            this.tweens.add({ targets: shield, scale: 2.4, alpha: 0, duration: 760, ease: "Quad.easeOut", onComplete: () => shield.destroy() });
            this.showFloat(x + 42, y - 44, "+45 BASE", 0xa7ff63);
            window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "base", hp: this.baseHpLocal } }));
          }
          window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "skill", kind } }));
        };

        modeHandler = (event: Event) => {
          const detail = (event as CustomEvent<{ endless: boolean }>).detail;
          if (!detail || (window as unknown as { __intoPlayLaneSceneId?: string }).__intoPlayLaneSceneId !== this.sceneId || !(this as any).sys?.isActive()) return;
          this.endlessMode = Boolean(detail.endless);
          this.showBanner(this.endlessMode ? "Endless armed" : "12-wave run", this.endlessMode ? "Victory will continue into challenge waves" : "Boss wave ends the run");
        };

        damageZombie(z: any, rawDamage: number, color = 0xf7fbff, slowFactor = 1, slowMs = 0) {
          const armor = (z as any).armor ?? 1;
          const damage = Math.max(1, Math.round(rawDamage * armor));
          (z as any).hp -= damage;
          const hpPercent = Math.max(0, (z as any).hp / (z as any).hpMax);
          (z as any).hpFill?.setScale(hpPercent, 1);
          const zBody = (z as any).body;
          if (zBody) {
            zBody.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
            this.time.delayedCall(70, () => {
              zBody.clearTint();
              if ((z as any).baseTint) zBody.setTint((z as any).baseTint);
            });
          }
          if (slowFactor < 1 && slowMs > 0) {
            (z as any).slowUntil = Math.max((z as any).slowUntil ?? 0, this.time.now + slowMs);
            (z as any).slowFactor = Math.min((z as any).slowFactor ?? 1, slowFactor);
            const slowRing = this.add.circle(z.x, z.y - 18, 34, 0x63d7ff, 0.12).setStrokeStyle(2, 0x63d7ff, 0.5).setDepth(z.depth + 4);
            this.tweens.add({ targets: slowRing, scale: 1.6, alpha: 0, duration: 420, ease: "Quad.easeOut", onComplete: () => slowRing.destroy() });
          }
          this.showFloat(z.x + 18, z.y - 58, `-${damage}`, color);
          return damage;
        }

        detonateMine(lane: number, col: number) {
          const cell = this.grid[lane]?.[col];
          const plant = cell?.plant;
          if (!cell || !plant || plant.kind !== "mine") return;
          const { x, y } = cellPoint(lane, col);
          plant.obj.destroy();
          cell.plant = null;
          this.playExplosion(x + 8, y - 8, 1.22);
          this.cameras.main.shake(150, 0.009);
          for (const z of this.zombies) {
            const sameCluster = Math.abs((z as any).lane - lane) <= 1 && Phaser.Math.Distance.Between(z.x, z.y, x, y) < 154;
            if (sameCluster) this.damageZombie(z, 158 + (plant.level - 1) * 88, 0xffb15f);
          }
          this.showFloat(x, y - 48, "MINE", 0xffb15f);
        }

        plantHandler = (event: Event) => {
          const d = (event as CustomEvent<{ r: number; c: number; kind: LanePlantKind }>).detail;
          if (!d || this.over || (window as unknown as { __intoPlayLaneSceneId?: string }).__intoPlayLaneSceneId !== this.sceneId || !(this as any).sys?.isActive()) return;
          const cell = this.grid[d.r]?.[d.c];
          if (!cell || cell.plant) return;
          const { x, y } = cellPoint(d.r, d.c);
          const tower = this.add.container(x, y);
          const shadow = this.add.ellipse(0, 30, 86, 24, 0x020611, 0.38);
          tower.add(shadow);
          if (d.kind === "shooter") {
            const base = this.add.image(0, 4, "towerBase").setDisplaySize(76, 76);
            const gun = this.add.image(4, -12, "towerMG").setDisplaySize(60, 96).setAngle(90);
            tower.add([base, gun]);
            this.tweens.add({ targets: gun, angle: { from: 87, to: 94 }, yoyo: true, repeat: -1, duration: 520, ease: "Sine.easeInOut" });
          } else if (d.kind === "cannon") {
            const base = this.add.image(0, 4, "towerBase").setDisplaySize(78, 78);
            const gun = this.add.image(2, -16, "towerCannon").setDisplaySize(54, 86).setAngle(90);
            tower.add([base, gun]);
            this.tweens.add({ targets: gun, angle: { from: 88, to: 92 }, yoyo: true, repeat: -1, duration: 840, ease: "Sine.easeInOut" });
          } else if (d.kind === "frost") {
            const base = this.add.image(0, 8, "towerBase").setDisplaySize(74, 74).setTint(0x63d7ff);
            const crystal = this.add.image(0, -22, "tdCrystal").setDisplaySize(62, 62);
            const aura = this.add.circle(0, 0, 42, 0x63d7ff, 0.11).setStrokeStyle(1, 0x63d7ff, 0.42);
            tower.add([aura, base, crystal]);
            this.tweens.add({ targets: aura, scale: 1.24, alpha: 0.04, yoyo: true, repeat: -1, duration: 900, ease: "Sine.easeInOut" });
            this.tweens.add({ targets: crystal, angle: 360, repeat: -1, duration: 5200, ease: "Linear" });
          } else if (d.kind === "missile") {
            const base = this.add.image(0, 4, "towerBase").setDisplaySize(82, 82);
            const rack = this.add.image(0, -16, "towerMissile").setDisplaySize(56, 92).setAngle(90);
            const rocket = this.add.image(10, -28, "towerMissileAmmo").setDisplaySize(22, 40).setAngle(90);
            tower.add([base, rack, rocket]);
            this.tweens.add({ targets: rack, y: -20, yoyo: true, repeat: -1, duration: 960, ease: "Sine.easeInOut" });
          } else if (d.kind === "mine") {
            const plate = this.add.image(0, 8, "debrisRing").setDisplaySize(72, 58);
            const core = this.add.image(0, -8, "tdImpact").setDisplaySize(44, 44).setAlpha(0.9);
            const glow = this.add.circle(0, -6, 26, 0xffb15f, 0.16);
            tower.add([glow, plate, core]);
            this.tweens.add({ targets: glow, scale: 1.35, alpha: 0.04, yoyo: true, repeat: -1, duration: 520, ease: "Sine.easeInOut" });
          } else {
            const platform = this.add.image(0, 6, "woodPlatform").setDisplaySize(82, 54);
            const wall = this.add.image(0, -6, "tdWall").setDisplaySize(82, 66);
            const fire = this.add.image(0, -24, "fireShrine").setDisplaySize(42, 50).setAlpha(0.84);
            tower.add([platform, wall, fire]);
          }
          this.tweens.add({ targets: tower, scale: { from: 0.45, to: 1 }, duration: 260, ease: moodFx.ease });
          tower.setDepth(y + 44);
          this.tweens.add({ targets: tower, y: y - 4, yoyo: true, repeat: -1, duration: 1400, ease: "Sine.easeInOut" });
          const hp = d.kind === "wall" ? 360 : d.kind === "mine" ? 1 : 126;
          cell.plant = {
            kind: d.kind,
            obj: tower,
            hp,
            maxHp: hp,
            cd: d.kind === "mine" ? 999 : 0,
            level: 1,
          };
          this.refreshPlantBadge(cell.plant);
          this.hoverTile?.setVisible(false);
          const buildRing = this.add.circle(x, y, 24).setStrokeStyle(3, 0xa7ff63, 0.7).setDepth(y + 80);
          this.tweens.add({ targets: buildRing, scale: 2.2, alpha: 0, duration: 380, ease: "Quad.easeOut", onComplete: () => buildRing.destroy() });
          this.showFloat(x, y - 42, "Built", 0xa7ff63);
          window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "plant", kind: d.kind } }));
        };

        spawnZombie(lane: number, monsterIndex = 0) {
          const p = cellPoint(lane, COLS - 0.22);
          const cont = this.add.container(p.x, p.y);
          const config = monsterRoster[monsterIndex % monsterRoster.length];
          const monsterId = config.id;
          const shadow = this.add.ellipse(0, 30, 74, 24, 0x020611, 0.36);
          const body = this.add.sprite(0, -14, monsterFrameKeys(monsterId)[0]).setDisplaySize(82 * config.scale, 102 * config.scale).setFlipX(true);
          if ("tint" in config && config.tint) body.setTint(config.tint);
          body.play(`monster${monsterId}Run`);
          const hpBack = this.add.rectangle(0, -58, 58, 6, 0x071124, 0.82);
          const hpFill = this.add.rectangle(-29, -58, 58, 6, config.color, 0.96).setOrigin(0, 0.5);
          const typeTag = this.add.text(0, -72, config.label.toUpperCase(), {
            fontFamily: "SFMono-Regular, Consolas, monospace",
            fontSize: "9px",
            color: `#${config.color.toString(16).padStart(6, "0")}`,
            fontStyle: "900",
          }).setOrigin(0.5).setAlpha(monsterIndex > 0 ? 0.92 : 0);
          cont.add([shadow, body, hpBack, hpFill, typeTag]);
          (cont as any).hp = config.hp + this.waveIndex * 12;
          (cont as any).hpMax = config.hp + this.waveIndex * 12;
          (cont as any).hpFill = hpFill;
          (cont as any).body = body;
          (cont as any).monsterId = monsterId;
          (cont as any).baseTint = "tint" in config ? config.tint : undefined;
          (cont as any).armor = config.armor;
          (cont as any).speed = config.speed;
          (cont as any).attackDps = config.damage;
          (cont as any).slowFactor = 1;
          (cont as any).slowUntil = 0;
          (cont as any).lane = lane;
          (cont as any).cPos = COLS - 0.22;
          cont.setDepth(p.y + 50);
          this.tweens.add({ targets: cont, y: p.y + 3, yoyo: true, repeat: -1, duration: 360 });
          this.zombies.push(cont);
        }

        currentWavePattern() {
          if (this.waveIndex < wavePattern.length) return wavePattern[this.waveIndex];
          const length = Math.min(22, 12 + Math.floor(this.waveIndex * 0.9));
          return Array.from({ length }, (_, index) => {
            if (index % 7 === 0) return 6;
            if (index % 5 === 0) return 5;
            return Phaser.Math.Between(0, 4);
          });
        }

        update(timeMs: number, delta: number) {
          if (this.over) return;
          const dt = Math.min(delta / 1000, 0.05);

          // 波次 spawn
          this.spawnTimer -= dt;
          const currentPattern = this.currentWavePattern();
          if (this.spawnTimer <= 0 && this.spawnedThisWave < currentPattern.length) {
            const lane = this.waveIndex === 0 && this.spawnedThisWave === 0 ? 2 : Phaser.Math.Between(0, ROWS - 1);
            this.spawnZombie(lane, currentPattern[this.spawnedThisWave]);
            this.spawnedThisWave += 1;
            this.spawnTimer = Math.max(0.62, 1.55 - this.waveIndex * 0.06);
          }
          if (this.spawnedThisWave >= currentPattern.length && this.zombies.length === 0) {
            this.waveIndex += 1;
            this.spawnedThisWave = 0;
            if (this.waveIndex >= totalWaves && !this.endlessMode) { this.finish(true); return; }
            window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "wave", wave: this.waveIndex + 1 } }));
            this.spawnTimer = this.waveIndex >= totalWaves ? 2.2 : 3.2;
            this.showBanner(this.waveIndex >= totalWaves ? `Endless ${this.waveIndex + 1}` : `Wave ${this.waveIndex + 1}`, this.waveIndex + 1 === totalWaves ? "Boss wave incoming" : "Threat pattern changed");
          }

          // 射手开火
          for (let r = 0; r < ROWS; r += 1) {
            for (let c = 0; c < COLS; c += 1) {
              const cell = this.grid[r][c];
              const plant = cell.plant;
              if (!plant || !["shooter", "cannon", "frost", "missile"].includes(plant.kind)) continue;
              plant.cd -= dt;
              const isCannon = plant.kind === "cannon";
              const isFrost = plant.kind === "frost";
              const isMissile = plant.kind === "missile";
              const level = plant.level ?? 1;
              const cooldownScale = Math.max(0.56, 1 - (level - 1) * 0.17);
              const damageScale = 1 + (level - 1) * 0.38;
              const target = isMissile
                ? this.zombies
                  .filter((z) => (z as any).cPos > c - 0.4)
                  .sort((a, b) => Phaser.Math.Distance.Between(plant.obj.x, plant.obj.y, a.x, a.y) - Phaser.Math.Distance.Between(plant.obj.x, plant.obj.y, b.x, b.y))[0]
                : this.zombies.find((z) => (z as any).lane === r && (z as any).cPos > c);
              if (plant.cd <= 0 && target) {
                plant.cd = (isMissile ? 2.8 : isCannon ? 2.2 : isFrost ? 1.55 : moodFx.dur < 0.3 ? 0.86 : 1.18) * cooldownScale;
                const b = this.add.image(
                  plant.obj.x + (isMissile ? 36 : isCannon ? 48 : 42),
                  plant.obj.y - (isMissile ? 28 : isCannon ? 22 : 18),
                  isMissile || isCannon ? "tdProjectile" : "laneBullet",
                ).setDisplaySize((isMissile ? 42 : isCannon ? 34 : 28) + (level - 1) * 5, (isMissile ? 42 : isCannon ? 34 : 14) + (level - 1) * 3).setAngle(90);
                if (isFrost) b.setTint(0x63d7ff);
                b.setBlendMode(Phaser.BlendModes.ADD);
                (b as any).lane = r;
                (b as any).target = target;
                (b as any).damage = Math.round((isMissile ? 56 : isCannon ? 64 : isFrost ? 16 : 30) * damageScale);
                (b as any).aoe = isMissile ? 96 + (level - 1) * 24 : isCannon ? 62 + (level - 1) * 18 : 0;
                (b as any).slowFactor = isFrost ? Math.max(0.28, 0.48 - (level - 1) * 0.08) : 1;
                (b as any).slowMs = isFrost ? 1700 + (level - 1) * 420 : 0;
                (b as any).speed = isMissile ? 390 + (level - 1) * 54 : bulletSpeed + (level - 1) * 46;
                (b as any).hitColor = isMissile ? 0xffd45f : isCannon ? 0xffb15f : isFrost ? 0x63d7ff : 0xf7fbff;
                (b as any).tracking = isMissile;
                this.bullets.push(b);
              }
            }
          }

          // 子弹移动 + 命中
          for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
            const b = this.bullets[i];
            const target = (b as any).target && this.zombies.includes((b as any).target) ? (b as any).target : this.zombies.find((z) => (z as any).lane === (b as any).lane);
            if (target) {
              const angle = Phaser.Math.Angle.Between(b.x, b.y, target.x, target.y - 18);
              const speed = (b as any).speed ?? bulletSpeed;
              b.x += Math.cos(angle) * speed * dt;
              b.y += Math.sin(angle) * speed * dt;
              b.rotation = angle + Math.PI / 2;
            } else {
              b.x += ((b as any).speed ?? bulletSpeed) * dt;
            }
            let hit = false;
            for (const z of this.zombies) {
              if (((b as any).tracking || (z as any).lane === (b as any).lane) && Phaser.Math.Distance.Between(z.x, z.y - 18, b.x, b.y) < 30) {
                const damage = (b as any).damage ?? 34;
                const hitColor = (b as any).hitColor ?? (damage >= 60 ? 0xffb15f : 0xf7fbff);
                const impact = this.add.image(z.x - 20, z.y - 4, damage >= 54 ? "tdImpact" : "laneSmoke").setDisplaySize(damage >= 54 ? 62 : 54, damage >= 54 ? 62 : 54).setAlpha(0.92);
                impact.setBlendMode(Phaser.BlendModes.ADD);
                this.tweens.add({ targets: impact, scale: damage >= 54 ? 1.65 : 1.45, alpha: 0, duration: 260, onComplete: () => impact.destroy() });
                if ((b as any).aoe > 0) {
                  this.playExplosion(z.x - 10, z.y - 10, damage >= 60 ? 0.86 : 0.7);
                  for (const splash of this.zombies) {
                    if (Phaser.Math.Distance.Between(splash.x, splash.y, z.x, z.y) <= (b as any).aoe) {
                      this.damageZombie(splash, damage, hitColor, (b as any).slowFactor ?? 1, (b as any).slowMs ?? 0);
                    }
                  }
                } else {
                  this.damageZombie(z, damage, hitColor, (b as any).slowFactor ?? 1, (b as any).slowMs ?? 0);
                }
                this.cameras.main.shake(damage >= 54 ? 110 : 60, moodFx.shake * (damage >= 54 ? 0.9 : 0.5));
                hit = true;
                break;
              }
            }
            if (hit || b.x > W + 70 || b.x < -70 || b.y < -70 || b.y > H + 70) { b.destroy(); this.bullets.splice(i, 1); }
          }

          // 怪兽移动 + 攻击防御 + 到底
          for (let i = this.zombies.length - 1; i >= 0; i -= 1) {
            const z = this.zombies[i];
            const lane = (z as any).lane;
            // 死亡
            if ((z as any).hp <= 0) {
              const zBody = (z as any).body;
              if (zBody) {
                zBody.stop();
                zBody.setTexture(`monster${(z as any).monsterId}Die`);
              }
              this.playExplosion(z.x, z.y - 12, 0.95);
              const dust = this.add.image(z.x, z.y, "laneDust").setDisplaySize(72, 72).setAlpha(0.82).setDepth(z.depth + 1);
              this.tweens.add({ targets: dust, scale: 1.65, alpha: 0, duration: 360, onComplete: () => dust.destroy() });
              this.tweens.add({ targets: z, alpha: 0, scale: 0.3, duration: 220, onComplete: () => z.destroy() });
              this.zombies.splice(i, 1);
              window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "kill" } }));
              continue;
            }
            // 前方同格植物？啃植物
            const col = Math.floor((z as any).cPos);
            const cell = this.grid[lane]?.[col];
            if (cell?.plant?.kind === "mine" && (z as any).cPos > -0.2) {
              this.detonateMine(lane, col);
            } else if (cell?.plant && (z as any).cPos > -0.2) {
              cell.plant.hp -= ((z as any).attackDps ?? 40) * dt;
              if (cell.plant.hp <= 0) { cell.plant.obj.destroy(); cell.plant = null; }
            } else {
              const slowActive = ((z as any).slowUntil ?? 0) > this.time.now;
              const speedFactor = slowActive ? ((z as any).slowFactor ?? 0.58) : 1;
              if (!slowActive) (z as any).slowFactor = 1;
              (z as any).cPos -= (((z as any).speed ?? 0.64) + this.waveIndex * 0.04) * speedFactor * dt;
              const next = cellPoint(lane, (z as any).cPos);
              z.x = next.x;
              z.y = next.y;
              z.setDepth(next.y + 58);
            }
            // 到最左 → 扣防线
            if ((z as any).cPos <= -1.2) {
              if (this.laneSaves[lane]) {
                this.laneSaves[lane] = false;
                this.cameras.main.shake(210, 0.012);
                this.playExplosion(originX - 42, z.y, 1.28);
                this.showFloat(originX - 8, z.y - 46, "INTERCEPT", 0xa7ff63);
                for (const laneZombie of this.zombies) {
                  if ((laneZombie as any).lane === lane) {
                    (laneZombie as any).hp = 0;
                  }
                }
                window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "save", lane } }));
                continue;
              }
              this.baseHpLocal -= 24;
              this.cameras.main.shake(160, 0.01);
              this.playExplosion(z.x, z.y, 1.08);
              z.destroy();
              this.zombies.splice(i, 1);
              window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "breach", hp: this.baseHpLocal } }));
              if (this.baseHpLocal <= 0) { this.finish(false); return; }
            }
          }
        }

        finish(survived: boolean) {
          this.over = true;
          window.dispatchEvent(new CustomEvent("intoplay:lane-event", { detail: { type: "end", survived } }));
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: W,
        height: H,
        transparent: true,
        audio: { noAudio: true },
        scene: LaneScene,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      });
    });

    return () => {
      cancelled = true;
      game?.destroy(true);
      if (host) host.innerHTML = "";
    };
  }, [quest.spec.mood, quest.schema]);

  // 种植意图 → 校验能量 → 通知场景种植 + 扣能量。
  useEffect(() => {
    const attempt = (event: Event) => {
      const d = (event as CustomEvent<{ r: number; c: number }>).detail;
      if (!d || disabled) return;
      const kind = selectedPlantRef.current;
      const cost = plantCost[kind];
      if (energyRef.current < cost) {
        flashLaneNotice(`还差 ${cost - energyRef.current} 能量，答对一道题再建造${plantLabel[kind]}`);
        playFeedbackTone("miss");
        return;
      }
      setEnergy((value) => value - cost);
      window.dispatchEvent(new CustomEvent("intoplay:lane-do-plant", { detail: { r: d.r, c: d.c, kind } }));
      playFeedbackTone("stack");
    };
    window.addEventListener("intoplay:lane-plant-attempt", attempt);
    return () => window.removeEventListener("intoplay:lane-plant-attempt", attempt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // 点击已有塔 → 花能量升级，避免只铺塔没有中盘决策。
  useEffect(() => {
    const attemptUpgrade = (event: Event) => {
      const d = (event as CustomEvent<{ r: number; c: number; kind: LanePlantKind; level: number }>).detail;
      if (!d || disabled) return;
      if (d.level >= 3) {
        flashLaneNotice(`${plantLabel[d.kind]}已经满级`);
        playFeedbackTone("success");
        return;
      }
      const cost = upgradeCost(d.kind, d.level);
      if (energyRef.current < cost) {
        flashLaneNotice(`升级${plantLabel[d.kind]}还差 ${cost - energyRef.current} 能量`);
        playFeedbackTone("miss");
        return;
      }
      setEnergy((value) => value - cost);
      window.dispatchEvent(new CustomEvent("intoplay:lane-do-upgrade", { detail: d }));
      playFeedbackTone("success");
    };
    window.addEventListener("intoplay:lane-upgrade-attempt", attemptUpgrade);
    return () => window.removeEventListener("intoplay:lane-upgrade-attempt", attemptUpgrade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, flashLaneNotice]);

  const triggerLaneSkill = (kind: LaneSkillKind) => {
    if (disabled) return;
    if (skillCooldowns[kind] > 0) {
      flashLaneNotice(`${skillLabel[kind]}冷却中 ${skillCooldowns[kind]}s`);
      playFeedbackTone("miss");
      return;
    }
    const cost = skillCost[kind];
    if (energyRef.current < cost) {
      flashLaneNotice(`${skillLabel[kind]}还差 ${cost - energyRef.current} 能量`);
      playFeedbackTone("miss");
      return;
    }
    setEnergy((value) => value - cost);
    setSkillCooldowns((current) => ({ ...current, [kind]: skillCooldownSeconds[kind] }));
    flashLaneNotice(skillLabel[kind], 1100);
    window.dispatchEvent(new CustomEvent("intoplay:lane-skill", { detail: { kind } }));
    playFeedbackTone("stack");
  };

  const toggleEndlessMode = () => {
    const next = !endlessRef.current;
    endlessRef.current = next;
    setEndlessMode(next);
    flashLaneNotice(next ? "Endless 已开启：12 波后继续挑战" : "Endless 已关闭：12 波后结算", 1400);
    window.dispatchEvent(new CustomEvent("intoplay:lane-mode", { detail: { endless: next } }));
  };

  // 场景事件 → 更新 React HUD + proof。
  useEffect(() => {
    const onEvent = (event: Event) => {
      const d = (event as CustomEvent<any>).detail;
      if (!d) return;
      if (d.type === "wave") setWave(d.wave);
      else if (d.type === "breach") { setBaseHp(Math.max(0, d.hp)); playFeedbackTone("miss"); }
      else if (d.type === "base") setBaseHp(Math.max(0, d.hp));
      else if (d.type === "kill") {
        setKills((value) => value + 1);
        onRuntimeEventRef.current({
          advances: false, correct: true, choice: "击退怪兽", feedback: "一只知识缺口被守住。",
          kind: "hit", runtimeStatus: "Defended", stageId: "lane", stageTitle: "Defense",
        });
      } else if (d.type === "save") {
        flashLaneNotice(`第 ${Number(d.lane) + 1} 路紧急拦截已触发`, 1400);
        onRuntimeEventRef.current({
          advances: false, correct: true, choice: "紧急拦截", feedback: "一条防线的保底装置已消耗。",
          kind: "guarded", runtimeStatus: "Intercept", stageId: "lane", stageTitle: "Defense",
        });
      } else if (d.type === "upgrade") {
        onRuntimeEventRef.current({
          advances: false, correct: true, choice: "升级防御", feedback: `${plantLabel[d.kind as LanePlantKind] ?? "防御塔"}提升到 Lv${d.level}。`,
          kind: "hit", runtimeStatus: "Upgraded", stageId: "lane", stageTitle: "Defense",
        });
      } else if (d.type === "skill") {
        onRuntimeEventRef.current({
          advances: false, correct: true, choice: skillLabel[d.kind as LaneSkillKind] ?? "战术技能", feedback: "战术技能已释放。",
          kind: "hit", runtimeStatus: "Skill", stageId: "lane", stageTitle: "Defense",
        });
      } else if (d.type === "end") {
        onCompleteRef.current(Boolean(d.survived));
      }
    };
    window.addEventListener("intoplay:lane-event", onEvent);
    return () => window.removeEventListener("intoplay:lane-event", onEvent);
  }, []);

  return (
    <div className={`template-play template-lane mood-${quest.spec.mood}`}>
      <div className="lane-hud" aria-label="Lane defense status">
        <span className="lane-stat hp"><img src="/assets/kenney-boardgame/pieceRed_single18.png" alt="" />防线 {baseHp}</span>
        <span className="lane-stat energy"><img src="/assets/kenney-boardgame/chipGreenWhite.png" alt="" />能量 {energy}</span>
        <span className="lane-stat wave">第 {wave}/{endlessMode ? "∞" : laneTotalWaves} 波</span>
        <span className="lane-stat kills">击退 {kills}</span>
      </div>
      <div className="lane-wave-track" aria-label="Wave progress">
        {Array.from({ length: laneTotalWaves }, (_, index) => {
          const step = index + 1;
          return (
            <span
              className={`${step < wave || wave > laneTotalWaves ? "done" : ""} ${step === Math.min(wave, laneTotalWaves) ? "current" : ""} ${step === laneTotalWaves ? "boss" : ""}`}
              key={step}
            >
              {step === laneTotalWaves ? "B" : step}
            </span>
          );
        })}
      </div>
      <AnimatePresence>
        {laneNotice ? (
          <motion.div
            className="lane-toast"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            {laneNotice}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="lane-board-host" ref={hostRef} aria-label="Plant defense grid" />
      <div className="lane-seed-bar" aria-label="Plant picker">
        {([
          { id: "shooter" as const, label: "射手", desc: "快射单线", icon: "/assets/basic-towers/MG.png" },
          { id: "cannon" as const, label: "重炮", desc: "小范围伤害", icon: "/assets/basic-towers/Cannon.png" },
          { id: "frost" as const, label: "冰塔", desc: "减速快怪", icon: "/assets/kenney-tower-defense/towerDefense_tile134.png" },
          { id: "missile" as const, label: "导弹", desc: "跨线追踪", icon: "/assets/basic-towers/Missile_Launcher.png" },
          { id: "wall" as const, label: "护墙", desc: "挡住肉盾", icon: "/assets/kenney-tower-defense/towerDefense_tile228.png" },
          { id: "mine" as const, label: "地雷", desc: "一次爆破", icon: "/assets/craftpix-stone-td/debris-ring.png" },
        ]).map((seed) => (
          <button
            className={`lane-seed ${selectedPlant === seed.id ? "active" : ""} ${energy < plantCost[seed.id] ? "too-pricey" : ""}`}
            key={seed.id}
            type="button"
            onClick={() => setSelectedPlant(seed.id)}
          >
            <img src={seed.icon} alt="" />
            <span>
              <strong>{seed.label}</strong>
              <em>{seed.desc}</em>
            </span>
            <i>{plantCost[seed.id]}⚡</i>
          </button>
        ))}
        <span className="lane-hint">12 题能量 · 12 波主线 · 点击塔可升级</span>
      </div>
      <div className="lane-skill-bar" aria-label="Lane powerups">
        {([
          { id: "freeze" as const, label: "冰冻全场", desc: "减速 3 秒", icon: "❄" },
          { id: "blast" as const, label: "知识爆破", desc: "全场伤害", icon: "✦" },
          { id: "repair" as const, label: "修复防线", desc: "+45 防线", icon: "✚" },
        ]).map((skill) => (
          <button
            className={`lane-skill ${energy < skillCost[skill.id] ? "too-pricey" : ""} ${skillCooldowns[skill.id] > 0 ? "cooling" : ""}`}
            disabled={disabled}
            key={skill.id}
            type="button"
            onClick={() => triggerLaneSkill(skill.id)}
          >
            <span>{skill.icon}</span>
            <strong>{skill.label}</strong>
            <em>{skillCooldowns[skill.id] > 0 ? `冷却 ${skillCooldowns[skill.id]}s` : skill.desc}</em>
            <i>{skillCooldowns[skill.id] > 0 ? "CD" : `${skillCost[skill.id]}⚡`}</i>
          </button>
        ))}
        <button
          className={`lane-skill lane-endless ${endlessMode ? "active" : ""}`}
          disabled={disabled}
          type="button"
          onClick={toggleEndlessMode}
        >
          <span>∞</span>
          <strong>Endless</strong>
          <em>{endlessMode ? "12 波后继续" : "挑战模式"}</em>
          <i>{endlessMode ? "ON" : "OFF"}</i>
        </button>
      </div>
      {energyBursts.map((burst) => (
        <span
          className="lane-energy-burst"
          key={burst.id}
          style={{
            left: burst.x,
            top: burst.y,
            "--dx": `${burst.dx}px`,
            "--dy": `${burst.dy}px`,
          } as CSSProperties}
        >
          {burst.label}
        </span>
      ))}
    </div>
  );
}

// 卡片堆栈骨架（boss）已删除：相关组件 buildStackCards/StackDropZone/DraggableStackCard/CardStackBuilderPlayable/PhaserCardStackPlayable 一并移除。


function AgentLens({ quest, stage, phase }: { quest: QuestGame; stage: Stage; phase: Phase }) {
  const concepts = quest.keywords.slice(0, 3);
  const guardrail = phase === "proof" ? "Proof locked" : `${quest.stages.length} levels · ${stage.title}`;

  return (
    <section className="agent-lens" aria-label="Agent understanding">
      <article>
        <span>Content map</span>
        <strong>{concepts.map((item) => compact(item, 7)).join(" · ")}</strong>
      </article>
      <article>
        <span>Play goal</span>
        <strong>{compact(quest.spec.goal, 20)}</strong>
      </article>
      <article>
        <span>Mood · Guard</span>
        <strong>{moodDescriptor[quest.spec.mood]} · {guardrail}</strong>
      </article>
    </section>
  );
}

// 知识幸存者（吸血鬼幸存者式肉鸽）。人物自动攻击最近怪，玩家点击/拖动移动，
// 答对右侧题会释放知识脉冲并给金币，升级武器后扛过波次=胜利 / 血量归零=失败。
// 复用 LaneDefensePlayable 的 Phaser 接入模式 + window 事件总线 + moodMotion。
type SurvivorUpgradeKind = "attackSpeed" | "damage" | "range" | "multishot" | "moveSpeed" | "aura" | "orbit" | "magnet";
type SurvivorRelicKind = "quizForge" | "dashTalisman" | "goldMagnet" | "novaCore" | "guardianShell" | "xpBloom";

function SurvivorPlayable({
  quest,
  onRuntimeEvent,
  onComplete,
  disabled,
}: {
  quest: QuestGame;
  onRuntimeEvent: (event: Omit<PlayEvent, "id">) => void;
  onComplete: (survived: boolean) => void;
  disabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onRuntimeEventRef = useRef(onRuntimeEvent);
  const onCompleteRef = useRef(onComplete);
  onRuntimeEventRef.current = onRuntimeEvent;
  onCompleteRef.current = onComplete;

  const [coins, setCoins] = useState(60);
  const [hp, setHp] = useState(220);
  const [wave, setWave] = useState(1);
  const [kills, setKills] = useState(0);
  const [waveKills, setWaveKills] = useState(0);
  const [waveQuota, setWaveQuota] = useState(14);
  const [heroLevel, setHeroLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [xpGoal, setXpGoal] = useState(36);
  const [focus, setFocus] = useState(0);
  const [novaActive, setNovaActive] = useState(false);
  const [dashReady, setDashReady] = useState(true);
  const [combatEvent, setCombatEvent] = useState("巡逻稳定");
  const [bossHud, setBossHud] = useState<{ visible: boolean; hpPct: number; phase: number } | null>(null);
  const [draftChoices, setDraftChoices] = useState<SurvivorUpgradeKind[] | null>(null);
  const [relicChoices, setRelicChoices] = useState<SurvivorRelicKind[] | null>(null);
  const [levels, setLevels] = useState<Record<SurvivorUpgradeKind, number>>({ attackSpeed: 0, damage: 0, range: 0, multishot: 0, moveSpeed: 0, aura: 0, orbit: 0, magnet: 0 });
  const [relics, setRelics] = useState<Record<SurvivorRelicKind, number>>({ quizForge: 0, dashTalisman: 0, goldMagnet: 0, novaCore: 0, guardianShell: 0, xpBloom: 0 });
  const coinsRef = useRef(coins);
  const draftRef = useRef<SurvivorUpgradeKind[] | null>(draftChoices);
  const relicRef = useRef<SurvivorRelicKind[] | null>(relicChoices);
  const novaTimerRef = useRef<number | null>(null);
  const combatEventTimerRef = useRef<number | null>(null);
  coinsRef.current = coins;
  draftRef.current = draftChoices;
  relicRef.current = relicChoices;

  const survivorTotalWaves = 12;
  const currentThreat = wave >= survivorTotalWaves ? "Boss 决战" : wave % 3 === 0 ? "精英波" : wave >= 3 ? "弹幕怪" : "怪潮";
  const nextReward = wave >= survivorTotalWaves ? "通关 Proof" : wave % 3 === 0 ? "清波开遗物" : `第 ${Math.ceil(wave / 3) * 3} 波遗物`;
  const upgradeLabel: Record<SurvivorUpgradeKind, string> = { attackSpeed: "攻速", damage: "伤害", range: "范围", multishot: "多重弹", moveSpeed: "移速", aura: "光环", orbit: "环绕刃", magnet: "磁吸" };
  const upgradeDesc: Record<SurvivorUpgradeKind, string> = { attackSpeed: "开火更快", damage: "子弹更痛", range: "索敌更远", multishot: "多发齐射", moveSpeed: "走位更快", aura: "近身灼烧", orbit: "贴身切割", magnet: "吸经验更远" };
  const relicLabel: Record<SurvivorRelicKind, string> = { quizForge: "答题熔炉", dashTalisman: "闪避符文", goldMagnet: "星币磁场", novaCore: "Nova 核心", guardianShell: "守护甲片", xpBloom: "经验花园" };
  const relicDesc: Record<SurvivorRelicKind, string> = { quizForge: "答对脉冲回血和伤害提高", dashTalisman: "Dash 冷却缩短", goldMagnet: "金币掉落和磁吸提高", novaCore: "Nova 更久更痛", guardianShell: "获得一次免伤", xpBloom: "经验获取提高" };
  const relicCount = Object.values(relics).reduce((sum, value) => sum + value, 0);
  const evolvedKit = useMemo(() => {
    const names: string[] = [];
    if (levels.damage >= 2 && levels.multishot >= 2) names.push("Prism");
    if (levels.aura >= 2) names.push("Solar");
    if (levels.orbit >= 2) names.push("Orbit");
    return names.length ? names.join(" / ") : "Basic";
  }, [levels]);
  const pausedForChoice = Boolean(draftChoices || relicChoices);
  const upgradeCost = (kind: SurvivorUpgradeKind, level: number) => {
    const base = kind === "multishot" ? 100 : kind === "orbit" ? 90 : kind === "aura" || kind === "magnet" ? 70 : 50;
    return base + level * (kind === "multishot" ? 60 : 36);
  };

  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef<number | null>(null);
  const flashNotice = useCallback((message: string, timeout = 1500) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), timeout);
  }, []);

  const flashCombatEvent = useCallback((label: string, timeout = 2200) => {
    setCombatEvent(label);
    if (combatEventTimerRef.current) window.clearTimeout(combatEventTimerRef.current);
    combatEventTimerRef.current = window.setTimeout(() => setCombatEvent("巡逻稳定"), timeout);
  }, []);

  // 答对题 → 加金币。
  useEffect(() => {
    const handler = (event: Event) => {
      const amount = (event as CustomEvent<{ amount: number }>).detail?.amount ?? 30;
      setCoins((value) => Math.min(9999, value + amount));
    };
    window.addEventListener("intoplay:survivor-coin", handler);
    return () => window.removeEventListener("intoplay:survivor-coin", handler);
  }, []);

  // 买升级：扣金币 + 通知场景应用 buff。
  function buyUpgrade(kind: SurvivorUpgradeKind) {
    const level = levels[kind];
    const cost = upgradeCost(kind, level);
    if (coinsRef.current < cost || disabled) {
      flashNotice("金币不足，先答题攒金币");
      return;
    }
    setCoins((value) => value - cost);
    setLevels((current) => ({ ...current, [kind]: current[kind] + 1 }));
    window.dispatchEvent(new CustomEvent("intoplay:survivor-upgrade", { detail: { kind } }));
    playFeedbackTone("stack");
    flashNotice(`${upgradeLabel[kind]} 升级到 Lv.${level + 1}`);
  }

  function pickDraftUpgrade(kind: SurvivorUpgradeKind) {
    if (!draftRef.current?.includes(kind)) return;
    setDraftChoices(null);
    setLevels((current) => ({ ...current, [kind]: current[kind] + 1 }));
    window.dispatchEvent(new CustomEvent("intoplay:survivor-upgrade", { detail: { kind, source: "draft" } }));
    window.dispatchEvent(new CustomEvent("intoplay:survivor-resume"));
    playFeedbackTone("success");
    flashNotice(`选择 ${upgradeLabel[kind]}：Lv.${levels[kind] + 1}`, 1200);
    onRuntimeEventRef.current({
      advances: false,
      correct: true,
      choice: `选择${upgradeLabel[kind]}`,
      feedback: "升级三选一已确认，继续幸存。",
      kind: "hit",
      runtimeStatus: "Leveled",
      stageId: "survivor",
      stageTitle: "Survivor",
    });
  }

  function pickRelic(kind: SurvivorRelicKind) {
    if (!relicRef.current?.includes(kind)) return;
    setRelicChoices(null);
    setRelics((current) => ({ ...current, [kind]: current[kind] + 1 }));
    window.dispatchEvent(new CustomEvent("intoplay:survivor-relic", { detail: { kind } }));
    window.dispatchEvent(new CustomEvent("intoplay:survivor-resume", { detail: { type: "relic" } }));
    playFeedbackTone("success");
    flashNotice(`${relicLabel[kind]} 已装配`, 1400);
    onRuntimeEventRef.current({
      advances: false,
      correct: true,
      choice: `装配${relicLabel[kind]}`,
      feedback: "遗物构筑已生效，下一波怪潮会按新能力结算。",
      kind: "hit",
      runtimeStatus: "Relic",
      stageId: "survivor",
      stageTitle: "Survivor",
    });
  }

  // Phaser 场景：吸血鬼幸存者式核心循环。
  useEffect(() => {
    let cancelled = false;
    let game: { destroy: (removeCanvas: boolean, noReturn?: boolean) => void } | null = null;
    const host = hostRef.current;
    if (!host) return undefined;
    host.innerHTML = "";
    const moodFx = moodMotion[quest.spec.mood];

    void import("phaser").then((module) => {
      if (cancelled || !hostRef.current) return;
      const Phaser = module.default ?? module;
      const hostWidth = host.getBoundingClientRect().width || 1180;
      const compactArena = hostWidth < 760;
      const VIEW_W = compactArena ? 820 : 1180;
      const VIEW_H = compactArena ? 720 : 620;
      const W = Math.round(VIEW_W * (compactArena ? 1.9 : 2.15));
      const H = Math.round(VIEW_H * (compactArena ? 1.65 : 1.9));
      const MAX_ENEMIES = compactArena ? 76 : 96;
      const TOTAL_WAVES = 12;
      const bulletSpeed = moodFx.dur < 0.3 ? 720 : 610;
      const upgradeKinds: SurvivorUpgradeKind[] = ["attackSpeed", "damage", "range", "multishot", "moveSpeed", "aura", "orbit", "magnet"];
      const relicKinds: SurvivorRelicKind[] = ["quizForge", "dashTalisman", "goldMagnet", "novaCore", "guardianShell", "xpBloom"];
      const monsterIds = [1, 7, 9] as const;
      const monsterFrameKeys = (id: number) => (
        Array.from({ length: 8 }, (_, index) => `survivorMonster${id}Run${String(index).padStart(3, "0")}`)
      );

      type Enemy = {
        obj: any;
        body: any;
        hp: number;
        hpMax: number;
        speed: number;
        damage: number;
        elite: boolean;
        boss: boolean;
        ranged: boolean;
        entered: boolean;
        shotTimer: number;
        shotEvery: number;
        skillTimer: number;
        phase: number;
        xp: number;
        coin: number;
      };
      type Bullet = { obj: any; vx: number; vy: number; active: boolean; damage: number; pierce: number };
      type EnemyShot = { obj: any; vx: number; vy: number; damage: number; age: number };
      type Gem = { obj: any; value: number; coin: number; age: number };
      type DangerZone = { obj: any; x: number; y: number; radius: number; timer: number; damage: number };

      class SurvivorScene extends Phaser.Scene {
        player?: any;
        playerShadow?: any;
        auraRing?: any;
        levelText?: any;
        targetX = W / 2;
        targetY = H / 2;
        enemies: Enemy[] = [];
        bulletPool: Bullet[] = [];
        enemyShots: EnemyShot[] = [];
        gems: Gem[] = [];
        dangerZones: DangerZone[] = [];
        fireTimer = 0;
        spawnTimer = 0;
        hazardTimer = 6.5;
        waveIndex = 1;
        spawnedThisWave = 0;
        waveQuota = 14;
        over = false;
        pausedForDraft = false;
        // 升级倍率（由 upgrade 事件实时修改）
        atkInterval = 0.62;
        bulletDamage = 30;
        seekRange = 420;
        multishot = 1;
        moveSpeed = 210;
        auraLevel = 0;
        orbitLevel = 0;
        magnetRadius = 120;
        prismVolley = false;
        solarAura = false;
        orbitSaw = false;
        upgradeStacks: Record<SurvivorUpgradeKind, number> = { attackSpeed: 0, damage: 0, range: 0, multishot: 0, moveSpeed: 0, aura: 0, orbit: 0, magnet: 0 };
        playerHp = 220;
        hurtCooldown = 0;
        focus = 0;
        overdriveTimer = 0;
        dashCooldown = 0;
        dashInvuln = 0;
        dashKeyDown = false;
        quizHealBonus = 0;
        dashCooldownScale = 1;
        coinBonus = 0;
        novaDamageBonus = 0;
        overdriveBonus = 0;
        guardCharges = 0;
        xpMultiplier = 1;
        heroLevel = 1;
        xp = 0;
        xpGoal = 36;
        orbitBlades: any[] = [];
        keys?: any;
        debugStamp = 0;

        constructor() { super("SurvivorScene"); }

        preload() {
          this.load.image("survivorHero", "/assets/kenney-dungeon/tile_0109.png");
          this.load.image("survivorHeroAlt", "/assets/kenney-dungeon/tile_0084.png");
          this.load.image("dungeonFloor", "/assets/kenney-dungeon/tile_0000.png");
          this.load.image("xpCrystal", "/assets/kenney-tower-defense/towerDefense_tile134.png");
          this.load.image("coinChip", "/assets/kenney-boardgame/chipGreenWhite.png");
          this.load.image("survivorBullet", "/assets/kenney-topdown-tanks/bulletYellowSilver.png");
          this.load.image("survivorBulletRed", "/assets/kenney-topdown-tanks/bulletRedSilver.png");
          this.load.image("survivorSmoke", "/assets/kenney-topdown-tanks/smokeOrange3.png");
          this.load.spritesheet("survivorExplosion", "/assets/game-fx/pixel-explosion.png", { frameWidth: 80, frameHeight: 80 });
          for (const id of monsterIds) {
            monsterFrameKeys(id).forEach((key, index) => {
              this.load.image(key, `/assets/monster-enemies/monster-${id}-run-${String(index).padStart(3, "0")}.png`);
            });
            this.load.image(`survivorMonster${id}Die`, `/assets/monster-enemies/monster-${id}-die.png`);
          }
        }

        create() {
          this.cameras.main.setBackgroundColor("rgba(6,10,26,0)");
          this.cameras.main.setBounds(0, 0, W, H);
          this.cameras.main.roundPixels = true;
          for (const id of monsterIds) {
            const animKey = `survivorMonster${id}Run`;
            if (!this.anims.exists(animKey)) {
              this.anims.create({
                key: animKey,
                frames: monsterFrameKeys(id).map((key) => ({ key })),
                frameRate: 10,
                repeat: -1,
              });
            }
          }
          if (!this.anims.exists("survivorExplosionBoom")) {
            this.anims.create({
              key: "survivorExplosionBoom",
              frames: this.anims.generateFrameNumbers("survivorExplosion", { start: 0, end: 11 }),
              frameRate: 24,
              repeat: 0,
            });
          }

          // 像素地牢竞技场
          const g = this.add.graphics();
          g.fillStyle(0x091223, 0.94).fillRoundedRect(24, 22, W - 48, H - 44, 28);
          g.lineStyle(2, 0xff6d9a, 0.22).strokeRoundedRect(24, 22, W - 48, H - 44, 28);
          for (let x = 54; x < W - 54; x += 42) {
            for (let y = 54; y < H - 54; y += 42) {
              const tile = this.add.image(x, y, "dungeonFloor").setDisplaySize(42, 42).setAlpha((x + y) % 84 === 0 ? 0.24 : 0.14);
              tile.setTint((x + y) % 126 === 0 ? 0x5e456f : 0x31405b);
            }
          }
          g.lineStyle(1, 0xffffff, 0.055);
          for (let x = 52; x <= W - 52; x += 42) g.lineBetween(x, 42, x, H - 42);
          for (let y = 52; y <= H - 52; y += 42) g.lineBetween(42, y, W - 42, y);
          g.lineStyle(1, 0x63d7ff, 0.055);
          for (let offset = -2; offset <= 2; offset += 1) {
            g.lineBetween(W / 2 - 104, H / 2 + offset * 18, W / 2 + 104, H / 2 + offset * 18);
          }
          g.lineStyle(1, 0xffd45f, 0.07).strokeRoundedRect(W / 2 - 102, H / 2 - 48, 204, 96, 14);

          // 玩家
          this.player = this.add.container(W / 2, H / 2);
          this.playerShadow = this.add.ellipse(0, 20, 54, 16, 0x020611, 0.42);
          this.auraRing = this.add.circle(0, 0, 48, 0xff6d9a, 0.06).setStrokeStyle(2, 0xff6d9a, 0.22);
          const hero = this.add.image(0, -10, "survivorHero").setDisplaySize(58, 58);
          const halo = this.add.circle(0, -10, 32, 0xffd45f, 0.06).setStrokeStyle(2, 0xffd45f, 0.48);
          halo.setBlendMode(Phaser.BlendModes.ADD);
          this.levelText = this.add.text(0, -54, "Lv.1", {
            fontFamily: "SFMono-Regular, Consolas, monospace",
            fontSize: "12px",
            color: "#ffd45f",
            fontStyle: "900",
            stroke: "#071124",
            strokeThickness: 4,
          }).setOrigin(0.5);
          this.player.add([this.auraRing, this.playerShadow, halo, hero, this.levelText]);
          this.tweens.add({ targets: halo, scale: 1.16, alpha: 0.14, yoyo: true, repeat: -1, duration: 760, ease: "Sine.easeInOut" });
          this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

          // 子弹对象池
          for (let i = 0; i < 140; i += 1) {
            const b = this.add.image(-50, -50, "survivorBullet").setDisplaySize(24, 10).setVisible(false);
            b.setBlendMode(Phaser.BlendModes.ADD);
            this.bulletPool.push({ obj: b, vx: 0, vy: 0, active: false, damage: 0, pierce: 1 });
          }

          // 点击/拖动移动
          const setTargetFromPointer = (p: any) => {
            const worldX = typeof p.worldX === "number" ? p.worldX : this.cameras.main.scrollX + p.x;
            const worldY = typeof p.worldY === "number" ? p.worldY : this.cameras.main.scrollY + p.y;
            this.targetX = Phaser.Math.Clamp(worldX, 48, W - 48);
            this.targetY = Phaser.Math.Clamp(worldY, 48, H - 48);
          };
          this.input.on("pointerdown", setTargetFromPointer);
          this.input.on("pointermove", (p: any) => { if (p.isDown) setTargetFromPointer(p); });

          this.keys = this.input.keyboard?.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE");

          // 升级事件
          const upHandler = (event: Event) => {
            const kind = (event as CustomEvent<{ kind: SurvivorUpgradeKind }>).detail?.kind;
            if (!kind) return;
            this.upgradeStacks[kind] += 1;
            if (kind === "attackSpeed") this.atkInterval = Math.max(0.12, this.atkInterval * 0.82);
            else if (kind === "damage") this.bulletDamage += 14;
            else if (kind === "range") this.seekRange += 70;
            else if (kind === "multishot") this.multishot = Math.min(7, this.multishot + 1);
            else if (kind === "moveSpeed") this.moveSpeed += 45;
            else if (kind === "aura") {
              this.auraLevel += 1;
              this.auraRing?.setRadius(48 + this.auraLevel * 20).setAlpha(0.07 + this.auraLevel * 0.025);
            } else if (kind === "orbit") {
              this.orbitLevel += 1;
              this.refreshOrbitBlades();
            } else if (kind === "magnet") this.magnetRadius += 95;
            this.checkWeaponEvolution();
            this.showFloat(this.player?.x ?? W / 2, (this.player?.y ?? H / 2) - 72, "UPGRADE", 0xffd45f);
          };
          const resumeHandler = () => {
            this.pausedForDraft = false;
            this.showBanner(`Wave ${this.waveIndex}`, "Upgrade locked in");
          };
          const relicHandler = (event: Event) => {
            const kind = (event as CustomEvent<{ kind: SurvivorRelicKind }>).detail?.kind;
            if (kind === "quizForge") this.quizHealBonus += 10;
            else if (kind === "dashTalisman") this.dashCooldownScale = Math.max(0.52, this.dashCooldownScale * 0.82);
            else if (kind === "goldMagnet") {
              this.coinBonus += 4;
              this.magnetRadius += 70;
            } else if (kind === "novaCore") {
              this.novaDamageBonus += 58;
              this.overdriveBonus += 1.2;
            } else if (kind === "guardianShell") this.guardCharges += 1;
            else if (kind === "xpBloom") this.xpMultiplier += 0.14;
            this.showFloat(this.player?.x ?? W / 2, (this.player?.y ?? H / 2) - 96, "RELIC", 0x67ffd4);
          };
          window.addEventListener("intoplay:survivor-upgrade", upHandler);
          window.addEventListener("intoplay:survivor-relic", relicHandler);
          window.addEventListener("intoplay:survivor-resume", resumeHandler);
          const dashHandler = () => this.dash();
          window.addEventListener("intoplay:survivor-dash", dashHandler);
          const rallyHandler = (event: Event) => {
            const correct = Boolean((event as CustomEvent<{ correct: boolean }>).detail?.correct);
            const streak = Math.max(1, (event as CustomEvent<{ streak?: number }>).detail?.streak ?? 1);
            if (correct) {
              this.quizPulse(streak);
              this.gainFocus();
            } else this.quizPressure();
          };
          window.addEventListener("intoplay:survivor-rally", rallyHandler);
          this.events.once("shutdown", () => {
            window.removeEventListener("intoplay:survivor-upgrade", upHandler);
            window.removeEventListener("intoplay:survivor-relic", relicHandler);
            window.removeEventListener("intoplay:survivor-resume", resumeHandler);
            window.removeEventListener("intoplay:survivor-dash", dashHandler);
            window.removeEventListener("intoplay:survivor-rally", rallyHandler);
          });
          this.spawnTimer = 0.6;
          this.waveQuota = this.quotaForWave(1);
          this.showBanner("Wave 1", "Move, survive, collect crystals");
        }

        quotaForWave(wave: number) {
          return wave === TOTAL_WAVES ? 42 : 10 + wave * 4;
        }

        showBanner(title: string, subtitle: string) {
          const banner = this.add.container(VIEW_W / 2, 62).setDepth(40000).setAlpha(0).setScrollFactor(0);
          const shell = this.add.rectangle(0, 0, 430, 56, 0x071124, 0.82)
            .setStrokeStyle(1, 0xff6d9a, 0.5);
          const titleText = this.add.text(0, -12, title, {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "24px",
            color: "#f7fbff",
            fontStyle: "900",
          }).setOrigin(0.5);
          const subText = this.add.text(0, 15, subtitle, {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "12px",
            color: "#ffd45f",
            fontStyle: "800",
          }).setOrigin(0.5);
          banner.add([shell, titleText, subText]);
          this.tweens.add({ targets: banner, y: 74, alpha: 1, duration: 220, ease: "Quad.easeOut" });
          this.time.delayedCall(1180, () => {
            this.tweens.add({ targets: banner, y: 56, alpha: 0, duration: 260, ease: "Quad.easeIn", onComplete: () => banner.destroy() });
          });
        }

        showFloat(x: number, y: number, label: string, color = 0xf7fbff) {
          const text = this.add.text(x, y, label, {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "18px",
            color: `#${color.toString(16).padStart(6, "0")}`,
            fontStyle: "900",
            stroke: "#071124",
            strokeThickness: 4,
          }).setOrigin(0.5).setDepth(30000);
          this.tweens.add({ targets: text, y: y - 34, alpha: 0, scale: 1.12, duration: 540, ease: "Quad.easeOut", onComplete: () => text.destroy() });
        }

        quizPulse(streak = 1) {
          if (!this.player) return;
          const x = this.player.x;
          const y = this.player.y;
          const healed = Math.min(220, this.playerHp + 24 + this.quizHealBonus) - this.playerHp;
          if (healed > 0) {
            this.playerHp += healed;
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "heal", hp: Math.round(this.playerHp), amount: Math.round(healed), source: "quiz" } }));
          }
          const ring = this.add.circle(x, y, 34, 0x63d7ff, 0.1).setStrokeStyle(4, 0x9dff6a, 0.66).setDepth(50000);
          ring.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: ring, radius: 280, alpha: 0, duration: 360, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
          this.showFloat(x, y - 84, healed > 0 ? `QUIZ BURST +${Math.round(healed)}HP` : "QUIZ BURST", 0x9dff6a);
          this.cameras.main.shake(90, moodFx.shake * 0.7);
          for (let i = this.enemyShots.length - 1; i >= 0; i -= 1) {
            const shot = this.enemyShots[i];
            if (Phaser.Math.Distance.Between(x, y, shot.obj.x, shot.obj.y) < 310) {
              this.playExplosion(shot.obj.x, shot.obj.y, 0.42);
              shot.obj.destroy();
              this.enemyShots.splice(i, 1);
            }
          }
          for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
            const e = this.enemies[i];
            const d = Phaser.Math.Distance.Between(x, y, e.obj.x, e.obj.y);
            if (d < 270) {
              const pulseBonus = this.quizHealBonus * 3.2;
              this.applyEnemyDamage(e, e.boss ? 80 + pulseBonus * 0.5 : e.elite ? 110 + pulseBonus * 0.72 : 135 + pulseBonus);
              const awayX = e.obj.x - x;
              const awayY = e.obj.y - y;
              const len = Math.hypot(awayX, awayY) || 1;
              e.obj.x += (awayX / len) * 28;
              e.obj.y += (awayY / len) * 28;
              if (e.hp <= 0) this.killEnemy(i);
            }
          }
          const collected = this.collectRallyDrops(x, y, 300 + Math.min(190, this.magnetRadius * 0.55));
          const insightXp = 7 + Math.min(4, streak) * 3;
          const insight = this.gainXp(insightXp, 0);
          this.showFloat(x + 54, y - 50, `INSIGHT +${insight.xp}XP`, 0x67ffd4);
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", {
            detail: {
              type: "rallyCollect",
              gems: collected.gems,
              xp: collected.xp + insight.xp,
              coin: collected.coin,
              streak,
            },
          }));
        }

        gainFocus() {
          this.focus = Math.min(3, this.focus + 1);
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "focus", focus: this.focus } }));
          if (this.focus >= 3) this.triggerNova();
        }

        triggerNova() {
          if (!this.player) return;
          this.focus = 0;
          this.overdriveTimer = 8 + this.overdriveBonus;
          const x = this.player.x;
          const y = this.player.y;
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "focus", focus: 0, nova: true, duration: this.overdriveTimer } }));
          this.showBanner("Knowledge Nova", "Overdrive weapon build online");
          const ring = this.add.circle(x, y, 42, 0xffd45f, 0.13).setStrokeStyle(6, 0xffd45f, 0.82).setDepth(52000);
          ring.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: ring, radius: Math.max(W, H) * 0.72, alpha: 0, duration: 620, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });
          this.showFloat(x, y - 118, "KNOWLEDGE NOVA", 0xffd45f);
          this.cameras.main.flash(160, 255, 212, 95, false);
          this.cameras.main.shake(170, moodFx.shake * 0.95);
          for (let i = this.enemyShots.length - 1; i >= 0; i -= 1) {
            const shot = this.enemyShots[i];
            this.playExplosion(shot.obj.x, shot.obj.y, 0.38);
            shot.obj.destroy();
            this.enemyShots.splice(i, 1);
          }
          for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
            const e = this.enemies[i];
            this.applyEnemyDamage(e, e.boss ? 170 + this.novaDamageBonus : e.elite ? 230 + this.novaDamageBonus * 1.2 : 260 + this.novaDamageBonus * 1.45);
            const awayX = e.obj.x - x;
            const awayY = e.obj.y - y;
            const len = Math.hypot(awayX, awayY) || 1;
            e.obj.x += (awayX / len) * 52;
            e.obj.y += (awayY / len) * 52;
            if (e.hp <= 0) this.killEnemy(i);
          }
          const healed = Math.min(220, this.playerHp + 36) - this.playerHp;
          if (healed > 0) {
            this.playerHp += healed;
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "heal", hp: Math.round(this.playerHp), amount: Math.round(healed), source: "nova" } }));
          }
        }

        quizPressure() {
          if (!this.player) return;
          this.focus = Math.max(0, this.focus - 1);
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "focus", focus: this.focus } }));
          this.showFloat(this.player.x, this.player.y - 84, "NO BURST", 0xff6d9a);
          this.cameras.main.shake(90, moodFx.shake * 0.5);
        }

        dash(keyX = 0, keyY = 0) {
          if (!this.player || this.dashCooldown > 0) return;
          let dx = keyX;
          let dy = keyY;
          if (!dx && !dy) {
            dx = this.targetX - this.player.x;
            dy = this.targetY - this.player.y;
          }
          if (!dx && !dy) dx = 1;
          const len = Math.hypot(dx, dy) || 1;
          const dashDistance = 132;
          const fromX = this.player.x;
          const fromY = this.player.y;
          const toX = Phaser.Math.Clamp(this.player.x + (dx / len) * dashDistance, 48, W - 48);
          const toY = Phaser.Math.Clamp(this.player.y + (dy / len) * dashDistance, 48, H - 48);
          this.dashCooldown = 3.2 * this.dashCooldownScale;
          this.dashInvuln = 0.48;
          this.hurtCooldown = Math.max(this.hurtCooldown, 0.5);
          this.targetX = toX;
          this.targetY = toY;
          const trail = this.add.graphics().setDepth(48000);
          trail.lineStyle(8, 0x63d7ff, 0.34);
          trail.lineBetween(fromX, fromY, toX, toY);
          this.tweens.add({ targets: trail, alpha: 0, duration: 280, ease: "Quad.easeOut", onComplete: () => trail.destroy() });
          this.player.setPosition(toX, toY);
          this.playExplosion(fromX, fromY, 0.42);
          this.showFloat(toX, toY - 64, "DASH", 0x63d7ff);
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "dash", cooldown: this.dashCooldown } }));
        }

        playExplosion(x: number, y: number, scale = 0.82) {
          const boom = this.add.sprite(x, y, "survivorExplosion").setScale(scale).setDepth(y + 120);
          boom.setBlendMode(Phaser.BlendModes.ADD);
          boom.play("survivorExplosionBoom");
          boom.once("animationcomplete", () => boom.destroy());
        }

        syncBossHealth(e: Enemy, visible = true) {
          if (!e.boss) return;
          const hpPct = Math.max(0, Math.round((e.hp / Math.max(1, e.hpMax)) * 100));
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "bossHp", visible, hpPct, phase: e.phase } }));
        }

        enterBossPhase(e: Enemy, phase: number) {
          e.phase = phase;
          e.shotEvery = phase >= 3 ? 0.48 : 0.62;
          e.skillTimer = 0.55;
          e.speed += phase >= 3 ? 18 : 10;
          (e.body as any)?.setTint?.(phase >= 3 ? 0xff3d6e : 0xffb15f);
          this.cameras.main.flash(180, 255, phase >= 3 ? 61 : 177, phase >= 3 ? 110 : 95, false);
          this.cameras.main.shake(180, moodFx.shake * (phase >= 3 ? 1.08 : 0.8));
          this.showBanner(`Boss Phase ${phase}`, phase >= 3 ? "Final rage pattern" : "Bullet pattern shifted");
          this.telegraphBurst(e.obj.x, e.obj.y - 10, phase >= 3 ? 22 : 16, phase >= 3 ? "FINAL RING" : "PHASE SHIFT", phase >= 3 ? 0xff3d6e : 0xff8f3d);
          this.time.delayedCall(360, () => this.spawnDangerZone());
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "bossPhase", phase } }));
        }

        applyEnemyDamage(e: Enemy, damage: number) {
          e.hp -= damage;
          (e.obj as any).hpFill?.setScale(Math.max(0, e.hp / e.hpMax), 1);
          if (e.boss) {
            const pct = e.hp / Math.max(1, e.hpMax);
            const nextPhase = pct <= 0.34 ? 3 : pct <= 0.67 ? 2 : 1;
            if (nextPhase > e.phase) this.enterBossPhase(e, nextPhase);
            this.syncBossHealth(e);
          }
        }

        checkWeaponEvolution() {
          if (!this.prismVolley && this.upgradeStacks.damage >= 2 && this.upgradeStacks.multishot >= 2) {
            this.prismVolley = true;
            this.bulletDamage += 16;
            this.multishot = Math.max(this.multishot, 4);
            this.showBanner("Weapon evolved", "Prism Volley online");
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "weaponEvolved", label: "Prism Volley" } }));
          }
          if (!this.solarAura && this.upgradeStacks.aura >= 2) {
            this.solarAura = true;
            this.auraRing?.setStrokeStyle(3, 0x67ffd4, 0.56).setAlpha(0.14);
            this.showBanner("Weapon evolved", "Solar Aura online");
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "weaponEvolved", label: "Solar Aura" } }));
          }
          if (!this.orbitSaw && this.upgradeStacks.orbit >= 2) {
            this.orbitSaw = true;
            this.refreshOrbitBlades();
            this.showBanner("Weapon evolved", "Orbit Saw online");
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "weaponEvolved", label: "Orbit Saw" } }));
          }
        }

        fireRadialShots(x: number, y: number, count: number, speed: number, damage: number) {
          for (let i = 0; i < count; i += 1) {
            const angle = (Math.PI * 2 * i) / count;
            const shot = this.add.image(x, y, "survivorBulletRed").setDisplaySize(26, 13).setDepth(y + 260);
            shot.setBlendMode(Phaser.BlendModes.ADD);
            shot.rotation = angle;
            this.enemyShots.push({
              obj: shot,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              damage,
              age: 0,
            });
          }
        }

        telegraphBurst(x: number, y: number, count: number, label: string, color = 0xff6d9a) {
          const ring = this.add.circle(x, y, 34, color, 0.06).setStrokeStyle(4, color, 0.72).setDepth(51000);
          ring.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: ring, radius: 170, alpha: 0.18, duration: 360, ease: "Quad.easeOut" });
          this.showFloat(x, y - 88, label, color);
          this.time.delayedCall(420, () => {
            if (this.over) return;
            this.fireRadialShots(x, y, count, 185 + this.waveIndex * 6, label.includes("BOSS") ? 14 : 10);
            this.playExplosion(x, y, label.includes("BOSS") ? 0.9 : 0.62);
            ring.destroy();
          });
        }

        spawnDangerZone() {
          if (!this.player || this.dangerZones.length >= 4) return;
          const radius = this.waveIndex >= TOTAL_WAVES ? 96 : this.waveIndex >= 8 ? 82 : 68;
          const x = Phaser.Math.Clamp(this.player.x + Phaser.Math.Between(-90, 90), 72, W - 72);
          const y = Phaser.Math.Clamp(this.player.y + Phaser.Math.Between(-70, 70), 72, H - 72);
          const zone = this.add.circle(x, y, radius, 0xff6d9a, 0.085).setStrokeStyle(3, 0xff6d9a, 0.66).setDepth(47000);
          zone.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: zone, scale: 1.12, alpha: 0.22, yoyo: true, repeat: -1, duration: 260, ease: "Sine.easeInOut" });
          this.dangerZones.push({ obj: zone, x, y, radius, timer: 1.12, damage: this.waveIndex >= TOTAL_WAVES ? 26 : 17 + Math.floor(this.waveIndex / 2) });
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "arenaEvent", label: this.waveIndex >= TOTAL_WAVES ? "Boss 陨星" : "腐化预警圈" } }));
        }

        updateDangerZones(dt: number) {
          for (let i = this.dangerZones.length - 1; i >= 0; i -= 1) {
            const zone = this.dangerZones[i];
            zone.timer -= dt;
            if (zone.timer > 0) continue;
            const d = this.player ? Phaser.Math.Distance.Between(this.player.x, this.player.y, zone.x, zone.y) : 9999;
            this.playExplosion(zone.x, zone.y, this.waveIndex >= TOTAL_WAVES ? 1.05 : 0.78);
            if (this.waveIndex >= 7) this.fireRadialShots(zone.x, zone.y, this.waveIndex >= TOTAL_WAVES ? 12 : 8, 170 + this.waveIndex * 5, 9 + Math.floor(this.waveIndex / 3));
            if (this.player && d < zone.radius && this.hurtCooldown <= 0 && this.dashInvuln <= 0) {
              if (!this.tryGuard(zone.x, zone.y)) {
                this.playerHp -= zone.damage;
                this.hurtCooldown = 0.42;
                window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "hurt", hp: Math.max(0, Math.round(this.playerHp)) } }));
                this.cameras.main.shake(120, moodFx.shake * 0.65);
              }
              if (this.playerHp <= 0) { this.finish(false); return; }
            } else if (this.player && d < zone.radius && this.dashInvuln > 0) {
              this.showFloat(this.player.x, this.player.y - 78, "EVADE", 0x63d7ff);
            }
            zone.obj.destroy();
            this.dangerZones.splice(i, 1);
          }
        }

        chooseDraft() {
          const shuffled = [...upgradeKinds].sort(() => Math.random() - 0.5);
          return shuffled.slice(0, 3);
        }

        chooseRelics() {
          const shuffled = [...relicKinds].sort(() => Math.random() - 0.5);
          return shuffled.slice(0, 3);
        }

        tryGuard(sourceX: number, sourceY: number) {
          if (!this.player || this.guardCharges <= 0) return false;
          this.guardCharges -= 1;
          this.hurtCooldown = Math.max(this.hurtCooldown, 0.45);
          const ring = this.add.circle(this.player.x, this.player.y, 28, 0x67ffd4, 0.1).setStrokeStyle(5, 0x67ffd4, 0.72).setDepth(52000);
          ring.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: ring, radius: 118, alpha: 0, duration: 320, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
          this.showFloat(this.player.x, this.player.y - 86, "GUARD", 0x67ffd4);
          this.playExplosion(sourceX, sourceY, 0.5);
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "guard", charges: this.guardCharges } }));
          return true;
        }

        refreshOrbitBlades() {
          const desired = Math.min(6, this.orbitLevel + 1);
          while (this.orbitBlades.length < desired) {
            const blade = this.add.image(this.player?.x ?? W / 2, this.player?.y ?? H / 2, "survivorBulletRed").setDisplaySize(34, 13).setDepth(45000);
            blade.setBlendMode(Phaser.BlendModes.ADD);
            this.orbitBlades.push(blade);
          }
        }

        enemySafeMargin(e: Enemy) {
          return e.boss ? 126 : e.elite ? 96 : 76;
        }

        spawnEnemy(forceKind?: "grunt" | "runner" | "brute" | "caster" | "elite" | "boss") {
          if (this.enemies.length >= MAX_ENEMIES) return;
          // 从当前镜头外缘刷入，形成成熟幸存者类游戏的持续包围感。
          const cam = this.cameras.main;
          const viewLeft = cam.scrollX;
          const viewTop = cam.scrollY;
          const viewRight = viewLeft + VIEW_W;
          const viewBottom = viewTop + VIEW_H;
          const spawnPad = 34;
          const edge = Phaser.Math.Between(0, 3);
          let x = 0, y = 0;
          if (edge === 0) { x = Phaser.Math.Between(viewLeft, viewRight); y = viewTop - spawnPad; }
          else if (edge === 1) { x = viewRight + spawnPad; y = Phaser.Math.Between(viewTop, viewBottom); }
          else if (edge === 2) { x = Phaser.Math.Between(viewLeft, viewRight); y = viewBottom + spawnPad; }
          else { x = viewLeft - spawnPad; y = Phaser.Math.Between(viewTop, viewBottom); }
          x = Phaser.Math.Clamp(x, -spawnPad, W + spawnPad);
          y = Phaser.Math.Clamp(y, -spawnPad, H + spawnPad);
          const wave = this.waveIndex;
          const kind = forceKind
            ?? (wave === TOTAL_WAVES && this.spawnedThisWave === 0 ? "boss"
              : (wave % 3 === 0 && this.spawnedThisWave === Math.floor(this.waveQuota / 2)) ? "elite"
              : wave >= 3 && Phaser.Math.Between(0, 10) > 8 ? "caster"
              : Phaser.Math.Between(0, 10) > 7 ? "runner" : Phaser.Math.Between(0, 10) > 7 ? "brute" : "grunt");
          const config = {
            grunt: { id: 1, hp: 50 + wave * 10, speed: 50 + wave * 2.5, scale: 0.2, damage: 8 + Math.min(5, Math.floor(wave / 3)), tint: 0xbfe0c8, xp: 9, coin: 0, ranged: false, shotEvery: 0 },
            runner: { id: 7, hp: 38 + wave * 8, speed: 86 + wave * 3, scale: 0.17, damage: 7 + Math.min(5, Math.floor(wave / 3)), tint: 0x63d7ff, xp: 8, coin: 0, ranged: false, shotEvery: 0 },
            brute: { id: 9, hp: 116 + wave * 18, speed: 38 + wave * 1.8, scale: 0.24, damage: 14 + Math.min(7, Math.floor(wave / 2)), tint: 0xffd45f, xp: 18, coin: 4, ranged: false, shotEvery: 0 },
            caster: { id: 7, hp: 78 + wave * 13, speed: 44 + wave * 1.7, scale: 0.2, damage: 12 + Math.min(6, Math.floor(wave / 2)), tint: 0xa76bff, xp: 20, coin: 8, ranged: true, shotEvery: Math.max(0.9, 1.65 - wave * 0.045) },
            elite: { id: 9, hp: 280 + wave * 28, speed: 46 + wave * 2.1, scale: 0.31, damage: 22, tint: 0xff6d9a, xp: 46, coin: 22, ranged: wave >= 6, shotEvery: 1.3 },
            boss: { id: 9, hp: 880, speed: 34, scale: 0.46, damage: 32, tint: 0xff8f3d, xp: 120, coin: 80, ranged: true, shotEvery: 0.82 },
          }[kind];
          const cont = this.add.container(x, y);
          const shadow = this.add.ellipse(0, 30, kind === "boss" ? 120 : kind === "elite" ? 88 : 60, 18, 0x020611, 0.42);
          const body = this.add.sprite(0, -10, monsterFrameKeys(config.id)[0]).setScale(config.scale).setFlipX(true).setTint(config.tint);
          body.play(`survivorMonster${config.id}Run`);
          const hpBack = this.add.rectangle(0, kind === "boss" ? -92 : -58, kind === "boss" ? 108 : 52, 6, 0x071124, 0.84);
          const hpFill = this.add.rectangle(-(kind === "boss" ? 54 : 26), kind === "boss" ? -92 : -58, kind === "boss" ? 108 : 52, 6, kind === "boss" ? 0xff8f3d : kind === "elite" ? 0xff6d9a : 0xffd45f, 0.95).setOrigin(0, 0.5);
          const tag = this.add.text(0, kind === "boss" ? -112 : -72, kind === "boss" ? "BOSS" : kind === "elite" ? "ELITE" : "", {
            fontFamily: "SFMono-Regular, Consolas, monospace",
            fontSize: kind === "boss" ? "14px" : "10px",
            color: kind === "boss" ? "#ffb15f" : "#ff6d9a",
            fontStyle: "900",
            stroke: "#071124",
            strokeThickness: 4,
          }).setOrigin(0.5);
          cont.add([shadow, body, hpBack, hpFill, tag]);
          (cont as any).hpFill = hpFill;
          (cont as any).body = body;
          const hpBase = config.hp;
          this.tweens.add({ targets: body, y: -6, yoyo: true, repeat: -1, duration: kind === "runner" ? 260 : 420 });
          if (kind === "caster") window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "ranged" } }));
          if (kind === "elite") window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "elite" } }));
          if (kind === "boss") window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "boss" } }));
          const enemy: Enemy = {
            obj: cont,
            body,
            hp: hpBase,
            hpMax: hpBase,
            speed: config.speed,
            damage: config.damage,
            elite: kind === "elite",
            boss: kind === "boss",
            ranged: config.ranged,
            entered: false,
            shotTimer: config.shotEvery || 0,
            shotEvery: config.shotEvery || 0,
            skillTimer: kind === "boss" ? 2.6 : kind === "elite" && wave >= 6 ? 3.8 : 0,
            phase: 1,
            xp: config.xp,
            coin: config.coin,
          };
          this.enemies.push(enemy);
          if (kind === "boss") this.syncBossHealth(enemy);
        }

        fireEnemyShot(e: Enemy) {
          if (!this.player) return;
          const angle = Math.atan2(this.player.y - e.obj.y, this.player.x - e.obj.x);
          const shot = this.add.image(e.obj.x, e.obj.y - 10, "survivorBulletRed").setDisplaySize(e.boss ? 32 : 24, e.boss ? 16 : 12).setDepth(e.obj.y + 260);
          shot.setBlendMode(Phaser.BlendModes.ADD);
          shot.rotation = angle;
          const speed = e.boss ? 230 : e.elite ? 210 : 190;
          this.enemyShots.push({
            obj: shot,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            damage: e.boss ? 18 : e.elite ? 14 : 10,
            age: 0,
          });
        }

        spawnGem(x: number, y: number, value: number, coin: number) {
          const gem = this.add.image(x, y, coin > 0 ? "coinChip" : "xpCrystal").setDisplaySize(coin > 0 ? 24 : 18, coin > 0 ? 24 : 24);
          gem.setDepth(y + 20);
          gem.setBlendMode(Phaser.BlendModes.ADD);
          if (coin <= 0) {
            gem.setTint(0x67ffd4);
            gem.setRotation(Phaser.Math.FloatBetween(-0.32, 0.32));
          }
          this.tweens.add({ targets: gem, y: y - 8, yoyo: true, repeat: -1, duration: 520, ease: "Sine.easeInOut" });
          this.gems.push({ obj: gem, value, coin, age: 0 });
        }

        collectRallyDrops(x: number, y: number, radius: number) {
          const summary = { gems: 0, xp: 0, coin: 0 };
          for (let i = this.gems.length - 1; i >= 0; i -= 1) {
            const gem = this.gems[i];
            const d = Phaser.Math.Distance.Between(x, y, gem.obj.x, gem.obj.y);
            if (d > radius) continue;
            const gained = this.gainXp(gem.value, gem.coin);
            summary.gems += 1;
            summary.xp += gained.xp;
            summary.coin += gained.coin;
            const arc = this.add.graphics().setDepth(49000);
            arc.lineStyle(3, gem.coin > 0 ? 0xffd45f : 0x67ffd4, 0.34);
            arc.lineBetween(gem.obj.x, gem.obj.y, x, y);
            this.tweens.add({ targets: arc, alpha: 0, duration: 220, ease: "Quad.easeOut", onComplete: () => arc.destroy() });
            this.showFloat(gem.obj.x, gem.obj.y - 24, gained.coin > 0 ? `+${gained.coin}` : `+${gained.xp} XP`, gained.coin > 0 ? 0xffd45f : 0x9dff6a);
            gem.obj.destroy();
            this.gems.splice(i, 1);
          }
          return summary;
        }

        fire() {
          if (!this.player) return;
          // 找最近的怪
          let nearest: Enemy | null = null;
          let nearestD = this.seekRange * this.seekRange;
          for (const e of this.enemies) {
            const dx = e.obj.x - this.player.x;
            const dy = e.obj.y - this.player.y;
            const d = dx * dx + dy * dy;
            if (d < nearestD) { nearestD = d; nearest = e; }
          }
          if (!nearest) return;
          const baseAngle = Math.atan2(nearest.obj.y - this.player.y, nearest.obj.x - this.player.x);
          const spread = 0.2;
          for (let i = 0; i < this.multishot; i += 1) {
            const a = baseAngle + (i - (this.multishot - 1) / 2) * spread;
            const b = this.bulletPool.find((x) => !x.active);
            if (!b) break;
            b.active = true;
            b.damage = this.bulletDamage * (this.overdriveTimer > 0 ? 1.55 : 1) * (this.prismVolley ? 1.12 : 1);
            b.pierce = nearest.boss ? (this.prismVolley ? 4 : 2) : this.prismVolley ? 2 : 1;
            b.obj.setVisible(true);
            b.obj.x = this.player.x;
            b.obj.y = this.player.y;
            b.obj.rotation = a;
            b.obj.setTexture(this.bulletDamage >= 58 ? "survivorBulletRed" : "survivorBullet");
            b.obj.setDisplaySize(this.prismVolley ? 32 : 24, this.prismVolley ? 13 : 10);
            if (this.prismVolley) b.obj.setTint(0x67ffd4);
            else b.obj.clearTint?.();
            b.vx = Math.cos(a) * bulletSpeed;
            b.vy = Math.sin(a) * bulletSpeed;
          }
        }

        killEnemy(index: number) {
          const e = this.enemies[index];
          this.spawnGem(e.obj.x, e.obj.y, e.xp, e.coin);
          this.playExplosion(e.obj.x, e.obj.y - 8, e.boss ? 1.25 : e.elite ? 0.95 : 0.62);
          this.tweens.add({ targets: e.obj, alpha: 0, scale: 0.2, duration: 180, onComplete: () => e.obj.destroy() });
          this.enemies.splice(index, 1);
          if (e.boss) this.syncBossHealth(e, false);
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "kill", elite: e.elite, boss: e.boss } }));
        }

        gainXp(amount: number, coin: number) {
          const gainedXp = Math.max(1, Math.round(amount * this.xpMultiplier));
          const gainedCoin = coin > 0 ? coin + this.coinBonus : 0;
          this.xp += gainedXp;
          if (gainedCoin > 0) window.dispatchEvent(new CustomEvent("intoplay:survivor-coin", { detail: { amount: gainedCoin } }));
          while (this.xp >= this.xpGoal) {
            this.xp -= this.xpGoal;
            this.heroLevel += 1;
            this.xpGoal = Math.round(this.xpGoal * 1.28 + 18);
            this.levelText?.setText(`Lv.${this.heroLevel}`);
            this.pausedForDraft = true;
            this.showBanner(`Level ${this.heroLevel}`, "Choose one upgrade");
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "draft", level: this.heroLevel, xp: this.xp, xpGoal: this.xpGoal, choices: this.chooseDraft() } }));
            break;
          }
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "xp", xp: this.xp, xpGoal: this.xpGoal, level: this.heroLevel } }));
          return { xp: gainedXp, coin: gainedCoin };
        }

        update(timeMs: number, delta: number) {
          if (this.over || !this.player) return;
          const dt = Math.min(delta / 1000, 0.05);
          if (this.pausedForDraft) return;
          this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
          this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
          const wasDashReady = this.dashCooldown <= 0;
          this.dashCooldown = Math.max(0, this.dashCooldown - dt);
          this.dashInvuln = Math.max(0, this.dashInvuln - dt);
          if (!wasDashReady && this.dashCooldown <= 0) {
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "dashReady" } }));
          }

          if (this.waveIndex >= 4) {
            this.hazardTimer -= dt;
            if (this.hazardTimer <= 0) {
              this.spawnDangerZone();
              this.hazardTimer = Math.max(3.6, 8.8 - this.waveIndex * 0.42);
            }
          }

          // 玩家移动（朝目标点逼近）
          let keyX = 0;
          let keyY = 0;
          if (this.keys) {
            if (this.keys.A?.isDown || this.keys.LEFT?.isDown) keyX -= 1;
            if (this.keys.D?.isDown || this.keys.RIGHT?.isDown) keyX += 1;
            if (this.keys.W?.isDown || this.keys.UP?.isDown) keyY -= 1;
            if (this.keys.S?.isDown || this.keys.DOWN?.isDown) keyY += 1;
            if (this.keys.SPACE?.isDown && !this.dashKeyDown) this.dash(keyX, keyY);
            this.dashKeyDown = Boolean(this.keys.SPACE?.isDown);
          }
          if (keyX || keyY) {
            const kd = Math.hypot(keyX, keyY) || 1;
            this.player.x = Phaser.Math.Clamp(this.player.x + (keyX / kd) * this.moveSpeed * dt, 48, W - 48);
            this.player.y = Phaser.Math.Clamp(this.player.y + (keyY / kd) * this.moveSpeed * dt, 48, H - 48);
            this.targetX = this.player.x;
            this.targetY = this.player.y;
          }
          const pdx = this.targetX - this.player.x;
          const pdy = this.targetY - this.player.y;
          const pd = Math.hypot(pdx, pdy);
          if (pd > 4 && !keyX && !keyY) {
            const step = Math.min(pd, this.moveSpeed * dt);
            this.player.x = Phaser.Math.Clamp(this.player.x + (pdx / pd) * step, 48, W - 48);
            this.player.y = Phaser.Math.Clamp(this.player.y + (pdy / pd) * step, 48, H - 48);
          }

          if (timeMs - this.debugStamp > 180) {
            this.debugStamp = timeMs;
            host?.setAttribute("data-camera-scroll", `${Math.round(this.cameras.main.scrollX)},${Math.round(this.cameras.main.scrollY)}`);
            host?.setAttribute("data-player-world", `${Math.round(this.player.x)},${Math.round(this.player.y)}`);
            host?.setAttribute("data-world-size", `${W},${H}`);
            host?.setAttribute("data-view-size", `${VIEW_W},${VIEW_H}`);
          }

          this.updateDangerZones(dt);
          if (this.over) return;

          // 波次
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0 && this.spawnedThisWave < this.waveQuota) {
            this.spawnEnemy();
            this.spawnedThisWave += 1;
            this.spawnTimer = Math.max(0.18, 0.82 - this.waveIndex * 0.036);
          }
          if (this.spawnedThisWave >= this.waveQuota && this.enemies.length === 0) {
            const clearedWave = this.waveIndex;
            this.waveIndex += 1;
            this.spawnedThisWave = 0;
            if (this.waveIndex > TOTAL_WAVES) { this.finish(true); return; }
            this.waveQuota = this.quotaForWave(this.waveIndex);
            window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "wave", wave: this.waveIndex, quota: this.waveQuota } }));
            if (clearedWave % 3 === 0) {
              const reward = 35 + clearedWave * 7;
              const healed = Math.min(220, this.playerHp + 30 + clearedWave * 2) - this.playerHp;
              if (healed > 0) this.playerHp += healed;
              window.dispatchEvent(new CustomEvent("intoplay:survivor-coin", { detail: { amount: reward } }));
              window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "chest", wave: clearedWave, reward, heal: Math.round(healed), hp: Math.round(this.playerHp) } }));
              if (this.player) {
                this.playExplosion(this.player.x, this.player.y - 20, 0.8);
                this.showFloat(this.player.x, this.player.y - 88, `CHEST +${reward}`, 0xffd45f);
                if (healed > 0) this.showFloat(this.player.x, this.player.y - 116, `SUPPLY +${Math.round(healed)}HP`, 0x9dff6a);
              }
              this.pausedForDraft = true;
              window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "relicDraft", wave: clearedWave, choices: this.chooseRelics() } }));
            }
            this.spawnTimer = 1.2;
            this.showBanner(
              clearedWave % 3 === 0 ? "Relic Cache" : this.waveIndex === TOTAL_WAVES ? "Boss Wave" : `Wave ${this.waveIndex}`,
              clearedWave % 3 === 0 ? `Wave ${clearedWave} clear · choose a build relic` : this.waveIndex % 3 === 0 ? "Elite incoming" : "New swarm pattern"
            );
          }

          // 开火
          this.fireTimer -= dt;
          if (this.fireTimer <= 0) { this.fire(); this.fireTimer = this.atkInterval * (this.overdriveTimer > 0 ? 0.54 : 1); }

          // 子弹移动 + 命中
          for (const b of this.bulletPool) {
            if (!b.active) continue;
            b.obj.x += b.vx * dt;
            b.obj.y += b.vy * dt;
            if (b.obj.x < -30 || b.obj.x > W + 30 || b.obj.y < -30 || b.obj.y > H + 30) {
              b.active = false; b.obj.setVisible(false); continue;
            }
            for (let i = 0; i < this.enemies.length; i += 1) {
              const e = this.enemies[i];
              const dx = e.obj.x - b.obj.x;
              const dy = e.obj.y - b.obj.y;
              if (dx * dx + dy * dy < 22 * 22) {
                this.applyEnemyDamage(e, b.damage);
                const hit = this.add.image(e.obj.x, e.obj.y - 6, "survivorSmoke").setDisplaySize(42, 42).setAlpha(0.72).setDepth(e.obj.y + 60);
                hit.setBlendMode(Phaser.BlendModes.ADD);
                this.tweens.add({ targets: hit, scale: 1.45, alpha: 0, duration: 180, onComplete: () => hit.destroy() });
                b.pierce -= 1;
                if (b.pierce <= 0) { b.active = false; b.obj.setVisible(false); }
                if (e.hp <= 0) { this.killEnemy(i); }
                if (!b.active) break;
              }
            }
          }

          // 敌方弹幕：远程怪和 Boss 迫使玩家走位；答题脉冲可以清掉附近弹幕。
          for (let i = this.enemyShots.length - 1; i >= 0; i -= 1) {
            const shot = this.enemyShots[i];
            shot.age += dt;
            shot.obj.x += shot.vx * dt;
            shot.obj.y += shot.vy * dt;
            shot.obj.rotation = Math.atan2(shot.vy, shot.vx);
            shot.obj.setDepth(shot.obj.y + 260);
            const dx = this.player.x - shot.obj.x;
            const dy = this.player.y - shot.obj.y;
            if (dx * dx + dy * dy < 24 * 24) {
              if (this.hurtCooldown <= 0 && this.dashInvuln <= 0) {
                if (!this.tryGuard(shot.obj.x, shot.obj.y)) {
                  this.playerHp -= shot.damage;
                  this.hurtCooldown = 0.34;
                  window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "hurt", hp: Math.max(0, Math.round(this.playerHp)) } }));
                }
              } else if (this.dashInvuln > 0) {
                this.showFloat(shot.obj.x, shot.obj.y - 18, "EVADE", 0x63d7ff);
              }
              this.playExplosion(shot.obj.x, shot.obj.y, 0.46);
              shot.obj.destroy();
              this.enemyShots.splice(i, 1);
              this.cameras.main.shake(100, moodFx.shake * 0.55);
              if (this.playerHp <= 0) { this.finish(false); return; }
              continue;
            }
            if (shot.age > 4.2 || shot.obj.x < -80 || shot.obj.x > W + 80 || shot.obj.y < -80 || shot.obj.y > H + 80) {
              shot.obj.destroy();
              this.enemyShots.splice(i, 1);
            }
          }

          // 经验/金币掉落：靠近后自动磁吸
          for (let i = this.gems.length - 1; i >= 0; i -= 1) {
            const gem = this.gems[i];
            gem.age += dt;
            const dx = this.player.x - gem.obj.x;
            const dy = this.player.y - gem.obj.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < this.magnetRadius || gem.age > 4.5) {
              const speed = gem.coin > 0 ? 520 : 420;
              gem.obj.x += (dx / d) * speed * dt;
              gem.obj.y += (dy / d) * speed * dt;
            }
            if (d < 24) {
              const gained = this.gainXp(gem.value, gem.coin);
              this.showFloat(gem.obj.x, gem.obj.y - 24, gained.coin > 0 ? `+${gained.coin}` : `+${gained.xp} XP`, gained.coin > 0 ? 0xffd45f : 0x9dff6a);
              gem.obj.destroy();
              this.gems.splice(i, 1);
            }
          }

          // 光环武器：成熟幸存者类常见的近身区域伤害。
          if (this.auraLevel > 0) {
            const radius = (this.solarAura ? 78 : 50) + this.auraLevel * 22;
            for (const e of this.enemies) {
              if (Phaser.Math.Distance.Between(this.player.x, this.player.y, e.obj.x, e.obj.y) < radius) {
                const auraDps = (this.solarAura ? 18 : 10) + this.auraLevel * (this.solarAura ? 8 : 6);
                this.applyEnemyDamage(e, auraDps * dt);
              }
            }
          }

          // 环绕刃武器：让幸存者类“武器构筑”在画面上可见。
          if (this.orbitLevel > 0) {
            const radius = 74 + this.orbitLevel * 12;
            const speed = 0.0036 + this.orbitLevel * 0.00042;
            this.orbitBlades.forEach((blade, index) => {
              const angle = timeMs * speed + index * ((Math.PI * 2) / this.orbitBlades.length);
              blade.x = this.player.x + Math.cos(angle) * radius;
              blade.y = this.player.y + Math.sin(angle) * radius * 0.76;
              blade.rotation = angle + Math.PI / 2;
              blade.setDepth(blade.y + 180);
            });
            for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
              const e = this.enemies[i];
              for (const blade of this.orbitBlades) {
                if (Phaser.Math.Distance.Between(blade.x, blade.y, e.obj.x, e.obj.y) < (e.boss ? 54 : 34)) {
                  this.applyEnemyDamage(e, (46 + this.orbitLevel * (this.orbitSaw ? 24 : 16)) * dt);
                  if (e.hp <= 0) this.killEnemy(i);
                  break;
                }
              }
            }
          }

          // 怪物朝玩家移动 + 撞玩家
          for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
            const e = this.enemies[i];
            if (e.hp <= 0) { this.killEnemy(i); continue; }
            const dx = this.player.x - e.obj.x;
            const dy = this.player.y - e.obj.y;
            const d = Math.hypot(dx, dy) || 1;
            const margin = this.enemySafeMargin(e);
            const entryLeft = Math.max(margin, this.cameras.main.scrollX + margin);
            const entryRight = Math.min(W - margin, this.cameras.main.scrollX + VIEW_W - margin);
            const entryTop = Math.max(margin, this.cameras.main.scrollY + margin);
            const entryBottom = Math.min(H - margin, this.cameras.main.scrollY + VIEW_H - margin);
            const insideEntryView = e.obj.x >= entryLeft && e.obj.x <= entryRight && e.obj.y >= entryTop && e.obj.y <= entryBottom;
            if (!e.entered) {
              const entryX = Phaser.Math.Clamp(e.obj.x, entryLeft, entryRight);
              const entryY = Phaser.Math.Clamp(e.obj.y, entryTop, entryBottom);
              const entryDx = entryX - e.obj.x;
              const entryDy = entryY - e.obj.y;
              const entryD = Math.hypot(entryDx, entryDy);
              if (entryD > 3) {
                const entrySpeed = Math.max(e.speed * 1.55, 120);
                e.obj.x += (entryDx / entryD) * entrySpeed * dt;
                e.obj.y += (entryDy / entryD) * entrySpeed * dt;
              } else {
                e.obj.x = entryX;
                e.obj.y = entryY;
                e.entered = true;
              }
              if (insideEntryView) e.entered = true;
            } else if (e.ranged) {
              e.shotTimer -= dt;
              if (d < 560 && e.shotTimer <= 0) {
                this.fireEnemyShot(e);
                e.shotTimer = e.shotEvery;
                this.showFloat(e.obj.x, e.obj.y - 76, e.boss ? "BARRAGE" : "SPELL", e.boss ? 0xff8f3d : 0xa76bff);
              }
              if (e.skillTimer > 0) {
                e.skillTimer -= dt;
                if (e.skillTimer <= 0) {
                  if (e.boss) {
                    this.telegraphBurst(e.obj.x, e.obj.y - 10, this.waveIndex >= TOTAL_WAVES ? 18 : 14, "BOSS RING", 0xff8f3d);
                    e.skillTimer = 4.4;
                    window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "bossSkill", label: "Boss 环形弹幕" } }));
                  } else if (e.elite) {
                    this.telegraphBurst(e.obj.x, e.obj.y - 8, 8, "ELITE BURST", 0xff6d9a);
                    e.skillTimer = 5.2;
                    window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "arenaEvent", label: "精英爆发" } }));
                  }
                }
              }
              const desiredRange = e.boss ? 230 : e.elite ? 260 : 290;
              if (d > desiredRange) {
                e.obj.x += (dx / d) * e.speed * dt;
                e.obj.y += (dy / d) * e.speed * dt;
              } else if (d < desiredRange * 0.62) {
                e.obj.x -= (dx / d) * e.speed * 0.52 * dt;
                e.obj.y -= (dy / d) * e.speed * 0.52 * dt;
              }
            } else {
              e.obj.x += (dx / d) * e.speed * dt;
              e.obj.y += (dy / d) * e.speed * dt;
            }
            if (e.entered) {
              e.obj.x = Phaser.Math.Clamp(e.obj.x, margin, W - margin);
              e.obj.y = Phaser.Math.Clamp(e.obj.y, margin, H - margin);
            }
            e.obj.setDepth(e.obj.y + 40);
            e.body?.setFlipX(dx < 0);
            if (d < (e.boss ? 48 : e.elite ? 38 : 28) && this.hurtCooldown <= 0 && this.dashInvuln <= 0) {
              const guarded = this.tryGuard(e.obj.x, e.obj.y);
              this.player.x = Phaser.Math.Clamp(this.player.x - (dx / d) * 26, 48, W - 48);
              this.player.y = Phaser.Math.Clamp(this.player.y - (dy / d) * 26, 48, H - 48);
              this.cameras.main.shake(80, moodFx.shake * 0.4);
              if (!guarded) {
                this.playerHp -= e.damage;
                this.hurtCooldown = e.boss ? 0.46 : 0.36;
                window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "hurt", hp: Math.max(0, Math.round(this.playerHp)) } }));
              }
              if (this.playerHp <= 0) { this.finish(false); return; }
            } else if (d < (e.boss ? 48 : e.elite ? 38 : 28) && this.dashInvuln > 0) {
              this.showFloat(this.player.x, this.player.y - 72, "EVADE", 0x63d7ff);
            }
          }
        }

        finish(survived: boolean) {
          this.over = true;
          window.dispatchEvent(new CustomEvent("intoplay:survivor-event", { detail: { type: "end", survived } }));
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: VIEW_W,
        height: VIEW_H,
        transparent: true,
        audio: { noAudio: true },
        scene: SurvivorScene,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      });
    });

    return () => {
      cancelled = true;
      game?.destroy(true);
      if (host) host.innerHTML = "";
    };
  }, [quest.spec.mood, quest.schema]);

  // 场景事件 → 更新 React HUD + proof。
  useEffect(() => {
    const onEvent = (event: Event) => {
      const d = (event as CustomEvent<any>).detail;
      if (!d) return;
      if (d.type === "wave") {
        setWave(d.wave);
        setWaveQuota(d.quota ?? 14);
        setWaveKills(0);
      }
      else if (d.type === "hurt") setHp(d.hp);
      else if (d.type === "heal") {
        setHp(d.hp);
        flashNotice(`知识护盾：+${d.amount} 生命`, 1200);
      }
      else if (d.type === "focus") {
        setFocus(d.focus ?? 0);
        if (d.nova) {
          setNovaActive(true);
          if (novaTimerRef.current) window.clearTimeout(novaTimerRef.current);
          novaTimerRef.current = window.setTimeout(() => setNovaActive(false), (d.duration ?? 8) * 1000);
          flashNotice("Knowledge Nova：过载武器启动", 2200);
          onRuntimeEventRef.current({
            advances: false,
            correct: true,
            choice: "Knowledge Nova",
            feedback: "三次答对触发 Nova，清弹幕并短时提升火力。",
            kind: "hit",
            runtimeStatus: "Nova",
            stageId: "survivor",
            stageTitle: "Survivor",
          });
        }
      }
      else if (d.type === "dash") {
        setDashReady(false);
        flashNotice("Dash：闪避无敌帧", 900);
        onRuntimeEventRef.current({
          advances: false,
          correct: true,
          choice: "Dash",
          feedback: "主动闪避触发，短时间规避弹幕和近战。",
          kind: "guarded",
          runtimeStatus: "Dashed",
          stageId: "survivor",
          stageTitle: "Survivor",
        });
      }
      else if (d.type === "dashReady") {
        setDashReady(true);
      }
      else if (d.type === "xp") {
        setXp(d.xp);
        setXpGoal(d.xpGoal);
        setHeroLevel(d.level);
      } else if (d.type === "draft") {
        setXp(d.xp);
        setXpGoal(d.xpGoal);
        setHeroLevel(d.level);
        setDraftChoices(d.choices);
        flashNotice(`Level ${d.level}：选择一个升级`, 2200);
      } else if (d.type === "relicDraft") {
        setRelicChoices(d.choices);
        flashNotice(`第 ${d.wave} 波遗物：选择一个构筑方向`, 2200);
      } else if (d.type === "guard") {
        flashNotice(`守护甲片触发：剩余 ${d.charges ?? 0}`, 1300);
        onRuntimeEventRef.current({
          advances: false,
          correct: true,
          choice: "守护甲片",
          feedback: "遗物免伤触发，挡下了一次致命压力。",
          kind: "guarded",
          runtimeStatus: "Guarded",
          stageId: "survivor",
          stageTitle: "Survivor",
        });
      } else if (d.type === "elite") {
        flashNotice("精英怪出现：击杀掉更多经验/金币", 1800);
      } else if (d.type === "ranged") {
        flashNotice("施法怪出现：走位躲弹幕，答题可清场", 1800);
      } else if (d.type === "boss") {
        flashNotice("Boss Wave：保持走位，收集经验", 2200);
        flashCombatEvent("Boss 入场", 2800);
      } else if (d.type === "bossHp") {
        setBossHud({ visible: Boolean(d.visible), hpPct: d.hpPct ?? 0, phase: d.phase ?? 1 });
      } else if (d.type === "bossPhase") {
        flashCombatEvent(`Boss Phase ${d.phase}`, 2800);
        flashNotice(`Boss Phase ${d.phase}：弹幕升级`, 1800);
        onRuntimeEventRef.current({
          advances: false,
          correct: true,
          choice: `Boss Phase ${d.phase}`,
          feedback: "Boss 进入新阶段，弹幕和预警圈强度提升。",
          kind: "guarded",
          runtimeStatus: "BossPhase",
          stageId: "survivor",
          stageTitle: "Survivor",
        });
      } else if (d.type === "bossSkill") {
        flashCombatEvent(d.label ?? "Boss 技能", 2600);
        flashNotice(`${d.label ?? "Boss 技能"}：看预警走位`, 1600);
        onRuntimeEventRef.current({
          advances: false,
          correct: true,
          choice: d.label ?? "Boss 技能",
          feedback: "Boss 释放了可预判弹幕，玩家需要走位或 Dash。",
          kind: "guarded",
          runtimeStatus: "BossSkill",
          stageId: "survivor",
          stageTitle: "Survivor",
        });
      } else if (d.type === "arenaEvent") {
        flashCombatEvent(d.label ?? "战场事件", 2200);
        flashNotice(`${d.label ?? "战场事件"}：注意预警圈`, 1400);
      } else if (d.type === "weaponEvolved") {
        flashCombatEvent(d.label ?? "武器进化", 2800);
        flashNotice(`${d.label ?? "武器"} 已进化`, 1800);
        onRuntimeEventRef.current({
          advances: false,
          correct: true,
          choice: d.label ?? "武器进化",
          feedback: "武器组合达到阈值，触发可见进化效果。",
          kind: "hit",
          runtimeStatus: "Evolved",
          stageId: "survivor",
          stageTitle: "Survivor",
        });
      } else if (d.type === "rallyCollect") {
        const pieces = [
          d.gems ? `${d.gems} drops` : "",
          d.xp ? `+${d.xp} XP` : "",
          d.coin ? `+${d.coin} coin` : "",
        ].filter(Boolean).join(" · ");
        flashCombatEvent(pieces ? `Rally ${pieces}` : `Rally x${d.streak ?? 1}`, 1800);
        flashNotice(pieces ? `Rally：${pieces}` : `Rally x${d.streak ?? 1}`, 1000);
        if ((d.gems ?? 0) > 0 || (d.xp ?? 0) >= 10) {
          onRuntimeEventRef.current({
            advances: false,
            correct: true,
            choice: `Rally x${d.streak ?? 1}`,
            feedback: "答题 Rally 吸取掉落并转化为构筑经验。",
            kind: "hit",
            runtimeStatus: "Rally",
            stageId: "survivor",
            stageTitle: "Survivor",
          });
        }
      } else if (d.type === "chest") {
        if (typeof d.hp === "number") setHp(d.hp);
        flashNotice(`第 ${d.wave} 波宝箱：+${d.reward} 金币${d.heal ? ` / +${d.heal} 生命` : ""}`, 1800);
        onRuntimeEventRef.current({
          advances: false,
          correct: true,
          choice: `第${d.wave}波奖励`,
          feedback: `清空第 ${d.wave} 波，获得宝箱金币和补给。`,
          kind: "hit",
          runtimeStatus: "Chest",
          stageId: "survivor",
          stageTitle: "Survivor",
        });
      }
      else if (d.type === "kill") {
        setKills((value) => value + 1);
        setWaveKills((value) => value + 1);
        onRuntimeEventRef.current({
          advances: false, correct: true, choice: d.boss ? "击杀 Boss" : d.elite ? "击杀精英" : "击杀怪物", feedback: d.boss ? "Boss 被击破，知识压力被清空。" : d.elite ? "精英知识缺口被清除，掉落更多经验。" : "一只知识缺口被清除。",
          kind: "hit", runtimeStatus: "Cleared", stageId: "survivor", stageTitle: "Survivor",
        });
      } else if (d.type === "end") {
        onCompleteRef.current(Boolean(d.survived));
      }
    };
    window.addEventListener("intoplay:survivor-event", onEvent);
    return () => {
      window.removeEventListener("intoplay:survivor-event", onEvent);
      if (novaTimerRef.current) window.clearTimeout(novaTimerRef.current);
      if (combatEventTimerRef.current) window.clearTimeout(combatEventTimerRef.current);
    };
  }, [flashCombatEvent]);

  return (
    <div className={`template-play template-survivor mood-${quest.spec.mood}`}>
      <div className="survivor-hud" aria-label="Survivor status">
        <span className="survivor-stat hp">❤ 生命 {Math.max(0, hp)}</span>
        <span className="survivor-stat coins">🪙 金币 {coins}</span>
        <span className="survivor-stat level">Lv.{heroLevel}</span>
        <span className={`survivor-stat focus ${novaActive ? "active" : ""}`}>✦ Nova {novaActive ? "Overdrive" : `${focus}/3`}</span>
        <span className={`survivor-stat dash ${dashReady ? "ready" : ""}`}>⇥ Dash {dashReady ? "Ready" : "CD"}</span>
        <span className="survivor-stat relic">遗物 {relicCount}</span>
        <span className="survivor-stat build">构筑 {evolvedKit}</span>
        <span className="survivor-stat wave">第 {wave}/{survivorTotalWaves} 波</span>
        <span className="survivor-stat kills">☠ 击杀 {kills}</span>
        {notice ? <span className="survivor-notice">{notice}</span> : null}
      </div>
      <div className="survivor-progress-row" aria-label="Survivor progress">
        <div className="survivor-xp">
          <span style={{ width: `${Math.min(100, Math.round((xp / Math.max(1, xpGoal)) * 100))}%` }} />
          <strong>XP {xp}/{xpGoal}</strong>
        </div>
        <div className="survivor-wave-track">
          {Array.from({ length: survivorTotalWaves }, (_, index) => {
            const step = index + 1;
            return (
              <span
                className={`${step < wave || wave > survivorTotalWaves ? "done" : ""} ${step === Math.min(wave, survivorTotalWaves) ? "current" : ""} ${step === survivorTotalWaves ? "boss" : ""}`}
                key={step}
              >
                {step === survivorTotalWaves ? "B" : step}
              </span>
            );
          })}
        </div>
      </div>
      <div className="survivor-arena-shell">
        <div className="survivor-objectives" aria-label="Survivor run rules">
          <span><b>目标</b> 12 波</span>
          <span><b>答题</b> 攒 Nova</span>
          <span><b>闪避</b> Space</span>
          <span><b>奖励</b> 3 波遗物</span>
        </div>
        <div className="survivor-run-strip" aria-label="Current run objective">
          <span className="survivor-run-progress">
            <b>本波</b>
            <i><em style={{ width: `${Math.min(100, Math.round((waveKills / Math.max(1, waveQuota)) * 100))}%` }} /></i>
            <strong>{Math.min(waveKills, waveQuota)}/{waveQuota}</strong>
          </span>
          <span><b>威胁</b><strong>{currentThreat}</strong></span>
          <span><b>事件</b><strong>{combatEvent}</strong></span>
          <span><b>奖励</b><strong>{nextReward}</strong></span>
        </div>
        {bossHud?.visible ? (
          <div className={`survivor-boss-bar phase-${bossHud.phase}`} aria-label="Boss health">
            <span>Boss Phase {bossHud.phase}</span>
            <i><em style={{ width: `${Math.max(0, Math.min(100, bossHud.hpPct))}%` }} /></i>
            <strong>{Math.max(0, Math.min(100, bossHud.hpPct))}%</strong>
          </div>
        ) : null}
        <button
          className={`survivor-dash-button ${dashReady ? "ready" : ""}`}
          disabled={!dashReady || pausedForChoice}
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("intoplay:survivor-dash"))}
        >
          <b>Dash</b>
          <span>{dashReady ? "Ready" : "Cooldown"}</span>
        </button>
        <div className="survivor-board-host" ref={hostRef} aria-label="Survivor arena" />
      </div>
      <AnimatePresence>
        {draftChoices ? (
          <motion.div
            className="survivor-draft"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <span>Level up</span>
            <strong>选择一个升级继续幸存</strong>
            <div>
              {draftChoices.map((kind) => (
                <button key={kind} type="button" onClick={() => pickDraftUpgrade(kind)}>
                  <b>{upgradeLabel[kind]}</b>
                  <em>{upgradeDesc[kind]}</em>
                  <i>Lv.{levels[kind] + 1}</i>
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
        {relicChoices ? (
          <motion.div
            className="survivor-draft survivor-relic"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <span>Relic cache</span>
            <strong>装配一个遗物改变本局构筑</strong>
            <div>
              {relicChoices.map((kind) => (
                <button key={kind} type="button" onClick={() => pickRelic(kind)}>
                  <b>{relicLabel[kind]}</b>
                  <em>{relicDesc[kind]}</em>
                  <i>Stack {relics[kind] + 1}</i>
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="survivor-shop" aria-label="Upgrade shop">
        {(Object.keys(upgradeLabel) as SurvivorUpgradeKind[]).map((kind) => {
          const level = levels[kind];
          const cost = upgradeCost(kind, level);
          return (
            <button
              className={`survivor-shop-item upgrade-${kind} ${coins < cost ? "too-pricey" : ""}`}
              key={kind}
              type="button"
              disabled={pausedForChoice}
              onClick={() => buyUpgrade(kind)}
            >
              <strong>{upgradeLabel[kind]} <em>Lv.{level}</em></strong>
              <span>{upgradeDesc[kind]}</span>
              <i>{cost}🪙</i>
            </button>
          );
        })}
        <span className="survivor-hint">WASD/点击移动 · Space 闪避 · 自动攻击 · 答题回盾/清场/攒 Nova · 每三波遗物构筑</span>
      </div>
    </div>
  );
}

function LaneDefenseStandby({ quest }: { quest: QuestGame }) {
  return (
    <div className="template-play template-lane lane-standby" aria-label="Knowledge defense briefing">
      <div className="lane-standby-stage" aria-hidden="true">
        <span className="lane-standby-core" />
        {Array.from({ length: 5 }, (_, lane) => (
          <i key={lane} style={{ "--lane": lane } as CSSProperties} />
        ))}
        {["Prep", "Build", "Boss"].map((label, index) => (
          <em key={label} style={{ "--x": `${22 + index * 28}%`, "--y": `${28 + index * 14}%` } as CSSProperties}>{label}</em>
        ))}
      </div>
      <div className="lane-standby-copy">
        <span>Recall Defense</span>
        <strong>12-wave playable run</strong>
        <p>{compact(quest.spec.goal, 56)}</p>
      </div>
      <div className="lane-standby-rules">
        <b>答题得能量</b>
        <b>建塔 + 升级</b>
        <b>精英 / Boss 波</b>
        <b>Endless 可选</b>
      </div>
    </div>
  );
}

function SurvivorStandby({ quest }: { quest: QuestGame }) {
  return (
    <div className="template-play template-survivor survivor-standby" aria-label="Knowledge survivor briefing">
      <div className="survivor-standby-stage" aria-hidden="true">
        <span className="survivor-standby-hero" />
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} style={{ "--a": `${i * 45}deg` } as CSSProperties} />
        ))}
      </div>
      <div className="survivor-standby-copy">
        <span>Memory Survivor</span>
        <strong>12 波记忆幸存挑战</strong>
        <p>{compact(quest.spec.goal, 56)}</p>
      </div>
      <div className="survivor-standby-rules">
        <b>答题得金币</b>
        <b>自动杀怪</b>
        <b>经验三选一</b>
        <b>扛过怪潮</b>
      </div>
    </div>
  );
}

// 右侧答题面板：从 quest.stages 循环出题，答对后由对应玩法决定奖励/场景反馈。
function LaneQuizPanel({
  quest,
  onAnswer,
  rewardLabel = "答对 +65 能量",
}: {
  quest: QuestGame;
  onAnswer: (correct: boolean, stage: Stage, choice: string, origin?: LaneEnergyOrigin) => void;
  rewardLabel?: string;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [locked, setLocked] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const stage = quest.stages[qIndex % quest.stages.length];

  function pick(index: number, event: SyntheticEvent<HTMLButtonElement>) {
    if (locked !== null) return;
    setLocked(index);
    const correct = index === stage.answerIndex;
    const rect = event.currentTarget.getBoundingClientRect();
    const nextStreak = correct ? streak + 1 : 0;
    setStreak(nextStreak);
    onAnswer(correct, stage, stage.choices[index] ?? "", {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      streak: nextStreak,
    });
    window.setTimeout(() => {
      setLocked(null);
      setQIndex((value) => value + 1);
    }, 760);
  }

  return (
    <aside className="lane-quiz" aria-label="Knowledge quiz">
      <div className="lane-quiz-head">
        <span>知识题 · {rewardLabel} · 连击 {streak}</span>
        <strong>{compact(stage.prompt, 40)}</strong>
      </div>
      <div className="lane-quiz-choices">
        {stage.choices.map((choice, index) => {
          const isAnswer = index === stage.answerIndex;
          const state = locked === null ? "" : index === locked ? (isAnswer ? "correct" : "wrong") : isAnswer ? "reveal" : "";
          return (
            <button className={`lane-quiz-choice ${state}`} disabled={locked !== null} key={choice} type="button" onClick={(event) => pick(index, event)}>
              <span>{index + 1}</span>
              <strong>{choice}</strong>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function TemplatePlay({
  mode,
  quest,
  stage,
  phase,
  events,
  selectedChoice,
  onChoice,
  onRuntimeEvent,
  onLaneComplete,
  disabled,
}: {
  mode: GameMode;
  quest: QuestGame;
  stage: Stage;
  phase: Phase;
  events: PlayEvent[];
  selectedChoice: number | null;
  onChoice: (index: number) => void;
  onRuntimeEvent: (event: Omit<PlayEvent, "id">) => void;
  onLaneComplete: (survived: boolean) => void;
  disabled: boolean;
}) {
  if (phase === "proof") {
    const survived = events.some((event) => event.runtimeStatus === "Survived" || event.runtimeStatus === "Outlasted");
    const victoryLabel = mode === "lane" ? (survived ? "防线守住" : "防线告破")
      : mode === "survivor" ? (survived ? "成功幸存" : "被怪潮淹没")
      : "Boss cleared";
    const resultHeading = mode === "lane"
      ? `${quest.modeLabel} ${survived ? "守住结算" : "防线复盘"}`
      : mode === "survivor"
      ? `${quest.modeLabel} ${survived ? "通关结算" : "阵亡复盘"}`
      : `${quest.modeLabel} 胜利结算`;
    const correctEvents = events.filter((event) => event.correct && event.advances).length;
    const clearedEvents = events.filter((event) => event.advances).length;
    const guardedEvents = events.filter((event) => event.kind === "guarded").length;
    const defendedEvents = events.filter((event) => event.runtimeStatus === "Defended").length;
    const survivorKills = events.filter((event) => event.runtimeStatus === "Cleared").length;
    const survivorCoinHits = events.filter((event) => event.runtimeStatus === "Coined").length;
    const survivorChests = events.filter((event) => event.runtimeStatus === "Chest").length;
    const survivorNovas = events.filter((event) => event.runtimeStatus === "Nova").length;
    const laneAnswerHits = events.filter((event) => mode === "lane" && event.advances && event.correct && event.runtimeStatus === "Energized").length;
    const laneAnswerMisses = events.filter((event) => mode === "lane" && event.advances && !event.correct && event.runtimeStatus === "Missed").length;
    const memoryScore = mode === "lane"
      ? Math.min(100, Math.round(defendedEvents * 6 + (survived ? 30 : 0) + quest.decision.confidence * 0.2))
      : mode === "survivor"
      ? Math.min(100, Math.round(survivorKills * 2 + survivorCoinHits * 5 + survivorChests * 4 + survivorNovas * 8 + (survived ? 25 : 0) + quest.decision.confidence * 0.2))
      : Math.min(100, Math.round((correctEvents / Math.max(quest.stages.length, 1)) * 72 + quest.decision.confidence * 0.28));
    const proofEvents = events.slice(-5);
    const proofSummary = mode === "survivor"
      ? `${quest.decision.title} · 击杀 ${survivorKills} · 答题 ${survivorCoinHits} · Nova ${survivorNovas}`
      : `${quest.decision.title} · ${clearedEvents}/${quest.stages.length} cleared · ${guardedEvents} guarded`;

    return (
      <div className={`template-play template-proof template-${mode}`}>
        <span className="proof-orb">
          <CheckCircle2 size={24} />
        </span>
        <div className="proof-copy">
          <span>{victoryLabel}</span>
          <strong>{resultHeading}</strong>
          <p>{proofSummary}</p>
        </div>
        <div className="proof-meter" aria-label="Memory proof score">
          <span>Memory score</span>
          <strong>{memoryScore}</strong>
          <i style={{ width: `${memoryScore}%` }} />
        </div>
        {mode === "lane" ? (
          <section className="lane-proof-stats" aria-label="Defense proof stats">
            <article>
              <span>答题能量</span>
              <strong>{laneAnswerHits * 65}</strong>
            </article>
            <article>
              <span>击退怪兽</span>
              <strong>{defendedEvents}</strong>
            </article>
            <article>
              <span>错题记录</span>
              <strong>{laneAnswerMisses}</strong>
            </article>
            <article>
              <span>防线状态</span>
              <strong>{survived ? "守住" : "告破"}</strong>
            </article>
          </section>
        ) : null}
        {mode === "survivor" ? (
          <section className="lane-proof-stats" aria-label="Survivor proof stats">
            <article>
              <span>击杀怪物</span>
              <strong>{survivorKills}</strong>
            </article>
            <article>
              <span>答对得币</span>
              <strong>{survivorCoinHits}</strong>
            </article>
            <article>
              <span>宝箱奖励</span>
              <strong>{survivorChests}</strong>
            </article>
            <article>
              <span>Nova 爆发</span>
              <strong>{survivorNovas}</strong>
            </article>
            <article>
              <span>结局</span>
              <strong>{survived ? "幸存" : "阵亡"}</strong>
            </article>
          </section>
        ) : null}
        <section className="proof-event-feed" aria-label="Play proof events">
          {proofEvents.map((event, index) => (
            <article className={event.kind} key={event.id}>
              <span>{index + 1}. {event.runtimeStatus || "Runtime"} · {event.stageTitle || "Memory event"}</span>
              <strong>{compact(event.choice, 13)}</strong>
              <em>{event.feedback || (event.correct ? "关键知识已命中" : "误区被记录")}</em>
            </article>
          ))}
        </section>
        <div className="result-grid">
          <strong>Agent fit {quest.decision.confidence}%</strong>
          {guardedEvents > 0 ? <strong>Runtime guards {guardedEvents}</strong> : null}
          {quest.exports.map((item) => (
            <strong key={item}>{item}</strong>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "lane") {
    if (phase !== "play") return <LaneDefenseStandby quest={quest} />;
    // 知识塔防：左侧 Phaser 棋盘 + 右侧答题面板（答题面板由外层 play 区渲染并发能量事件）。
    return (
      <LaneDefensePlayable
        quest={quest}
        onRuntimeEvent={onRuntimeEvent}
        onComplete={onLaneComplete}
        disabled={disabled}
      />
    );
  }

  if (mode === "survivor") {
    if (phase !== "play") return <SurvivorStandby quest={quest} />;
    // 知识幸存者：Phaser 竞技场 + 右侧答题面板（外层 play 区渲染并发金币事件）。
    return (
      <SurvivorPlayable
        quest={quest}
        onRuntimeEvent={onRuntimeEvent}
        onComplete={onLaneComplete}
        disabled={disabled}
      />
    );
  }

  // 仅 cards / lane / survivor 三个骨架；非 lane/survivor 一律走误区围剿（Boss 战），与 validatePlaySpec 降级语义一致。
  const currentStageEvent = selectedChoice !== null ? events[events.length - 1] : null;
  const correctEvents = events.filter((event) => event.correct && event.advances).length;
  const includesCurrentStageHit = Boolean(currentStageEvent?.correct && currentStageEvent.advances && currentStageEvent.stageId === stage.id);
  const stageBaseHp = Math.max(0, 100 - (correctEvents - (includesCurrentStageHit ? 1 : 0)) * 34);
  const targetHp = Math.max(0, 100 - correctEvents * 34);

  return (
    <MisconceptionBossPlayable
      quest={quest}
      stage={stage}
      stageBaseHp={stageBaseHp}
      targetHp={targetHp}
      selectedChoice={selectedChoice}
      onChoice={onChoice}
      disabled={disabled}
    />
  );
}

function QuestExperience() {
  const { loaded: particlesReady } = useParticlesProvider();
  const [view, setView] = useState<View>("upload");
  const [material, setMaterial] = useState<MaterialType>("notes");
  const [mode, setMode] = useState<GameMode>("cards");
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [routePreviewArmed, setRoutePreviewArmed] = useState(false);
  const [content, setContent] = useState(materialTypes[0].sample);
  const [fileName, setFileName] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [stepIndex, setStepIndex] = useState(0);
  const [quest, setQuest] = useState<QuestGame | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [events, setEvents] = useState<PlayEvent[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("local");
  const tokenRef = useRef(0);

  const draftQuest = useMemo(() => buildQuest(content, material, mode, fileName), [content, material, mode, fileName]);
  const activeMode = useMemo(() => gameModes.find((item) => item.id === mode) ?? gameModes[0], [mode]);
  const atlasQuest = useMemo(
    () => buildQuest("示例内容：把一篇课程、商品说明或知识库文档拆成概念、误区、行动和反馈，再交给 Agent 生成专属玩法方案。", "notes", mode, "sample.playspec"),
    [mode],
  );
  const activeQuest = quest && quest.schema === modeSchema.get(mode) ? quest : draftQuest;
  const activeStage = activeQuest.stages[Math.min(stageIndex, activeQuest.stages.length - 1)];
  const ready = content.trim().length >= 8 || Boolean(fileName);
  const clearedCount = events.filter((event) => event.advances).length;
  const correctCount = events.filter((event) => event.correct && event.advances).length;
  const bossHp = Math.max(0, 100 - correctCount * 34 - (phase === "proof" ? 18 : 0));
  const progress = phase === "input" ? (fileName ? 24 : 8) : phase === "generating" ? (stepIndex + 1) * 19 : phase === "proof" ? 100 : Math.min(100, Math.max(38, Math.round((clearedCount / activeQuest.stages.length) * 100)));
  const visibleGames = showcasedGameModes;

  useEffect(() => {
    if (view !== "play") return;
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }, [phase, view]);

  function reset(nextMaterial = material, nextContent = content, nextMode = mode, nextFileName = fileName) {
    tokenRef.current += 1;
    setMaterial(nextMaterial);
    setContent(nextContent);
    setMode(nextMode);
    setFileName(nextFileName);
    setPhase("input");
    setStepIndex(0);
    setQuest(null);
    setStageIndex(0);
    setSelectedChoice(null);
    setEvents([]);
    setIsBusy(false);
    setAgentStatus("local");
    setView("upload");
    setAtlasOpen(false);
    setRoutePreviewArmed(false);
  }

  function selectMaterial(nextMaterial: MaterialType) {
    const next = materialTypes.find((item) => item.id === nextMaterial);
    if (!next) return;
    reset(nextMaterial, next.sample, mode, "");
  }

  function onContentChange(event: ChangeEvent<HTMLTextAreaElement>) {
    reset(material, event.target.value, mode, fileName);
  }

  function selectMode(nextMode: GameMode) {
    reset(material, content, nextMode, fileName);
    setView("games");
  }

  const ingestFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setPhase("input");
    setQuest(null);
    setEvents([]);
    setSelectedChoice(null);
    setStageIndex(0);
    setView("games");
    setAtlasOpen(false);
    setRoutePreviewArmed(false);
    setAgentStatus("extracting");
    setIsBusy(true);

    const isText = file.type.startsWith("text/") || /\.(txt|md|csv)$/i.test(file.name);
    if (!isText) {
      setContent(`${file.name} 正在解析正文...`);
      const extracted = await extractFileWithAgent(file);
      setContent(extracted || `${file.name} 已上传，但本地服务暂未解析出正文。请粘贴文档正文后生成。`);
      setAgentStatus(extracted ? "local" : "fallback");
      setIsBusy(false);
      return;
    }

    const text = await file.text();
    setContent(text.trim().slice(0, maxContentChars) || `${file.name} 已上传。`);
    setAgentStatus("local");
    setIsBusy(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    maxFiles: 1,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "text/plain": [".txt", ".md", ".csv"],
    },
    onDrop: (acceptedFiles) => {
      if (acceptedFiles[0]) void ingestFile(acceptedFiles[0]);
    },
  });

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void ingestFile(file);
  }

  async function generate(autoPlay = false, requestedMode?: GameMode) {
    if (!ready || isBusy) return;

    const decision = chooseAgentDecision(content, material, requestedMode);
    const nextMode = decision.mode;
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setIsBusy(true);
    setMode(nextMode);
    setView("play");
    setPhase("generating");
    setStepIndex(0);
    setQuest(null);
    setEvents([]);
    setStageIndex(0);
    setSelectedChoice(null);
    setAgentStatus("model");

    for (let index = 0; index < steps.length; index += 1) {
      if (tokenRef.current !== token) {
        setIsBusy(false);
        return;
      }
      setStepIndex(index);
      await sleep(index === 0 ? 260 : 330);
    }

    const modelResult = await withTimeout(
      requestModelPlaySpec(content, material, nextMode, fileName),
      modelGenerationTimeoutMs,
      null,
    );
    if (tokenRef.current !== token) return;
    // 模型可能改选了更合适的骨架，以模型的最终 mode 为准（fallback 时仍用本地 nextMode）。
    const finalMode = modelResult ? modelResult.spec.skeleton : nextMode;
    if (modelResult && finalMode !== nextMode) setMode(finalMode);
    const nextQuest = modelResult
      ? buildQuestFromSpec(content, material, finalMode, fileName, modelResult.decision, modelResult.spec)
      : buildQuest(content, material, nextMode, fileName, decision);
    setQuest(nextQuest);
    setAgentStatus(modelResult ? "model" : "fallback");
    setPhase("play");
    setIsBusy(false);

    if (autoPlay && finalMode !== "lane" && finalMode !== "survivor") {
      for (let index = 0; index < nextQuest.stages.length; index += 1) {
        if (tokenRef.current !== token) return;
        setStageIndex(index);
        await sleep(360);
        commitChoice(nextQuest.stages[index].answerIndex, nextQuest, index);
        // 两个回合制骨架都是动效较重的可玩组件，给足回合间的演出时间。
        await sleep(1040);
      }
    }
  }

  function chooseGame(nextMode: GameMode) {
    void generate(false, nextMode);
  }

  function previewTemplate(nextMode: GameMode) {
    setMode(nextMode);
    setRoutePreviewArmed(true);
    setAtlasOpen(true);
    setView("games");
  }

  function exitPlayTheater() {
    tokenRef.current += 1;
    setIsBusy(false);
    setAtlasOpen(true);
    setRoutePreviewArmed(true);
    setView("games");
    setPhase("input");
    setStepIndex(0);
    setQuest(null);
    setStageIndex(0);
    setSelectedChoice(null);
    setEvents([]);
  }

  function recordRuntimeEvent(event: Omit<PlayEvent, "id">) {
    setEvents((current) => [
      ...current,
      {
        ...event,
        id: `${event.stageId}-${event.kind}-${Date.now()}`,
      },
    ]);
  }

  // 知识塔防结束（守住/告破）→ 记一条总结事件并进入 proof。
  function finishLane(survived: boolean) {
    recordRuntimeEvent({
      advances: true,
      correct: survived,
      choice: survived ? "守住所有波次" : "防线被攻破",
      feedback: survived ? "知识防线稳固，记忆点已巩固。" : "防线告破，仍记录了答题贡献。",
      kind: survived ? "hit" : "miss",
      runtimeStatus: survived ? "Survived" : "Breached",
      stageId: "lane",
      stageTitle: "Recall Defense",
    });
    window.setTimeout(() => setPhase("proof"), 600);
  }

  // 知识幸存者结束（幸存/阵亡）→ 记总结事件并进 proof。
  function finishSurvivor(survived: boolean) {
    recordRuntimeEvent({
      advances: true,
      correct: survived,
      choice: survived ? "扛过所有怪潮" : "被怪潮淹没",
      feedback: survived ? "成功幸存，知识点在战斗中被反复强化。" : "阵亡，但答题与击杀都被记录。",
      kind: survived ? "hit" : "miss",
      runtimeStatus: survived ? "Outlasted" : "Downed",
      stageId: "survivor",
      stageTitle: "Memory Survivor",
    });
    window.setTimeout(() => setPhase("proof"), 600);
  }

  // 知识幸存者答题：答对 → 金币 + 知识脉冲 + 回盾 + Nova 充能；答错只产生压力反馈。
  function answerSurvivorQuestion(correct: boolean, stage: Stage, choice: string, origin?: LaneEnergyOrigin) {
    if (correct) {
      window.dispatchEvent(new CustomEvent("intoplay:survivor-coin", { detail: { amount: 65 } }));
      window.dispatchEvent(new CustomEvent("intoplay:survivor-rally", { detail: { correct: true, streak: origin?.streak ?? 1 } }));
      playFeedbackTone("success");
    } else {
      window.dispatchEvent(new CustomEvent("intoplay:survivor-rally", { detail: { correct: false, streak: 0 } }));
      playFeedbackTone("miss");
    }
    recordRuntimeEvent({
      advances: true,
      correct,
      choice,
      feedback: correct ? `${activeQuest.spec.feedback.hit} Nova 充能 +1。` : activeQuest.spec.feedback.miss,
      kind: correct ? "hit" : "miss",
      runtimeStatus: correct ? "Coined" : "Missed",
      stageId: stage.id,
      stageTitle: stage.title,
    });
  }

  // 知识塔防答题：答对 → 派发能量事件 + 记 proof；答错只记录、不给能量。
  function answerLaneQuestion(correct: boolean, stage: Stage, choice: string, origin?: LaneEnergyOrigin) {
    if (correct) {
      window.dispatchEvent(new CustomEvent("intoplay:lane-energy", { detail: { amount: 65, from: origin } }));
      playFeedbackTone("success");
    } else {
      playFeedbackTone("miss");
    }
    recordRuntimeEvent({
      advances: true,
      correct,
      choice,
      feedback: correct ? activeQuest.spec.feedback.hit : activeQuest.spec.feedback.miss,
      kind: correct ? "hit" : "miss",
      runtimeStatus: correct ? "Energized" : "Missed",
      stageId: stage.id,
      stageTitle: stage.title,
    });
  }

  function commitChoice(choiceIndex: number, sourceQuest = activeQuest, sourceIndex = stageIndex) {
    const sourceStage = sourceQuest.stages[sourceIndex];
    const correct = choiceIndex === sourceStage.answerIndex;
    setSelectedChoice(choiceIndex);
    setEvents((current) => [
      ...current,
      {
        id: `${sourceStage.id}-${choiceIndex}-${Date.now()}`,
        advances: true,
        correct,
        choice: sourceStage.choices[choiceIndex] ?? "Unknown choice",
        // 反馈文案优先用 Agent 生成的 PlaySpec.feedback，回退到回合自带文案。
        feedback: correct
          ? sourceQuest.spec.feedback.hit || sourceStage.feedback
          : sourceQuest.spec.feedback.miss || `误区触发：${sourceStage.trap}`,
        kind: correct ? "hit" : "miss",
        runtimeStatus: correct ? "Accepted" : "Fallback",
        stageId: sourceStage.id,
        stageTitle: sourceStage.title,
      },
    ]);
    // 两个骨架均为重动效可玩组件，统一播放音效并留足演出时间。
    playFeedbackTone(correct ? "success" : "miss");

    window.setTimeout(() => {
      if (sourceIndex >= sourceQuest.stages.length - 1) {
        setPhase("proof");
      } else {
        setStageIndex(sourceIndex + 1);
        setSelectedChoice(null);
      }
    }, 880);
  }

  return (
    <div className={`quest-app phase-${phase} mode-${mode} view-${view}`}>
      <div className="ambient-field" aria-hidden="true">
        {particlesReady ? <Particles id="quest-particles" options={particleOptions} /> : null}
      </div>

      <header className="quest-header">
        <motion.button className="brand" type="button" onClick={() => reset()} aria-label="Reset demo" whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
          <span className="brand-mark">
            <Gamepad2 size={21} />
          </span>
          <span>
            <strong>{productName}</strong>
            <em>{productPositioning}</em>
          </span>
        </motion.button>

        <div className="header-flow" aria-label="Product flow">
          <button className={view === "upload" ? "active" : ""} type="button" onClick={() => setView("upload")}>资料</button>
          <ChevronRight size={14} />
          <button className={view === "games" ? "active" : ""} type="button" onClick={() => setView("games")}>玩法</button>
          <ChevronRight size={14} />
          <button className={view === "play" ? "active" : ""} type="button" onClick={() => (quest ? setView("play") : void generate(false))}>运行</button>
        </div>

        <div className="header-actions">
          <motion.button className="icon-button" type="button" onClick={() => reset()} aria-label="Reset" whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }}>
            <RefreshCcw size={18} />
          </motion.button>
          <motion.button className="primary-button" type="button" onClick={() => void generate(true)} disabled={!ready || isBusy} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            <Play size={18} fill="currentColor" />
            生成游戏
          </motion.button>
        </div>
      </header>

      <main className={`quest-main view-${view}`}>
          {view === "upload" ? (
            <motion.section className="page upload-page" key="upload" aria-label="Upload material" initial={{ opacity: 0, x: -28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 28 }} transition={{ duration: 0.28 }}>
              <section className="hero-copy" aria-label="Intro">
                <span className="signal-chip">
                  <Sparkles size={15} />
                  GameCraft Engine
                </span>
                <h1 className="hero-title" aria-label={productHeadline}>
                  <motion.span
                    className="hero-title-brand"
                    initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {productName}
                  </motion.span>
                  <motion.span
                    className="hero-title-line"
                    initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.48, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {productPositioning}
                  </motion.span>
                </h1>
                <p>{productIntro}</p>
                <div className="hero-tags">
                  <span>PDF</span>
                  <span>SOP</span>
                  <span>课件</span>
                  <span>字幕</span>
                </div>

                <div className="launch-flow" aria-label="Generation flow">
                  <article>
                    <FileUp size={18} />
                    <strong>资料输入</strong>
                    <span>{fileName ? compact(fileName, 14) : activeQuest.materialLabel}</span>
                  </article>
                  <article>
                    <Sparkles size={18} />
                    <strong>AI 改编</strong>
                    <span>{modeRouteLabel.get(activeQuest.spec.skeleton) ?? activeQuest.schema.replace("_quest", "")}</span>
                  </article>
                  <article>
                    <Play size={18} fill="currentColor" />
                    <strong>游戏运行</strong>
                    <span>{activeQuest.modeLabel}</span>
                  </article>
                </div>

                <div className="hero-game-shelf" aria-label="Game template preview">
                  {showcasedGameModes.map((item) => (
                    <button className={`shelf-card accent-${item.accent}`} key={item.id} type="button" onClick={() => previewTemplate(item.id)}>
                      <span>{item.short}</span>
                      <strong>{item.label}</strong>
                    </button>
                  ))}
                </div>
              </section>

              <section className="upload-panel" onPointerMove={trackSpotlight}>
                <div className="panel-lid">
                  <span>资料游戏化引擎</span>
                  <strong>{content.trim().length || 0} chars</strong>
                </div>
                <motion.button
                  {...getRootProps({
                    className: `dropzone ${isDragActive ? "drag-active" : ""}`,
                  })}
                  type="button"
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <input {...getInputProps({ onChange: onFileChange })} />
                  <FileUp size={22} />
                  <strong>{fileName ? compact(fileName, 26) : "上传资料"}</strong>
                  <span>{isDragActive ? "松开进入游戏库" : "PDF / DOC / TXT"}</span>
                </motion.button>

                <div className="segmented material-segment" aria-label="Material type">
                  {materialTypes.map((item) => (
                    <motion.button className={material === item.id ? "active" : ""} key={item.id} type="button" onClick={() => selectMaterial(item.id)} whileTap={{ scale: 0.96 }}>
                      {item.label}
                    </motion.button>
                  ))}
                </div>

                <textarea value={content} onChange={onContentChange} spellCheck={false} aria-label="Learning material text" />

                <motion.button className="next-button" type="button" onClick={() => { setAtlasOpen(false); setRoutePreviewArmed(false); setView("games"); }} disabled={!ready} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
                  <Gamepad2 size={18} />
                  打开 GameCraft 玩法库
                </motion.button>
              </section>
            </motion.section>
          ) : null}

          {view === "games" ? (
            <motion.section className={`page atlas-page ${atlasOpen ? "expanded" : ""}`} key="games" aria-label="GameCraft route engine" initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -32 }} transition={{ duration: 0.28 }}>
              <header className="atlas-topline">
                <section className="atlas-title">
                  <span className="signal-chip">
                    <Cpu size={15} />
                    AI Playbook · GameCraft routes
                  </span>
                </section>

                <section className="atlas-toolbar" aria-label="Atlas filters">
                <span className="atlas-proof-pill">{showcasedGameModes.length} 条玩法路线</span>
                <span className="atlas-proof-pill">CC0 游戏素材</span>
                <span className="atlas-proof-pill">运行时护栏</span>
              </section>
              </header>

              <section className="atlas-shell" aria-label="Template engine showcase">
                <div className="atlas-beams" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>

                <section className={`atlas-stage-panel ${routePreviewArmed ? `accent-${activeMode.accent}` : "idle"}`} aria-label="Template playable preview" onPointerMove={trackSpotlight}>
                  <div className="stage-panel-top">
                    <span>
                      <ShieldCheck size={15} />
                      gamecraft.route
                    </span>
                    <code>{routePreviewArmed ? modeRouteLabel.get(activeMode.id) ?? activeMode.label : "选择玩法路线"}</code>
                  </div>

                  <div className="stage-playable">
                    {routePreviewArmed ? (
                      <TemplatePreview mode={mode} quest={atlasQuest} activeMode={activeMode} />
                    ) : (
                      <AtlasRouteStandby fileName={fileName} ready={ready} />
                    )}
                  </div>

                  <div className="atlas-actions">
                    {routePreviewArmed && atlasOpen ? (
                      <button className="ghost-button" type="button" onClick={() => { setAtlasOpen(false); setRoutePreviewArmed(false); }}>
                        <ArrowLeft size={17} />
                        返回玩法库
                      </button>
                    ) : (
                      <span className="atlas-hint">
                        <Sparkles size={16} />
                        选择节点
                      </span>
                    )}
                    {routePreviewArmed ? (
                      <motion.button className="next-button atlas-generate" type="button" onClick={() => void generate(true, mode)} disabled={!ready || isBusy} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
                        <Code2 size={18} />
                        用这个玩法生成我的内容
                      </motion.button>
                    ) : (
                      <button className="next-button atlas-generate" type="button" disabled>
                        <Layers3 size={18} />
                        选择玩法路线
                      </button>
                    )}
                  </div>
                </section>

                <div className="atlas-node-ring" aria-label="Template nodes">
                  {visibleGames.map((item, index) => (
                    <motion.button
                      className={`atlas-node ${routePreviewArmed && mode === item.id ? "selected" : ""} accent-${item.accent}`}
                      key={item.id}
                      style={{ "--angle": `${index * (360 / Math.max(visibleGames.length, 1)) - 90}deg` } as CSSProperties}
                      type="button"
                      onClick={() => previewTemplate(item.id)}
                      onPointerMove={trackSpotlight}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <span>{item.short}</span>
                      <strong>{item.label}</strong>
                      <em>{item.schema}</em>
                      <i>★ {item.rating}</i>
                    </motion.button>
                  ))}
                </div>
              </section>
            </motion.section>
          ) : null}

          {view === "play" ? (
            <motion.section className="page play-page" key="play" aria-label="Generated quest" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.26 }}>
              {phase !== "input" ? (
                <motion.button className="theater-return" type="button" onClick={exitPlayTheater} aria-label="返回 GameCraft 玩法库" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}>
                  <ArrowLeft size={17} />
                  <span>返回 Atlas</span>
                </motion.button>
              ) : null}
              <section className="quest-stage" aria-label="Quest generator">
                <div className="play-stage-label">
                  <span>
                    <ShieldCheck size={15} />
                    Agent Runtime
                  </span>
                  <code>{activeQuest.schema}</code>
                </div>

                <div className="energy-surface" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>

                <div className="orbit-rings" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>

                <div className="orbit-system" aria-label="Generation artifacts">
                  {orbitLabels.map((label, index) => (
                    <article
                      className={phase !== "input" && index <= Math.min(orbitLabels.length - 1, stepIndex + 1) ? "active" : ""}
                      key={label}
                      style={{ "--angle": `${index * 60}deg` } as CSSProperties}
                    >
                      <span>{label}</span>
                    </article>
                  ))}
                </div>

                <motion.section className="material-capsule" aria-label="Uploaded material" animate={{ y: phase === "generating" ? -8 : 0, scale: fileName ? 1.04 : 1 }} transition={{ type: "spring", stiffness: 220, damping: 22 }}>
                  <BookOpenText size={22} />
                  <strong>{fileName ? compact(fileName, 16) : activeQuest.materialLabel}</strong>
                  <span>{activeQuest.keywords.slice(0, 3).map((item) => compact(item, 6)).join(" · ")}</span>
                </motion.section>

                <motion.button className="quest-core" type="button" onClick={() => void generate(false)} disabled={!ready || isBusy} aria-label="生成游戏" whileHover={{ y: -8, scale: 1.025 }} whileTap={{ scale: 0.97 }} animate={{ rotate: phase === "generating" ? 360 : 0 }} transition={{ rotate: { duration: 2.6, repeat: phase === "generating" ? Infinity : 0, ease: "linear" } }}>
                  <span className="core-aura" />
                  <span className="core-icon">
                    {phase === "input" ? <WandSparkles size={42} /> : phase === "generating" ? <Sparkles size={42} /> : <Play size={42} fill="currentColor" />}
                  </span>
                  <strong>{phase === "input" ? "生成" : phase === "generating" ? steps[stepIndex] : "试玩"}</strong>
                </motion.button>

                <AnimatePresence>
                  {phase !== "input" ? (
                    <motion.section className={`play-card visible play-mode-${mode}`} aria-label="Generated game preview" onPointerMove={trackSpotlight} initial={{ opacity: 0, y: 22, scale: 0.94, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, y: 14, scale: 0.96 }} transition={{ type: "spring", stiffness: 230, damping: 24 }}>
                      <div className="play-card-top">
                        <span>{activeQuest.title}</span>
                        <strong>{activeQuest.modeLabel}</strong>
                      </div>

                      <div className="agent-choice-strip" aria-label="Agent playable decision">
                        <span>{agentStatus === "model" && phase === "play" ? "Model PlaySpec generated" : agentStatus === "fallback" && phase === "play" ? "Local fallback PlaySpec" : activeQuest.decision.title}</span>
                        <strong>{activeQuest.decision.confidence}% fit</strong>
                        <em>{activeQuest.decision.reasons.slice(0, 2).join(" · ")}</em>
                      </div>

                      <AgentLens quest={activeQuest} stage={activeStage} phase={phase} />

                      <div className="boss-line">
                        <div className="boss-token">
                          <Zap size={22} />
                        </div>
                        <div>
                          <strong>{activeQuest.boss}</strong>
                          <span>{activeStage.trap}</span>
                        </div>
                        <motion.i animate={{ width: `${bossHp}%` }} transition={{ duration: 0.28 }} />
                      </div>

                      <TemplatePlay
                        mode={mode}
                        quest={activeQuest}
                        stage={activeStage}
                        phase={phase}
                        events={events}
                        selectedChoice={selectedChoice}
                        onChoice={commitChoice}
                        onRuntimeEvent={recordRuntimeEvent}
                        onLaneComplete={mode === "survivor" ? finishSurvivor : finishLane}
                        disabled={phase !== "play" || (mode !== "lane" && mode !== "survivor" && selectedChoice !== null)}
                      />

                      {mode === "lane" && phase === "play" ? (
                        <LaneQuizPanel quest={activeQuest} onAnswer={answerLaneQuestion} />
                      ) : null}

                      {mode === "survivor" && phase === "play" ? (
                        <LaneQuizPanel
                          quest={activeQuest}
                          rewardLabel="答对 +65 金币 / 回盾 / Nova 充能"
                          onAnswer={(correct, stage, choice, origin) => answerSurvivorQuestion(correct, stage, choice, origin)}
                        />
                      ) : null}

                      <div className="json-strip">
                        <code>{activeQuest.schema}</code>
                        <span>{activeQuest.stages.length} levels</span>
                      </div>
                    </motion.section>
                  ) : null}
                </AnimatePresence>
              </section>

              <section className="play-controls">
                <div className="segmented mode-segment" aria-label="Game mode">
                  <Layers3 size={16} />
                  {showcasedGameModes.map((item) => (
                    <motion.button className={mode === item.id ? "active" : ""} key={item.id} type="button" onClick={() => chooseGame(item.id)} whileTap={{ scale: 0.96 }}>
                      {item.label}
                    </motion.button>
                  ))}
                </div>

                <div className="status-rail" aria-label="Generation status">
                  {steps.map((item, index) => (
                    <span className={phase !== "input" && index <= stepIndex ? "active" : ""} key={item}>
                      {phase !== "input" && index <= stepIndex ? <CheckCircle2 size={14} /> : <i />}
                      {item}
                    </span>
                  ))}
                  <strong>{Math.min(100, progress)}%</strong>
                </div>

                <motion.button className="generate-button" type="button" onClick={() => void generate(false, mode)} disabled={!ready || isBusy} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
                  <Rocket size={18} />
                  {phase === "generating" ? "生成中" : "重新生成"}
                </motion.button>
              </section>
            </motion.section>
          ) : null}
      </main>
    </div>
  );
}

function App() {
  return (
    <ParticlesProvider init={initParticles}>
      <QuestExperience />
    </ParticlesProvider>
  );
}

export default App;
