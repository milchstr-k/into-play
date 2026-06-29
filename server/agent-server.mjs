import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { basename, extname, resolve } from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const PORT = Number(process.env.AGENT_PORT || 8787);
const HOST = process.env.AGENT_HOST || "0.0.0.0";
const MAX_CONTENT_CHARS = 12000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const GAME_MODES = new Set(["cards", "lane", "survivor"]);
const MOODS = new Set(["tense", "calm", "playful"]);
const STRUCTURAL_LABELS = new Set([
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

loadLocalEnv();

function localIPv4Addresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items || [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function loadLocalEnv() {
  const envPaths = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(homedir(), ".env.comate"),
  ];
  for (const filePath of envPaths) {
    if (!existsSync(filePath)) continue;

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (process.env[key]) continue;
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function modelConfig() {
  const openAIKey = process.env.OPENAI_API_KEY || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY || process.env.ONE_API_KEY || "";
  const requestedProvider = String(process.env.AGENT_MODEL_PROVIDER || process.env.MODEL_PROVIDER || "").toLowerCase();
  const provider = requestedProvider || (openAIKey ? "openai" : anthropicKey ? "anthropic" : "none");

  if (provider === "anthropic" || provider === "oneapi") {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      baseUrl: (process.env.ANTHROPIC_BASE_URL || process.env.LLM_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
      model: process.env.ANTHROPIC_MODEL || process.env.LLM_MODEL || "Claude Sonnet 4.6",
    };
  }

  return {
    provider: "openai",
    apiKey: openAIKey,
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  };
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function sendOptions(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end();
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_UPLOAD_BYTES) throw new Error("Request too large");
  }
  return body ? JSON.parse(body) : {};
}

function clipText(value, max = MAX_CONTENT_CHARS) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clipMaterialText(value, max = MAX_CONTENT_CHARS) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function compact(value, max = 42) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function cleanUnitText(value, max = 120) {
  return compact(
    String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^[-*•\d.)\s]+/, "")
      .replace(/^(meaning|definition|example|content|source|title)\s*[:：]\s*/i, "")
      .trim(),
    max,
  );
}

function isStructuralLabel(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return !normalized || STRUCTURAL_LABELS.has(normalized);
}

function extractKnowledgeUnits(content) {
  const text = String(content || "").replace(/\r/g, "").trim();
  const units = [];
  const seen = new Set();

  function addUnit(anchor, fact, example = "", kind = "fact") {
    const cleanedAnchor = cleanUnitText(anchor, 36).replace(/[：:]+$/, "");
    const cleanedFact = cleanUnitText(fact, 140);
    const cleanedExample = cleanUnitText(example, 140);
    const key = `${cleanedAnchor.toLowerCase()}::${cleanedFact.toLowerCase()}`;
    if (isStructuralLabel(cleanedAnchor) || cleanedFact.length < 5 || seen.has(key)) return;
    seen.add(key);
    units.push({ anchor: cleanedAnchor, fact: cleanedFact, example: cleanedExample, kind });
  }

  const vocabPattern = /(?:^|\n)\s*(?:\d+[\).]\s*)?([A-Za-z][A-Za-z -]{1,40})\s*\n\s*(?:Meaning|Definition)\s*[:：]\s*([^\n]+)(?:\n\s*(?:Example|Sentence)\s*[:：]\s*([^\n]+))?/gi;
  for (const match of text.matchAll(vocabPattern)) {
    addUnit(match[1], match[2], match[3] || "", "definition");
  }

  const inlineVocabPattern = /(?:^|\s)(?:\d+[\).]\s*)?([A-Za-z][A-Za-z -]{1,40})\s+(?:Meaning|Definition)\s*[:：]\s*(.*?)(?:\s+(?:Example|Sentence)\s*[:：]\s*(.*?))(?=\s+\d+[\).]\s*[A-Za-z]|\s*$)/gi;
  for (const match of text.matchAll(inlineVocabPattern)) {
    addUnit(match[1], match[2], match[3] || "", "definition");
  }

  for (const line of text.split(/\n+/)) {
    const pair = line.match(/^\s*(?:[-*•]\s*)?([^:：]{2,36})[:：]\s*(.{6,180})$/u);
    if (pair) addUnit(pair[1], pair[2], "", "fact");
  }

  const sentences = text
    .replace(/[【】「」《》]/g, "")
    .split(/[。！？!?；;\n]+/u)
    .map((item) => cleanUnitText(item, 160))
    .filter((item) => item.length >= 8);
  for (const sentence of sentences) {
    const anchor =
      sentence.match(/^([A-Za-z][A-Za-z -]{1,32})\s+(?:means|refers to|is|are)\s+/i)?.[1]
      || sentence.match(/^([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 -]{1,24}?)(?:是|指|需要|必须|可以|能够|包含|包括|用于)/u)?.[1]
      || sentence.split(/\s+/).find((word) => /^[A-Za-z0-9-]{4,}$/.test(word))
      || sentence.match(/[\p{Script=Han}]{2,8}/u)?.[0]
      || `要点${units.length + 1}`;
    addUnit(anchor, sentence, "", "fact");
  }

  return units.slice(0, 16);
}

