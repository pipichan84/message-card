const DEFAULT_TEXT_MODEL = "gpt-6-astra";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

export function isApiConfigured() {
  return Boolean(getApiKey());
}

export async function createCard(input = {}) {
  const keyword = normalizeText(input.keyword, 80);
  const recipient = normalizeText(input.recipient, 40);
  const mood = normalizeMood(input.mood);

  if (!keyword) {
    const error = new Error("Keyword is required");
    error.status = 400;
    error.publicCode = "KEYWORD_REQUIRED";
    throw error;
  }

  if (!getApiKey()) {
    const error = new Error("OpenAI API key is missing");
    error.status = 503;
    error.publicCode = "OPENAI_API_KEY_MISSING";
    throw error;
  }

  const brief = await createCardBrief({ keyword, recipient, mood });
  const imageBase64 = await createIllustration(brief.illustrationPrompt);

  return {
    title: brief.title,
    message: brief.message,
    imageAlt: brief.imageAlt,
    palette: brief.palette,
    imageDataUrl: `data:image/webp;base64,${imageBase64}`,
  };
}

export function toPublicError(error) {
  const status = Number(error?.status) || 500;
  const code = String(error?.openAICode || error?.publicCode || "unexpected_error");
  const requestId = String(error?.requestId || "none");
  const stage = String(error?.stage || "local");
  const logCode = `${stage} / HTTP ${status} / ${code} / request ${requestId}`;

  if (code === "KEYWORD_REQUIRED") {
    return { status: 400, message: "キーワードを入力してください。", logCode };
  }
  if (code === "OPENAI_API_KEY_MISSING") {
    return {
      status: 503,
      message: "OPENAI_API_KEY が未設定です。Vercelの環境変数またはローカルの .env を設定してください。",
      logCode,
    };
  }
  if (code === "TEXT_RESPONSE_REFUSED") {
    return {
      status: 400,
      message: "この内容ではメッセージを作成できませんでした。キーワードを短く、やわらかい表現に変えてお試しください。",
      logCode,
    };
  }
  if (code === "OPENAI_CONNECTION_FAILED") {
    return {
      status: 502,
      message: "OpenAI APIへ接続できませんでした。ネットワーク設定を確認し、少し待ってからもう一度お試しください。",
      logCode,
    };
  }
  if (status === 401) {
    return {
      status: 502,
      message: "APIキーが正しくないか、すでに無効です。OPENAI_API_KEY を確認し、Vercelでは再デプロイ、ローカルではサーバー再起動を行ってください。",
      logCode,
    };
  }
  if (status === 403) {
    return {
      status: 502,
      message: "このAPIキーには必要な権限がありません。OpenAI PlatformでProjectとモデルの利用権限を確認してください。",
      logCode,
    };
  }
  if ([
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "insufficient_quota",
    "billing_hard_limit_reached",
  ].includes(code)) {
    return {
      status: 503,
      message: "OpenAI APIの残高または利用上限に達しています。OpenAI PlatformのBillingとLimitsを確認してください。",
      logCode,
    };
  }
  if (status === 429) {
    return {
      status: 503,
      message: "短時間にAPIを利用しすぎたため、一時的に待機が必要です。1分ほど待ってから、もう一度お試しください。",
      logCode,
    };
  }
  if (code === "moderation_blocked") {
    return {
      status: 400,
      message: "このキーワードではイラストを作成できませんでした。表現をやわらかくしてお試しください。",
      logCode,
    };
  }
  if (status === 504) {
    return { status: 504, message: "作成に時間がかかりすぎました。もう一度お試しください。", logCode };
  }
  if (status === 404 || code === "model_not_found") {
    return {
      status: 502,
      message: "このProjectでは使用モデルを利用できません。モデル設定またはOpenAI Platformの利用権限を確認してください。",
      logCode,
    };
  }
  if (status === 400 && stage === "image") {
    return {
      status: 502,
      message: "画像生成を開始できませんでした。GPT Imageの利用には、OpenAI PlatformでOrganization Verificationが必要な場合があります。",
      logCode,
    };
  }
  if (status === 400) {
    return {
      status: 502,
      message: "AIへの送信内容を正しく処理できませんでした。ページを再読み込みして、もう一度お試しください。",
      logCode,
    };
  }
  if (code === "INVALID_IMAGE_RESPONSE") {
    return { status: 502, message: "画像データを受け取れませんでした。少し待ってから、もう一度お試しください。", logCode };
  }
  return { status: 502, message: "カードを作成できませんでした。設定とAPIの利用状況を確認してください。", logCode };
}

async function createCardBrief({ keyword, recipient, mood }) {
  const response = await openAIRequest(
    "https://api.openai.com/v1/responses",
    {
      model: getTextModel(),
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
    },
    "text",
  );

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
  const response = await openAIRequest(
    "https://api.openai.com/v1/images/generations",
    {
      model: getImageModel(),
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      output_compression: 75,
      background: "opaque",
      moderation: "auto",
    },
    "image",
    180_000,
  );

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
        Authorization: `Bearer ${getApiKey()}`,
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
        // Fall through to the safe fallback below.
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

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function normalizeMood(value) {
  const allowed = new Set(["おまかせ", "やさしい", "元気", "大人かわいい"]);
  return allowed.has(value) ? value : "おまかせ";
}

function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

function getApiKey() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

function getTextModel() {
  return (process.env.OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL).trim();
}

function getImageModel() {
  return (process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim();
}
