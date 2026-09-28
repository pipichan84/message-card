const form = document.querySelector("#card-form");
const keywordInput = document.querySelector("#keyword");
const recipientInput = document.querySelector("#recipient");
const moodInput = document.querySelector("#mood");
const generateButton = document.querySelector("#generate-button");
const generateLabel = document.querySelector("#generate-label");
const formMessage = document.querySelector("#form-message");
const apiStatus = document.querySelector("#api-status");
const cardPreview = document.querySelector("#card-preview");
const cardImage = document.querySelector("#card-image");
const cardPlaceholder = document.querySelector("#card-placeholder");
const loadingArt = document.querySelector("#loading-art");
const cardTitle = document.querySelector("#card-title");
const cardMessage = document.querySelector("#card-message");
const editFields = document.querySelector("#edit-fields");
const editTitle = document.querySelector("#edit-title");
const editMessage = document.querySelector("#edit-message");
const downloadButton = document.querySelector("#download-button");

let csrfToken = "";
let apiConfigured = false;
let currentCard = null;

initialize();

async function initialize() {
  try {
    const response = await fetch("/api/status", { credentials: "same-origin", cache: "no-store" });
    const status = await response.json();
    csrfToken = status.csrfToken || "";
    apiConfigured = Boolean(status.configured);
    renderApiStatus();
  } catch {
    apiStatus.className = "status is-missing";
    apiStatus.lastElementChild.textContent = "サーバーに接続できません";
    generateButton.disabled = true;
  }
}