function arrangeChoices(correct, wrongA, wrongB, answerIndex) {
  if (answerIndex === 1) return [wrongA, correct, wrongB];
  if (answerIndex === 2) return [wrongA, wrongB, correct];
  return [correct, wrongA, wrongB];
}

function fallbackWrongChoices(unit, units) {
  const otherFacts = units
    .filter((item) => item !== unit)
    .map((item) => cleanUnitText(item.fact, 74))
    .filter(Boolean);
  const wrongs = [...otherFacts];
  if (unit.kind === "definition") {
    wrongs.push(`把 ${unit.anchor} 理解成另一条资料概念`);
    wrongs.push(`${unit.anchor} 表示和原文相反的意思`);
  } else {
    wrongs.push(`只看表面，没有抓住「${unit.anchor}」的资料事实`);
    wrongs.push(`把「${unit.anchor}」解释成资料没有提到的结论`);
  }
  return wrongs.slice(0, 2);
}

function buildFallbackSpec(content, mode) {
  const units = extractKnowledgeUnits(content);
  const safeUnits = units.length >= 3
    ? units
    : [
      { anchor: "核心概念", fact: "内容需要先被提炼成可验证的知识点", example: "", kind: "fact" },
      { anchor: "互动反馈", fact: "答题反馈应该解释正确理由，而不是只给对错", example: "", kind: "fact" },
      { anchor: "误区来源", fact: "错误选项应该暴露用户可能混淆的地方", example: "", kind: "fact" },
    ];
  const count = mode === "cards" ? 3 : 12;
  const stages = Array.from({ length: count }, (_, index) => {
    const unit = safeUnits[index % safeUnits.length];
    const [wrongA, wrongB] = fallbackWrongChoices(unit, safeUnits);
    const answerIndex = index % 3;
    const correct = cleanUnitText(unit.fact, 74);
    const prompt = unit.kind === "definition"
      ? `“${unit.anchor}” 的含义更接近哪一项？`
      : `关于“${unit.anchor}”，哪一项最符合资料？`;
    return {
      id: mode === "cards" ? ["scan", "break", "repair"][index] || `q${index + 1}` : `q${index + 1}`,
      title: mode === "cards" ? ["识别", "破盾", "修正"][index] || `Q${index + 1}` : `Q${index + 1}`,
      prompt,
      trap: cleanUnitText(wrongA, 64),
      choices: arrangeChoices(correct, cleanUnitText(wrongA, 74), cleanUnitText(wrongB, 74), answerIndex),
      answerIndex,
      feedback: unit.example ? `${unit.anchor}: ${correct} 例句：${cleanUnitText(unit.example, 86)}` : `${unit.anchor}: ${correct}`,
    };
  });

  return {
    decision: {
      confidence: 88,
      mode,
      reasons: ["抽取通用知识单元", "过滤结构化字段名", "题目围绕资料事实"],
      signals: safeUnits.map((unit) => unit.anchor).slice(0, 5),
      title: "Knowledge units generated",
    },
    spec: {
      skeleton: mode,
      goal: mode === "lane"
        ? "答对资料题获得能量，守住知识防线"
        : mode === "survivor"
        ? "答对资料题得金币升级，扛过怪潮"
        : "识别资料误区，用证据破盾并修正",
      mood: mode === "cards" ? "tense" : "playful",
      feedback: mode === "lane"
        ? { hit: "答对！获得建塔能量。", miss: "答错，能量没到手。" }
        : mode === "survivor"
        ? { hit: "答对！金币入袋。", miss: "答错，没拿到金币。" }
        : { hit: "证据命中，护盾裂开。", miss: "误区反噬，重新瞄准。" },
      stages,
    },
  };
}

