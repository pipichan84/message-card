import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ipAddress } from "@vercel/functions";

export const GENERATION_LIMIT = 3;
export const GENERATION_WINDOW = "1 h";
export const RATE_LIMIT_MESSAGE =
  "利用回数の上限に達しました。しばらくしてからもう一度お試しください。";

let sharedLimiter;

export function isRateLimitConfigured(environment = process.env) {
  return Boolean(
    String(environment.UPSTASH_REDIS_REST_URL || "").trim()
      && String(environment.UPSTASH_REDIS_REST_TOKEN || "").trim(),
  );
}

export async function checkGenerationRateLimit(request, options = {}) {
  const rawIdentifier = options.identifier || getClientAddress(request);
  if (!rawIdentifier) {
    throw createUnavailableError("CLIENT_ADDRESS_UNAVAILABLE");
  }

  const limiter = options.limiter || getSharedLimiter();
  const identifier = `ip:${hashIdentifier(rawIdentifier)}`;
  const result = await limiter.limit(identifier);

  return {
    allowed: Boolean(result.success),
    limit: Number(result.limit) || GENERATION_LIMIT,
    remaining: Math.max(0, Number(result.remaining) || 0),
    reset: Number(result.reset) || Date.now() + 60 * 60 * 1_000,
  };
}

export function secondsUntilReset(resetAt, now = Date.now()) {
  return Math.max(1, Math.ceil((Number(resetAt) - now) / 1_000));
}

function getSharedLimiter() {
  if (!isRateLimitConfigured()) {
    throw createUnavailableError("UPSTASH_NOT_CONFIGURED");
  }

  if (!sharedLimiter) {
    sharedLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(GENERATION_LIMIT, GENERATION_WINDOW),
      analytics: false,
      prefix: "message-card:generate",
    });
  }

  return sharedLimiter;
}

function getClientAddress(request) {
  try {
    return ipAddress(request) || "";
  } catch {
    return "";
  }
}

function hashIdentifier(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function createUnavailableError(code) {
  const error = new Error("Rate limit service unavailable");
  error.publicCode = code;
  return error;
}
