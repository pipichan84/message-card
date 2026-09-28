import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = "127.0.0.1";

loadEnvironment(join(ROOT, ".env"));

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const TEXT_MODEL = (process.env.OPENAI_TEXT_MODEL || "gpt-6-astra").trim();
const IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || "gpt-image-2").trim();
const SESSION_TOKEN = randomBytes(32).toString("hex");
let generationInProgress = false;

const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml; charset=utf-8"]],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);

    if (request.method === "GET" && PUBLIC_FILES.has(url.pathname)) {
      return servePublicFile(response, url.pathname);
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(
        response,
        200,
        { configured: Boolean(OPENAI_API_KEY), csrfToken: SESSION_TOKEN },
        { "Set-Cookie": `card_session=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Strict` },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      if (!isTrustedLocalRequest(request)) {
        return sendJson(response, 403, { error: "安全確認に失敗しました。ページを再読み込みしてください。" });
      }

      if (!OPENAI_API_KEY) {
        return sendJson(response, 503, { error: ".env にAPIキーを設定し、サーバーを再起動してください。" });
      }

      if (generationInProgress) {
        return sendJson(response, 429, { error: "現在、別のカードを作成中です。完了までお待ちください。" });
      }

      const body = await readJsonBody(request, 8_192);
      const keyword = normalizeText(body.keyword, 80);
      const recipient = normalizeText(body.recipient, 40);
      const mood = normalizeMood(body.mood);

      if (!keyword) {
        return sendJson(response, 400, { error: "キーワードを入力してください。" });
      }

      generationInProgress = true;
      try {
        const brief = await createCardBrief({ keyword, recipient, mood });
        const imageBase64 = await createIllustration(brief.illustrationPrompt);
        return sendJson(response, 200, {
          card: {
            title: brief.title,
            message: brief.message,
            imageAlt: brief.imageAlt,
            palette: brief.palette,
            imageDataUrl: `data:image/png;base64,${imageBase64}`,
          },
        });
      } catch (error) {
        const publicError = toPublicError(error);
        console.error(`[OpenAI request] ${publicError.logCode}`);
        return sendJson(response, publicError.status, { error: publicError.message });
      } finally {
        generationInProgress = false;
      }
    }

    sendJson(response, 404, { error: "ページが見つかりません。" });
  } catch (error) {
    const code = error?.code === "PAYLOAD_TOO_LARGE" ? 413 : 400;
    const message = code === 413 ? "入力が長すぎます。" : "リクエストを読み取れませんでした。";
    sendJson(response, code, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Message Card Studio is ready: http://${HOST}:${PORT}`);
  console.log(`API key: ${OPENAI_API_KEY ? "configured" : "not configured"}`);
});