function renderApiStatus() {
  apiStatus.className = `status ${apiConfigured ? "is-ready" : "is-missing"}`;
  apiStatus.lastElementChild.textContent = apiConfigured ? "API設定済み" : "APIキー未設定";
  generateButton.disabled = !apiConfigured;
  if (!apiConfigured) {
    showMessage("サーバー側の環境変数 OPENAI_API_KEY を設定すると作成できます。", "info");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const keyword = keywordInput.value.trim();
  if (!keyword) {
    showMessage("キーワードを入力してください。");
    keywordInput.focus();
    return;
  }
  if (!apiConfigured || !csrfToken) {
    showMessage("サーバー側にAPIキーを設定し、ページを再読み込みしてください。");
    return;
  }

  setLoading(true);
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Card-Token": csrfToken,
      },
      body: JSON.stringify({
        keyword,
        recipient: recipientInput.value.trim(),
        mood: moodInput.value,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "カードを作成できませんでした。");
    renderCard(data.card);
    showMessage("カードができました。ことばは下の欄から編集できます。", "info");
  } catch (error) {
    showMessage(error.message || "カードを作成できませんでした。");
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  generateButton.disabled = isLoading || !apiConfigured;
  keywordInput.disabled = isLoading;
  recipientInput.disabled = isLoading;
  moodInput.disabled = isLoading;
  generateLabel.textContent = isLoading ? "ことばと絵を作成中…" : "カードを作る";
  loadingArt.hidden = !isLoading;
  if (isLoading) {
    cardPlaceholder.hidden = true;
    cardImage.hidden = true;
    showMessage("イラストの作成に1〜2分かかることがあります。", "info");
  } else if (!currentCard) {
    cardPlaceholder.hidden = false;
  }
}

function renderCard(card) {
  currentCard = card;
  cardImage.src = card.imageDataUrl;
  cardImage.alt = card.imageAlt || "生成されたカードイラスト";
  cardImage.hidden = false;
  cardPlaceholder.hidden = true;
  cardTitle.textContent = card.title;
  cardMessage.textContent = card.message;
  editTitle.value = card.title;
  editMessage.value = card.message;
  editFields.hidden = false;
  downloadButton.disabled = false;
  applyPalette(card.palette);
}

function applyPalette(palette = {}) {
  cardPreview.style.backgroundColor = safeColor(palette.background, "#FFF1C6");
  cardPreview.style.color = safeColor(palette.ink, "#152B42");
  cardPreview.style.boxShadow = `0 28px 75px rgba(6, 25, 45, 0.24), 12px 12px 0 ${safeColor(palette.accent, "#FFC83D")}`;
}

function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

editTitle.addEventListener("input", () => {
  if (!currentCard) return;
  currentCard.title = editTitle.value;
  cardTitle.textContent = editTitle.value || " ";
});

editMessage.addEventListener("input", () => {
  if (!currentCard) return;
  currentCard.message = editMessage.value;
  cardMessage.textContent = editMessage.value || " ";
});

downloadButton.addEventListener("click", async () => {
  if (!currentCard || !cardImage.src) return;
  downloadButton.disabled = true;
  const original = downloadButton.innerHTML;
  downloadButton.textContent = "作成中…";
  try {
    const blob = await drawCardPng();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `message-card-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  } catch {
    showMessage("画像の保存に失敗しました。");
  } finally {
    downloadButton.innerHTML = original;
    downloadButton.disabled = false;
  }
});

async function drawCardPng() {
  await cardImage.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 2000;
  const context = canvas.getContext("2d");
  const palette = currentCard.palette || {};
  const background = safeColor(palette.background, "#FFF1C6");
  const accent = safeColor(palette.accent, "#FF5D5D");
  const ink = safeColor(palette.ink, "#152B42");

  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const imageHeight = 1110;
  drawCoverImage(context, cardImage, 0, 0, canvas.width, imageHeight);

  context.fillStyle = background;
  context.beginPath();
  context.moveTo(0, 1060);
  for (let x = 0; x <= canvas.width; x += 160) {
    context.lineTo(x + 80, 1100);
    context.lineTo(x + 160, 1060);
  }
  context.lineTo(canvas.width, 1160);
  context.lineTo(0, 1160);
  context.closePath();
  context.fill();

  context.fillStyle = accent;
  context.fillRect(132, 1265, 92, 10);
  context.fillRect(1376, 1265, 92, 10);

  context.textAlign = "center";
  context.fillStyle = ink;
  context.font = '800 30px "Yu Gothic UI", "Noto Sans JP", sans-serif';
  context.globalAlpha = 0.62;
  context.fillText("FOR YOUR SPECIAL MOMENT", 800, 1240);
  context.globalAlpha = 1;

  context.font = '800 88px "Yu Gothic UI", "Noto Sans JP", sans-serif';
  drawWrappedText(context, currentCard.title || " ", 800, 1395, 1260, 112, 2);

  context.font = '500 43px "Yu Gothic UI", "Noto Sans JP", sans-serif';
  drawWrappedText(context, currentCard.message || " ", 800, 1625, 1120, 76, 4);

  context.globalAlpha = 0.55;
  context.font = '800 25px "Yu Gothic UI", sans-serif';
  context.fillText("MADE WITH CARE", 800, 1910);
  context.globalAlpha = 1;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))), "image/png");
  });
}

function drawCoverImage(context, image, x, y, width, height) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  if (imageRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawWrappedText(context, text, centerX, startY, maxWidth, lineHeight, maxLines) {
  const characters = Array.from(text);
  const lines = [];
  let line = "";
  for (const character of characters) {
    const candidate = line + character;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = character;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  const consumed = lines.join("").length;
  const remainder = characters.slice(consumed).join("");
  if (remainder) lines.push(remainder);
  lines.slice(0, maxLines).forEach((value, index) => {
    let output = value;
    if (index === maxLines - 1 && lines.length > maxLines && !output.endsWith("…")) output = `${output.slice(0, -1)}…`;
    context.fillText(output, centerX, startY + index * lineHeight, maxWidth);
  });
}

function showMessage(message, type = "error") {
  formMessage.textContent = message;
  formMessage.className = `form-message${type === "info" ? " is-info" : ""}`;
}