function stageQualityIssues(stage) {
  const text = [stage.title, stage.prompt, stage.trap, ...(stage.choices || []), stage.feedback].join(" ");
  const issues = [];
  if (/用户答错|系统应该纠正|混淆\s*(English|Meaning|Example)|只记标题/i.test(text)) issues.push("meta_template_leak");
  if (/[“「](English|Meaning|Example|Content|Source|Prompt|Title|Question|Answer)[”」]/i.test(text)) issues.push("structural_anchor");
  if (/(^|\s)(English|Meaning|Example)(\s|$)/i.test(stage.prompt || "")) issues.push("field_name_prompt");
  if ([stage.prompt, stage.trap, stage.feedback, ...(stage.choices || [])].some((item) => /\.{3,}$/.test(String(item || "").trim()))) issues.push("truncated_fragment");
  if ((stage.choices || []).some((choice) => /^and\s+without\b/i.test(choice))) issues.push("broken_choice_fragment");
  return issues;
}

function validateGeneratedQuality(result, content) {
  const stages = result?.spec?.stages || [];
  const units = extractKnowledgeUnits(content);
  const unitAnchors = units.map((unit) => unit.anchor.toLowerCase());
  const issues = stages.flatMap(stageQualityIssues);
  const hasEnoughCoverage = unitAnchors.length < 3
    || unitAnchors.filter((anchor) => JSON.stringify(stages).toLowerCase().includes(anchor)).length >= Math.min(3, unitAnchors.length);
  if (!hasEnoughCoverage) issues.push("low_content_coverage");
  return issues;
}

function normalizeStage(stage, index, mode) {
  if (!stage || typeof stage !== "object") return null;
  const choices = Array.isArray(stage.choices)
    ? stage.choices.map((choice) => compact(choice, 90)).filter(Boolean).slice(0, 3)
    : [];
  if (choices.length < 2) return null;
  const answerIndex = Number.isInteger(stage.answerIndex) ? stage.answerIndex : 0;
  if (answerIndex < 0 || answerIndex >= choices.length) return null;

  return {
    id: compact(stage.id, 18) || (mode === "cards" ? ["scan", "break", "repair"][index] || `q${index + 1}` : `q${index + 1}`),
    title: compact(stage.title, 18) || (mode === "cards" ? ["Scan", "Break", "Repair"][index] || `Q${index + 1}` : `Q${index + 1}`),
    prompt: compact(stage.prompt, 150),
    trap: compact(stage.trap, 90) || compact(choices.find((_, choiceIndex) => choiceIndex !== answerIndex), 90),
    choices,
    answerIndex,
    feedback: compact(stage.feedback, 160) || `命中资料要点：${choices[answerIndex]}`,
  };
}

