/**
 * What a model costs to run, and which of a few favourites costs least.
 *
 * OpenRouter sends each call to one provider of the model, picked at random and
 * favouring cheap ones: a provider at half the price gets 4 times the calls
 * (its documented rule). A call that asks for JSON goes only to providers that
 * take it, and only to those with no recent outage. So the price of a model is
 * the average over those providers, each weighted by the inverse square of its
 * price. That is what a call pays on average, with calls sent as they are.
 *
 * Prices are dollars per million tokens, for a call that reads 4 tokens for each
 * one it writes. A drop reads about 32,000 and writes 12,000; an answer and the
 * routing step read far more than they write. The list price OpenRouter shows
 * for a model is one provider's, so it is not used here.
 */

/** Tokens read for each token written. */
export const READ_PER_WRITE = 4;
/** Another favourite must be at least this much cheaper before the one running changes. */
export const SWITCH_AT = 0.1;
/** A provider counts as up with this much uptime over the last 30 minutes. */
export const UP_AT = 95;
/** Favourites in one list: each is one request a day. */
export const MAX_FAVS = 8;

export type Endpoint = {
  provider_name?: string;
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: string[];
  uptime_last_30m?: number | null;
};

/** One provider's price at the mix above, or null when it states none. */
export function blend(e: Endpoint): number | null {
  const read = Number(e?.pricing?.prompt) * 1e6, write = Number(e?.pricing?.completion) * 1e6;
  if (!Number.isFinite(read) || !Number.isFinite(write) || read < 0 || write < 0) return null;
  return (READ_PER_WRITE * read + write) / (READ_PER_WRITE + 1);
}

/**
 * A model's price: the average over its providers that take JSON and are up,
 * each weighted by the inverse square of its price. When none is up, those that
 * take JSON stand in. Null when none takes JSON.
 */
export function expectedPrice(endpoints: Endpoint[]): { price: number; providers: number } | null {
  const json = (Array.isArray(endpoints) ? endpoints : []).filter(e => (e?.supported_parameters ?? []).includes("response_format") && blend(e) !== null);
  const up = json.filter(e => e.uptime_last_30m == null || e.uptime_last_30m >= UP_AT);
  const use = up.length ? up : json;
  if (!use.length) return null;
  /* A free provider would weigh without end: a hundred-thousandth of a dollar keeps the sum finite. */
  const p = use.map(e => Math.max(blend(e) as number, 1e-5));
  const price = p.reduce((s, x) => s + 1 / x, 0) / p.reduce((s, x) => s + 1 / (x * x), 0);
  /* A millionth of a dollar per million tokens is as fine as a price needs to be, and keeps floating-point noise out of what is stored. */
  return { price: Math.round(price * 1e6) / 1e6, providers: use.length };
}

/**
 * The favourite that runs: the cheapest, unless the one running is within 10%
 * of it. A model not among the favourites, or without a price, gives way to the
 * cheapest at once. Equal prices keep the list's order.
 */
export function choose(current: string | null, prices: { id: string; price: number }[]): string | null {
  if (!prices.length) return null;
  const best = prices.reduce((b, x) => (x.price < b.price ? x : b), prices[0]);
  const now = prices.find(x => x.id === current);
  return now && best.price > now.price * (1 - SWITCH_AT) ? now.id : best.id;
}

export type Read = { id: string; price?: number; providers?: number; missing?: boolean; error?: string };

/** One model's price, from OpenRouter's public list of its providers. No key is needed. */
export async function readPrice(id: string): Promise<Read> {
  try {
    const r = await fetch(`https://openrouter.ai/api/v1/models/${id.split("/").map(encodeURIComponent).join("/")}/endpoints`, { signal: AbortSignal.timeout(20000) });
    if (r.status === 404) return { id, missing: true };
    if (!r.ok) return { id, error: `OpenRouter answered ${r.status}` };
    const got = expectedPrice(((await r.json()) as any)?.data?.endpoints ?? []);
    return got ? { id, ...got } : { id, error: "OpenRouter lists no provider of it that takes JSON" };
  } catch (e: any) {
    return { id, error: String(e?.message ?? e).slice(0, 120) };
  }
}

export const readPrices = (ids: string[]) => Promise.all(ids.map(readPrice));
