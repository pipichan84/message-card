import { randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "card_session";

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

export function createSession(request) {
  const token = randomBytes(32).toString("hex");
  const secure = new URL(request.url).protocol === "https:";
  const attributes = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=3600",
  ];
  if (secure) attributes.push("Secure");
  return { token, cookie: attributes.join("; ") };
}

export function isTrustedSameOriginRequest(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const headerToken = request.headers.get("x-card-token") || "";
  const cookieToken = readCookie(request.headers.get("cookie") || "", COOKIE_NAME);

  return origin === requestOrigin && safeEqual(headerToken, cookieToken);
}

export async function readJsonBody(request, maxBytes = 8_192) {
  const declaredSize = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    const error = new Error("Payload too large");
    error.publicCode = "PAYLOAD_TOO_LARGE";
    throw error;
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    const error = new Error("Payload too large");
    error.publicCode = "PAYLOAD_TOO_LARGE";
    throw error;
  }

  try {
    return JSON.parse(text || "{}");
  } catch {
    const error = new Error("Invalid JSON");
    error.publicCode = "INVALID_JSON";
    throw error;
  }
}

function readCookie(cookieHeader, name) {
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const key = entry.slice(0, separator).trim();
    if (key === name) return entry.slice(separator + 1).trim();
  }
  return "";
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
