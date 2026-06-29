import { readFileSync } from "node:fs";

const content = readFileSync(new URL("../artifacts/english-vocab-mini.txt", import.meta.url), "utf8");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 60_000);

try {
  const response = await fetch("http://127.0.0.1:8787/api/generate-play-spec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "survivor",
      material: "notes",
      fileName: "english-vocab-mini.txt",
      content,
    }),
    signal: controller.signal,
  });
  const payload = await response.json();
  const stages = payload?.spec?.stages || [];
  const text = JSON.stringify(stages);
  const terms = ["resilient", "concise", "inevitable", "reluctant", "collaborate", "skeptical", "deliberate", "outcome"];
  const badPatterns = [
    /用户答错/i,
    /系统应该纠正/i,
    /混淆English/i,
    /[“「](English|Meaning|Example)[”」]/i,
    /^and without/i,
    /\.{3,}/,
  ];
  const badStages = stages.filter((stage) => {
    const stageText = [stage.prompt, stage.trap, stage.feedback, ...(stage.choices || [])].join(" ");
    return badPatterns.some((pattern) => pattern.test(stageText));
  });
  const matchedTerms = terms.filter((term) => new RegExp(term, "i").test(text));

  const summary = {
    ok: payload?.ok === true,
    source: payload?.source,
    stageCount: stages.length,
    badStageCount: badStages.length,
    matchedTerms,
    prompts: stages.slice(0, 4).map((stage) => stage.prompt),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok || stages.length < 6 || badStages.length > 0 || matchedTerms.length < 6) {
    process.exitCode = 1;
  }
} finally {
  clearTimeout(timer);
}