function normalizeModelOutput(candidate, requestedMode) {
  if (!candidate || typeof candidate !== "object") throw new Error("Model returned empty JSON");
  const rawSpec = candidate.spec && typeof candidate.spec === "object" ? candidate.spec : candidate;
  const skeleton = GAME_MODES.has(rawSpec.skeleton) ? rawSpec.skeleton : requestedMode;
  if (!GAME_MODES.has(skeleton)) throw new Error("Model returned unsupported skeleton");

  const stages = Array.isArray(rawSpec.stages)
    ? rawSpec.stages.map((stage, index) => normalizeStage(stage, index, skeleton)).filter(Boolean)
    : [];
  const minStages = skeleton === "cards" ? 3 : 6;
  if (stages.length < minStages) throw new Error(`Model returned too few stages for ${skeleton}`);

  const fallbackFeedback = skeleton === "lane"
    ? { hit: "答对！获得建塔能量。", miss: "答错，能量没到手。" }
    : skeleton === "survivor"
    ? { hit: "答对！金币入袋。", miss: "答错，没拿到金币。" }
    : { hit: "证据命中，护盾裂开。", miss: "误区反噬，重新瞄准。" };

  const feedback = rawSpec.feedback && typeof rawSpec.feedback === "object"
    ? {
      hit: compact(rawSpec.feedback.hit, 48) || fallbackFeedback.hit,
      miss: compact(rawSpec.feedback.miss, 48) || fallbackFeedback.miss,
    }
    : fallbackFeedback;

  const rawDecision = candidate.decision && typeof candidate.decision === "object" ? candidate.decision : {};
  const decision = {
    confidence: Math.max(70, Math.min(98, Number(rawDecision.confidence) || 91)),
    mode: skeleton,
    reasons: Array.isArray(rawDecision.reasons) ? rawDecision.reasons.map((item) => compact(item, 24)).filter(Boolean).slice(0, 3) : ["模型理解资料", "生成内容专属题目"],
    signals: Array.isArray(rawDecision.signals) ? rawDecision.signals.map((item) => compact(item, 18)).filter(Boolean).slice(0, 5) : ["content", "model"],
    title: compact(rawDecision.title, 36) || "Model generated playable",
  };

  return {
    decision,
    spec: {
      skeleton,
      goal: compact(rawSpec.goal, 68) || "把当前资料转成可玩的学习关卡",
      mood: MOODS.has(rawSpec.mood) ? rawSpec.mood : (skeleton === "cards" ? "tense" : "playful"),
      feedback,
      stages: skeleton === "cards" ? stages.slice(0, 3) : stages.slice(0, 12),
    },
  };
}

function extractJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON");
    return JSON.parse(match[0]);
  }
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

async function extractPptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] || 0) - Number(b.match(/slide(\d+)/i)?.[1] || 0));
  const slides = [];
  for (const name of slideNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const chunks = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
      .map((match) => decodeXmlText(match[1]).trim())
      .filter(Boolean);
    if (chunks.length) slides.push(chunks.join(" "));
  }
  return slides.join("\n");
}

function buildPlaySpecPrompt(payload) {
  const knowledgeUnits = extractKnowledgeUnits(payload.content);
  const systemPrompt = [
    "你是 IntoPlay 的学习游戏设计 Agent。",
    "任务：先把用户资料抽成通用知识单元，再转成可立即运行的 PlaySpec JSON。",
    "必须输出严格 JSON，不要 Markdown，不要解释。",
    "schema:",
    "{ decision:{confidence:number,mode:'cards'|'lane'|'survivor',title:string,reasons:string[],signals:string[]}, spec:{skeleton:'cards'|'lane'|'survivor',goal:string,mood:'tense'|'calm'|'playful',feedback:{hit:string,miss:string},stages:[{id:string,title:string,prompt:string,trap:string,choices:string[],answerIndex:number,feedback:string}]}}",
    "通用知识单元可以是：概念/定义、例子、规则、步骤、因果、判断条件、常见误区、行动建议。",
    "禁止把字段名、栏目名、文件结构词当成知识点，例如 English、Meaning、Example、Content、Source、Prompt、Title、Question、Answer。",
    "规则：题目必须来自知识单元里的真实事实，不要使用通用套话；每题 3 个选项；answerIndex 指向正确选项；反馈要解释资料要点。",
    "题干要像用户真正会学习的题，不要出现“用户答错 X 时系统应该纠正什么”这类产品内测语气。",
    "cards 输出 3 题：Scan/Break/Repair；lane/survivor 输出 12 题，适合循环答题得资源。",
    "如果用户指定 skeleton，必须使用指定 skeleton。",
  ].join("\n");
  const userPrompt = JSON.stringify({
    requestedSkeleton: payload.mode,
    material: payload.material,
    fileName: payload.fileName || "",
    knowledgeUnits,
    content: clipMaterialText(payload.content),
  });

  return { systemPrompt, userPrompt };
}