function loadEnvironment(filePath) {
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function securityHeaders(contentType, cacheControl = "no-store") {
  return {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function servePublicFile(response, pathname) {
  const [filename, contentType] = PUBLIC_FILES.get(pathname);
  const body = readFileSync(join(PUBLIC_DIR, filename));
  response.writeHead(200, securityHeaders(contentType, pathname === "/" ? "no-store" : "public, max-age=300"));
  response.end(body);
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8"),
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function isTrustedLocalRequest(request) {
  const allowedOrigins = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
  const origin = request.headers.origin;
  const headerToken = request.headers["x-card-token"];
  const cookie = request.headers.cookie || "";
  return allowedOrigins.has(origin) && headerToken === SESSION_TOKEN && cookie.includes(`card_session=${SESSION_TOKEN}`);
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Payload too large");
        error.code = "PAYLOAD_TOO_LARGE";
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function normalizeMood(value) {
  const allowed = new Set(["おまかせ", "やさしい", "元気", "大人かわいい"]);
  return allowed.has(value) ? value : "おまかせ";
}

async function createCardBrief({ keyword, recipient, mood }) {
  const response = await openAIRequest("https://api.openai.com/v1/responses", {
    model: TEXT_MODEL,
    store: false,
    instructions: [
      "You are a Japanese message-card art director.",
      "Return a concise card brief in Japanese that feels personal, warm, and natural.",
      "The title must be 2-14 Japanese characters and the message 25-70 Japanese characters.",
      "Create a cute, original illustration concept that fits the keyword; never use copyrighted characters, logos, celebrities, or existing brands.",
      "The illustration prompt must be in English, describe a charming editorial illustration with one clear focal subject, rich color, and a clean quiet area for later typography.",
      "The generated illustration itself must contain no letters, words, numbers, signatures, logos, borders, frames, or watermarks.",
      "Use hex colors with sufficient contrast between background and ink.",
    ].join(" "),
    input: `キーワード: ${keyword}\n送る相手: ${recipient || "指定なし"}\n雰囲気: ${mood}`,
    max_output_tokens: 1200,
    text: {
      format: {
        type: "json_schema",
        name: "message_card_brief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            message: { type: "string" },
            imageAlt: { type: "string" },
            illustrationPrompt: { type: "string" },
            palette: {
              type: "object",
              additionalProperties: false,
              properties: {
                background: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
                accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
                ink: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
              },
              required: ["background", "accent", "ink"],
            },
          },
          required: ["title", "message", "imageAlt", "illustrationPrompt", "palette"],
        },
      },
    },
  }, "text");

  let brief;
  try {
    brief = parseStructuredResponse(response);
  } catch (error) {
    if (["TEXT_RESPONSE_INCOMPLETE", "INVALID_TEXT_RESPONSE", "CARD_BRIEF_PARSE_FAILED"].includes(error?.publicCode)) {
      console.warn(`[OpenAI text fallback] ${error.publicCode}`);
      return createFallbackBrief({ keyword, recipient, mood });
    }
    throw error;
  }

  return {
    title: normalizeText(brief.title, 28) || keyword,
    message: normalizeText(brief.message, 140) || `${keyword}の気持ちをこめて。`,
    imageAlt: normalizeText(brief.imageAlt, 100) || `${keyword}をテーマにしたイラスト`,
    illustrationPrompt: `${normalizeText(brief.illustrationPrompt, 1200)} No text, lettering, typography, numbers, signatures, logos, frames, or watermarks. Square composition.`,
    palette: {
      background: safeColor(brief.palette?.background, "#FFF4D6"),
      accent: safeColor(brief.palette?.accent, "#FF6B6B"),
      ink: safeColor(brief.palette?.ink, "#17324D"),
    },
  };
}

async function createIllustration(prompt) {
  const response = await openAIRequest("https://api.openai.com/v1/images/generations", {
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "medium",
    output_format: "png",
    background: "opaque",
    moderation: "auto",
  }, "image", 180_000);

  const imageBase64 = response?.data?.[0]?.b64_json;
  if (typeof imageBase64 !== "string" || imageBase64.length < 100) {
    const error = new Error("Image response missing");
    error.publicCode = "INVALID_IMAGE_RESPONSE";
    throw error;
  }
  return imageBase64;
}

async function openAIRequest(url, body, stage, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const requestId = response.headers.get("x-request-id") || "unavailable";
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("OpenAI request failed");
      error.status = response.status;
      error.openAICode = payload?.error?.code || payload?.error?.type || "unknown";
      error.requestId = requestId;
      error.stage = stage;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("OpenAI request timed out");
      timeoutError.status = 504;
      timeoutError.stage = stage;
      throw timeoutError;
    }
    if (!error?.status) {
      const connectionError = new Error("OpenAI connection failed");
      connectionError.status = 502;
      connectionError.stage = stage;
      connectionError.publicCode = "OPENAI_CONNECTION_FAILED";
      throw connectionError;
    }
    if (!error.stage) error.stage = stage;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractResponseText(response) {
  if (response?.status === "incomplete") {
    const error = new Error("Text response incomplete");
    error.publicCode = "TEXT_RESPONSE_INCOMPLETE";
    throw error;
  }

  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const textParts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") {
        const error = new Error("Text response refused");
        error.publicCode = "TEXT_RESPONSE_REFUSED";
        throw error;
      }
      if (content?.type === "output_text" && typeof content.text === "string") {
        textParts.push(content.text);
      }
    }
  }

  if (textParts.length > 0) return textParts.join("");
  const error = new Error("Text response missing");
  error.publicCode = "INVALID_TEXT_RESPONSE";
  throw error;
}

function parseStructuredResponse(response) {
  const rawText = extractResponseText(response).replace(/^\uFEFF/u, "").trim();
  const fencedMatch = rawText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const candidate = (fencedMatch?.[1] || rawText).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        // Fall through to a safe local card brief below.
      }
    }
    const error = new Error("Card brief JSON could not be parsed");
    error.publicCode = "CARD_BRIEF_PARSE_FAILED";
    throw error;
  }
}

