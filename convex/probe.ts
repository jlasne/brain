/**
 * A probe, not a feature. It makes ONE model call with nothing else attached:
 * no brain, no chunking, no JSON parsing. Its only job is to say whether this
 * deployment can reach the model at all, and how long that takes.
 *
 *     npx convex run probe:tiny --prod
 *     npx convex run probe:budget --prod
 *     npx convex run probe:real --prod
 *
 * CLI only, under your deploy key, so no passphrase and no browser reach.
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { MODEL } from "./lib";

type Result = {
  label: string;
  ok: boolean;
  ms: number;
  status?: number;
  finish?: string;
  usage?: unknown;
  replyChars?: number;
  reply?: string;
  error?: string;
};

/** One raw call. Every argument that could be the culprit is a parameter. */
async function call(opts: {
  label: string;
  prompt: string;
  maxTokens: number;
  jsonMode: boolean;
  model?: string;
}): Promise<Result> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { label: opts.label, ok: false, ms: 0, error: "OPENROUTER_API_KEY is not set" };

  const body: Record<string, unknown> = {
    model: opts.model ?? MODEL,
    messages: [{ role: "user", content: opts.prompt }],
    max_tokens: opts.maxTokens,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const t0 = Date.now();
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://octopus.jeremylasne.com",
        "X-Title": "Octopus probe",
      },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    const raw = await r.text();

    if (!r.ok) {
      return { label: opts.label, ok: false, ms, status: r.status, error: raw.slice(0, 400) };
    }
    const d = JSON.parse(raw);
    const choice = d?.choices?.[0];
    const reply: string = choice?.message?.content ?? "";
    return {
      label: opts.label,
      ok: true,
      ms,
      status: r.status,
      finish: choice?.finish_reason ?? choice?.native_finish_reason ?? "",
      usage: d?.usage ?? null,
      replyChars: reply.length,
      reply: reply.slice(0, 220),
    };
  } catch (e: any) {
    return { label: opts.label, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 400) };
  }
}

/**
 * Step 1. Four calls, each changing one thing, so the first failure names the cause.
 *
 *   plain      no json mode, tiny budget   -> can this deployment reach the model
 *   jsonmode   json mode on, tiny budget   -> is response_format supported
 *   bigbudget  json mode on, 24000 budget  -> is the budget over the model's ceiling
 *   claude     a second model, json mode   -> is the model or the wiring at fault
 */
export const tiny = internalAction({
  args: {},
  handler: async (): Promise<{ model: string; results: Result[] }> => {
    const results: Result[] = [];
    results.push(await call({
      label: "plain · no json mode · 100 tokens",
      prompt: "Reply with exactly: hello",
      maxTokens: 100, jsonMode: false,
    }));
    results.push(await call({
      label: "jsonmode · json mode on · 100 tokens",
      prompt: 'Reply with only this JSON: {"ok":true}',
      maxTokens: 100, jsonMode: true,
    }));
    results.push(await call({
      label: "bigbudget · json mode on · 24000 tokens",
      prompt: 'Reply with only this JSON: {"ok":true}',
      maxTokens: 24000, jsonMode: true,
    }));
    results.push(await call({
      label: "claude · a different model · json mode on",
      prompt: 'Reply with only this JSON: {"ok":true}',
      maxTokens: 100, jsonMode: true,
      model: "anthropic/claude-haiku-4.5",
    }));
    return { model: MODEL, results };
  },
});

/** Step 2. How the budget alone affects latency, at a fixed small input. */
export const budget = internalAction({
  args: {},
  handler: async (): Promise<{ model: string; results: Result[] }> => {
    const results: Result[] = [];
    for (const maxTokens of [500, 4000, 12000, 24000]) {
      results.push(await call({
        label: `budget ${maxTokens}`,
        prompt: 'Reply with only this JSON: {"ok":true}',
        maxTokens, jsonMode: true,
      }));
    }
    return { model: MODEL, results };
  },
});

/** Step 3. The real shape of work: a synthetic transcript at the sizes the app sends. */
export const real = internalAction({
  args: { chars: v.optional(v.number()) },
  handler: async (_ctx, a): Promise<{ model: string; results: Result[] }> => {
    const unit =
      "Le risque et le danger sont deux axes distincts en finance. La volatilite mesure le " +
      "mouvement, le danger mesure la probabilite d'aller a zero. Un actif peut etre calme et " +
      "mortel, ou violent et sans danger. Le dollar imprime environ 8 pour cent par an. ";
    const want = a.chars ?? 18000;
    let body = "";
    while (body.length < want) body += unit;
    body = body.slice(0, want);

    const prompt =
`Extract everything worth keeping from this source. Cover EVERY topic present.
Write every field in English. Reply with only JSON:
{"title":"","author":"","date":"","topics":[{"topic":"","ideas":[""],"data":[""]}],"quotes":[{"text":"","speaker":""}],"thin":[""]}

SOURCE:
${body}`;

    const results: Result[] = [];
    results.push(await call({
      label: `real ${want} chars · json mode · 24000 tokens`,
      prompt, maxTokens: 24000, jsonMode: true,
    }));
    results.push(await call({
      label: `real ${want} chars · json mode · 8000 tokens`,
      prompt, maxTokens: 8000, jsonMode: true,
    }));
    results.push(await call({
      label: `real ${want} chars · NO json mode · 24000 tokens`,
      prompt, maxTokens: 24000, jsonMode: false,
    }));
    return { model: MODEL, results };
  },
});
