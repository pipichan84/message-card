import assert from "node:assert/strict";
import test from "node:test";

import {
  checkGenerationRateLimit,
  GENERATION_LIMIT,
  isRateLimitConfigured,
  secondsUntilReset,
} from "../lib/rate-limit.mjs";

test("同じ利用者は3回まで許可し、4回目を拒否する", async () => {
  let count = 0;
  const identifiers = [];
  const reset = Date.now() + 60 * 60 * 1_000;
  const limiter = {
    async limit(identifier) {
      identifiers.push(identifier);
      count += 1;
      return {
        success: count <= GENERATION_LIMIT,
        limit: GENERATION_LIMIT,
        remaining: Math.max(0, GENERATION_LIMIT - count),
        reset,
      };
    },
  };

  const request = new Request("https://example.test/api/generate");
  const results = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    results.push(await checkGenerationRateLimit(request, {
      identifier: "203.0.113.10",
      limiter,
    }));
  }

  assert.deepEqual(results.map((result) => result.allowed), [true, true, true, false]);
  assert.equal(new Set(identifiers).size, 1);
  assert.match(identifiers[0], /^ip:[0-9a-f]{64}$/u);
  assert.equal(identifiers[0].includes("203.0.113.10"), false);
});

test("Redis接続はURLとトークンの両方がある場合だけ設定済みになる", () => {
  assert.equal(isRateLimitConfigured({}), false);
  assert.equal(isRateLimitConfigured({ UPSTASH_REDIS_REST_URL: "https://example.test" }), false);
  assert.equal(isRateLimitConfigured({
    UPSTASH_REDIS_REST_URL: "https://example.test",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
  }), true);
});

test("Retry-Afterは1秒未満にならない", () => {
  assert.equal(secondsUntilReset(10_500, 10_000), 1);
  assert.equal(secondsUntilReset(9_000, 10_000), 1);
  assert.equal(secondsUntilReset(13_500, 10_000), 4);
});