function createFallbackBrief({ keyword, recipient, mood }) {
  const moodSettings = {
    "やさしい": { background: "#FFF4D6", accent: "#EF7B77", ink: "#17324D", style: "gentle, tender, soft watercolor and colored-pencil" },
    "元気": { background: "#FFF0A6", accent: "#FF5D5D", ink: "#10243E", style: "cheerful, energetic, colorful paper-cut" },
    "大人かわいい": { background: "#F7E8FF", accent: "#A94FAE", ink: "#26324A", style: "elegant yet cute, refined gouache editorial" },
    "おまかせ": { background: "#FFF1C6", accent: "#FF6B6B", ink: "#17324D", style: "warm, charming, playful editorial" },
  };
  const settings = moodSettings[mood] || moodSettings["おまかせ"];
  const shortKeyword = Array.from(keyword).slice(0, 14).join("");
  const title = shortKeyword || "心をこめて";
  const addressee = recipient ? `${recipient}へ。` : "";

  return {
    title,
    message: `${addressee}${keyword}の気持ちをこめて。これからの毎日にも、すてきな笑顔がたくさんありますように。`,
    imageAlt: `${keyword}をテーマにした、やさしくかわいいオリジナルイラスト`,
    illustrationPrompt: [
      `Create an original ${settings.style} illustration inspired by this Japanese theme: ${keyword}.`,
      "One clear lovable focal subject, delightful small details, rich harmonious color, and a clean quiet area for later typography.",
      "Do not imitate existing characters, artists, brands, or copyrighted properties.",
      "No text, lettering, typography, numbers, signatures, logos, frames, or watermarks. Square composition.",
    ].join(" "),
    palette: {
      background: settings.background,
      accent: settings.accent,
      ink: settings.ink,
    },
  };
}

function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

function toPublicError(error) {
  const status = Number(error?.status) || 500;
  const code = String(error?.openAICode || error?.publicCode || "unexpected_error");
  const requestId = String(error?.requestId || "none");
  const stage = String(error?.stage || "local");
  const logCode = `${stage} / HTTP ${status} / ${code} / request ${requestId}`;

  if (code === "TEXT_RESPONSE_REFUSED") {
    return { status: 400, message: "この内容ではメッセージを作成できませんでした。キーワードを短く、やわらかい表現に変えてお試しください。", logCode };
  }
  if (code === "OPENAI_CONNECTION_FAILED") {
    return { status: 502, message: "OpenAI APIへ接続できませんでした。インターネット接続、VPN、ファイアウォールを確認し、アプリを再起動してください。", logCode };
  }
  if (status === 401) {
    return { status: 502, message: "APIキーが正しくないか、すでに無効になっています。.env に新しいキーが1行だけ入っているか確認し、サーバーを再起動してください。", logCode };
  }
  if (status === 403) {
    return { status: 502, message: "このAPIキーには必要な権限がありません。OpenAI Platformで、キーを作成したProjectとモデルの利用権限を確認してください。", logCode };
  }
  if (["credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "insufficient_quota", "billing_hard_limit_reached"].includes(code)) {
    return { status: 503, message: "OpenAI APIの残高または利用上限に達しています。OpenAI PlatformのBilling（お支払い・クレジット）とLimits（利用上限）を確認してください。", logCode };
  }
  if (status === 429) {
    return { status: 503, message: "短時間にAPIを利用しすぎたため、一時的に待機が必要です。1分ほど待ってから、もう一度お試しください。", logCode };
  }
  if (code === "moderation_blocked") {
    return { status: 400, message: "このキーワードではイラストを作成できませんでした。表現をやわらかくしてお試しください。", logCode };
  }
  if (status === 504) {
    return { status: 504, message: "作成に時間がかかりすぎました。もう一度お試しください。", logCode };
  }
  if (status === 404 || code === "model_not_found") {
    return { status: 502, message: "このProjectでは使用モデルを利用できません。.env のモデル指定を削除するか、OpenAI Platformで利用可能なモデルを確認してください。", logCode };
  }
  if (status === 400 && stage === "image") {
    return { status: 502, message: "画像生成を開始できませんでした。GPT Imageの利用には、OpenAI PlatformでOrganization Verification（組織の確認）が必要な場合があります。", logCode };
  }
  if (status === 400) {
    return { status: 502, message: "AIへの送信内容を正しく処理できませんでした。アプリを再起動して、もう一度お試しください。", logCode };
  }
  if (code === "INVALID_IMAGE_RESPONSE") {
    return { status: 502, message: "画像データを受け取れませんでした。少し待ってから、もう一度お試しください。", logCode };
  }
  return { status: 502, message: "カードを作成できませんでした。設定とAPIの利用状況を確認してください。", logCode };
}