async function callOpenAI(payload, config) {
  if (!config.apiKey) {
    const error = new Error("Missing OPENAI_API_KEY");
    error.status = 503;
    error.code = "missing_api_key";
    throw error;
  }

  const { systemPrompt, userPrompt } = buildPlaySpecPrompt(payload);
  const { apiKey, baseUrl, model } = config;

  function extractResponseText(data) {
    if (typeof data?.output_text === "string") return data.output_text;
    if (Array.isArray(data?.output)) {
      return data.output
        .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
        .map((item) => item?.text || item?.content || "")
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }

  async function postOpenAI(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
      error.status = response.status;
      error.detail = data;
      throw error;
    }
    return data;
  }

  const responsesBody = {
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: { format: { type: "json_object" } },
    temperature: 0.45,
  };

  try {
    return extractResponseText(await postOpenAI("/responses", responsesBody));
  } catch (error) {
    if (error.status && error.status < 500 && !String(error.message).includes("text.format") && !String(error.message).includes("responses")) throw error;
    try {
      return extractResponseText(await postOpenAI("/responses", { ...responsesBody, text: { format: { type: "text" } } }));
    } catch (responsesError) {
      if (responsesError.status && responsesError.status < 500 && !String(responsesError.message).includes("responses")) throw responsesError;
      const chatBody = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.45,
      };
      const data = await postOpenAI("/chat/completions", chatBody);
      return data?.choices?.[0]?.message?.content || "";
    }
  }
}

async function callAnthropic(payload, config) {
  if (!config.apiKey) {
    const error = new Error("Missing ANTHROPIC_API_KEY, LLM_API_KEY, or ONE_API_KEY");
    error.status = 503;
    error.code = "missing_api_key";
    throw error;
  }

  const { systemPrompt, userPrompt } = buildPlaySpecPrompt(payload);
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2200,
      temperature: 0.45,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Anthropic request failed (${response.status})`);
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  return Array.isArray(data?.content)
    ? data.content.map((item) => item?.text || "").filter(Boolean).join("\n")
    : "";
}

async function callModel(payload) {
  const config = modelConfig();
  if (config.provider === "anthropic") return callAnthropic(payload, config);
  return callOpenAI(payload, config);
}

async function extractFileText(file) {
  const name = file.name || "upload";
  const ext = extname(name).toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error("File is too large");

  if (file.type.startsWith("text/") || [".txt", ".md", ".csv"].includes(ext)) {
    return new TextDecoder("utf-8").decode(buffer);
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  if (ext === ".pptx") {
    return extractPptxText(buffer);
  }

  if (ext === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`${ext || basename(name)} is not supported yet`);
}

async function handleExtractFile(req, res) {
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: "half",
  });
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    json(res, 400, { ok: false, error: "missing_file" });
    return;
  }

  const text = clipMaterialText(await extractFileText(file));
  json(res, 200, {
    ok: true,
    fileName: file.name || "upload",
    chars: text.length,
    text,
  });
}

async function handleGenerate(req, res) {
  const payload = await readJson(req);
  const mode = GAME_MODES.has(payload.mode) ? payload.mode : "cards";
  const content = clipMaterialText(payload.content);
  if (content.length < 8) {
    json(res, 400, { ok: false, error: "content_too_short" });
    return;
  }

  const config = modelConfig();
  let normalized;
  let qualityIssues = [];
  let source = "model";
  try {
    const modelText = await callModel({ ...payload, mode, content });
    normalized = normalizeModelOutput(extractJson(modelText), mode);
    qualityIssues = validateGeneratedQuality(normalized, content);
  } catch (error) {
    qualityIssues = [error.code || "model_generation_failed"];
  }

  if (!normalized || qualityIssues.length) {
    normalized = buildFallbackSpec(content, mode);
    source = "quality_fallback";
  }

  json(res, 200, {
    ok: true,
    source,
    provider: config.provider,
    model: config.model,
    quality: { issues: qualityIssues },
    ...normalized,
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendOptions(res);
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/api/agent-health") {
      const config = modelConfig();
      json(res, 200, {
        ok: true,
        hasKey: Boolean(config.apiKey),
        provider: config.provider,
        model: config.model,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/extract-file") {
      await handleExtractFile(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-play-spec") {
      await handleGenerate(req, res);
      return;
    }

    json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    const status = error.status || 500;
    json(res, status, {
      ok: false,
      error: error.code || "agent_error",
      message: error.message || "Agent server error",
    });
  }
});

server.listen(PORT, HOST, () => {
  const config = modelConfig();
  console.log(`[IntoPlay Agent] local: http://127.0.0.1:${PORT}`);
  for (const ip of localIPv4Addresses()) {
    console.log(`[IntoPlay Agent] network: http://${ip}:${PORT}`);
  }
  console.log(`[IntoPlay Agent] provider=${config.provider} model=${config.model} key=${config.apiKey ? "ready" : "missing"}`);
});
