import { isApiConfigured } from "../lib/card-service.mjs";
import { createSession, jsonResponse } from "../lib/http-security.mjs";
import { isRateLimitConfigured } from "../lib/rate-limit.mjs";

export default {
  fetch(request) {
    if (request.method !== "GET") {
      return jsonResponse({ error: "この操作は利用できません。" }, 405, { Allow: "GET" });
    }

    const session = createSession(request);
    const apiConfigured = isApiConfigured();
    const rateLimitConfigured = isRateLimitConfigured();
    return jsonResponse(
      {
        configured: apiConfigured && rateLimitConfigured,
        apiConfigured,
        rateLimitConfigured,
        csrfToken: session.token,
      },
      200,
      { "Set-Cookie": session.cookie },
    );
  },
};
