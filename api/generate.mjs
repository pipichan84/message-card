import { createCard, isApiConfigured, toPublicError } from "../lib/card-service.mjs";
import { isTrustedSameOriginRequest, jsonResponse, readJsonBody } from "../lib/http-security.mjs";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "この操作は利用できません。" }, 405, { Allow: "POST" });
    }

    if (!isTrustedSameOriginRequest(request)) {
      return jsonResponse({ error: "安全確認に失敗しました。ページを再読み込みしてください。" }, 403);
    }

    if (!isApiConfigured()) {
      return jsonResponse(
        { error: "Vercelの環境変数 OPENAI_API_KEY を設定し、再デプロイしてください。" },
        503,
      );
    }

    try {
      const body = await readJsonBody(request);
      const card = await createCard(body);
      return jsonResponse({ card });
    } catch (error) {
      if (error?.publicCode === "PAYLOAD_TOO_LARGE") {
        return jsonResponse({ error: "入力が長すぎます。" }, 413);
      }
      if (error?.publicCode === "INVALID_JSON") {
        return jsonResponse({ error: "リクエストを読み取れませんでした。" }, 400);
      }

      const publicError = toPublicError(error);
      console.error(`[OpenAI request] ${publicError.logCode}`);
      return jsonResponse({ error: publicError.message }, publicError.status);
    }
  },
};
