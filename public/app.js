const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const promptEl = document.getElementById("prompt");
const submitButtonEl = document.getElementById("submit-button");
const templateEl = document.getElementById("message-template");
const suggestionsEl = document.getElementById("suggestions");
const shareButtonEl = document.getElementById("share-button");
const newChatButtonEl = document.getElementById("new-chat-button");
const actionsMenuButtonEl = document.getElementById("actions-menu-button");
const actionsMenuEl = document.getElementById("actions-menu");
const menuShareButtonEl = document.getElementById("menu-share-button");
const menuNewChatButtonEl = document.getElementById("menu-new-chat-button");
const conversationMetaEl = document.getElementById("conversation-meta");
const consoleTriggerTitleEl = document.getElementById("console-trigger-title");
const commandConsoleEl = document.getElementById("command-console");
const consoleBackdropEl = document.getElementById("console-backdrop");
const consoleFormEl = document.getElementById("console-form");
const consoleInputEl = document.getElementById("console-input");
const consoleLogEl = document.getElementById("console-log");
const consoleLineTemplateEl = document.getElementById("console-line-template");

const storageKey = "music-book-current-conversation";
const consoleTokenKey = "music-book-console-token";
const consoleHistoryKey = "music-book-console-history";
const maxConsoleHistoryEntries = 100;
const consoleTapThresholdMs = 4500;
const consoleTapCountToOpen = 10;
let currentConversation = null;
let isPending = false;
let consoleLocked = false;
let consoleToken = sessionStorage.getItem(consoleTokenKey) || "";
let consoleHistory = loadConsoleHistory();
let consoleHistoryIndex = consoleHistory.length;
let consoleDraftValue = "";
let consoleTapCount = 0;
let consoleTapStartedAt = 0;

function loadConsoleHistory() {
  try {
    const raw = localStorage.getItem(consoleHistoryKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : [];
  } catch {
    return [];
  }
}

function saveConsoleHistory() {
  localStorage.setItem(consoleHistoryKey, JSON.stringify(consoleHistory));
}

function resetConsoleHistoryNavigation() {
  consoleHistoryIndex = consoleHistory.length;
  consoleDraftValue = "";
}

function rememberConsoleCommand(command) {
  if (!command) {
    return;
  }

  const lastCommand = consoleHistory[consoleHistory.length - 1];
  if (lastCommand !== command) {
    consoleHistory.push(command);
    if (consoleHistory.length > maxConsoleHistoryEntries) {
      consoleHistory = consoleHistory.slice(-maxConsoleHistoryEntries);
    }
    saveConsoleHistory();
  }

  resetConsoleHistoryNavigation();
}

function clearConsoleHistory() {
  consoleHistory = [];
  saveConsoleHistory();
  resetConsoleHistoryNavigation();
}

function applyConsoleHistory(step) {
  if (!consoleHistory.length) {
    return;
  }

  if (consoleHistoryIndex === consoleHistory.length) {
    consoleDraftValue = consoleInputEl.value;
  }

  if (step < 0) {
    consoleHistoryIndex = Math.max(0, consoleHistoryIndex - 1);
    consoleInputEl.value = consoleHistory[consoleHistoryIndex] || "";
    return;
  }

  consoleHistoryIndex = Math.min(consoleHistory.length, consoleHistoryIndex + 1);
  if (consoleHistoryIndex === consoleHistory.length) {
    consoleInputEl.value = consoleDraftValue;
    return;
  }

  consoleInputEl.value = consoleHistory[consoleHistoryIndex] || "";
}

function registerConsoleTriggerTap() {
  const now = Date.now();
  if (!consoleTapStartedAt || now - consoleTapStartedAt > consoleTapThresholdMs) {
    consoleTapStartedAt = now;
    consoleTapCount = 0;
  }

  consoleTapCount += 1;

  if (consoleTapCount >= consoleTapCountToOpen) {
    consoleTapCount = 0;
    consoleTapStartedAt = 0;
    if (commandConsoleEl.classList.contains("hidden")) {
      openConsole();
    } else {
      closeConsole();
    }
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function focusWithoutScroll(element) {
  if (!element) {
    return;
  }

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function scrollMessagesToBottom(behavior = "auto") {
  if (!messagesEl) {
    return;
  }

  messagesEl.scrollTo({
    top: messagesEl.scrollHeight,
    behavior
  });
}

function renderInlineAssistantContent(value) {
  return value
    .replace(/\[(https?:\/\/[^\]\s]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(?<!["'/>])(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(>])((?:music-book\.me|gpt\.music-book\.me|rodion\.pro|anna\.ladyzenko\.ru|ladyzenko\.ru)(?:\/[^\s<]*)?)/g, '$1<a href="https://$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}



function renderAssistantContent(content) {
  const escaped = escapeHtml(content);
  const lines = escaped.split(/\r?\n/);
  const parts = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    parts.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    const formatted = renderInlineAssistantContent(line);

    if (bulletMatch) {
      listItems.push(renderInlineAssistantContent(bulletMatch[1]));
      continue;
    }

    flushList();
    parts.push(`<p>${formatted}</p>`);
  }

  flushList();
  return parts.join("") || `<p>${escaped}</p>`;
}

function addMessage(role, content) {
  const fragment = templateEl.content.cloneNode(true);
  const messageEl = fragment.querySelector(".message");
  const roleEl = fragment.querySelector(".role");
  const bubbleEl = fragment.querySelector(".bubble");

  messageEl.dataset.role = role;
  roleEl.textContent = role === "assistant" ? "Music Book GPT" : "Вы";
  if (role === "assistant") {
    bubbleEl.innerHTML = renderAssistantContent(content);
  } else {
    bubbleEl.textContent = content;
  }

  messagesEl.appendChild(fragment);
  scrollMessagesToBottom(role === "assistant" ? "smooth" : "auto");
}

function renderConversation(conversation) {
  messagesEl.innerHTML = "";
  currentConversation = conversation;

  if (!conversation || !Array.isArray(conversation.messages) || !conversation.messages.length) {
    addMessage(
      "assistant",
      "Привет! Это чат-помощник music-book.me. Здесь можно спросить о книгах, ссылках на страницы книг, покупке, ценах, доставке, самовывозе, Романе и о самом проекте."
    );
  } else {
    for (const message of conversation.messages) {
      addMessage(message.role, message.content);
    }
  }

  updateConversationMeta();
}

function updateConversationMeta() {
  if (!currentConversation || !currentConversation.id) {
    conversationMetaEl.textContent = "Диалог ещё не сохранён";
    return;
  }

  const title = currentConversation.title || "Диалог";
  const count = currentConversation.messageCount ?? currentConversation.messages?.length ?? 0;
  conversationMetaEl.textContent = `${title} • ${count} сообщений`;
}

function updateUrlForConversation(conversationId) {
  const url = new URL(window.location.href);
  if (conversationId) {
    url.searchParams.set("c", conversationId);
    localStorage.setItem(storageKey, conversationId);
  } else {
    url.searchParams.delete("c");
    localStorage.removeItem(storageKey);
  }
  window.history.replaceState({}, "", url);
}

function setPending(nextPending) {
  isPending = nextPending;
  submitButtonEl.disabled = nextPending;
  promptEl.disabled = nextPending;
  shareButtonEl.disabled = nextPending;
  newChatButtonEl.disabled = nextPending;
  if (actionsMenuButtonEl) {
    actionsMenuButtonEl.disabled = nextPending;
  }
  if (menuShareButtonEl) {
    menuShareButtonEl.disabled = nextPending;
  }
  if (menuNewChatButtonEl) {
    menuNewChatButtonEl.disabled = nextPending;
  }
  submitButtonEl.textContent = nextPending ? "Думаю..." : "Отправить";

  for (const button of suggestionsEl.querySelectorAll("button")) {
    button.disabled = nextPending;
  }
}

function addConsoleLine(label, text) {
  const fragment = consoleLineTemplateEl.content.cloneNode(true);
  fragment.querySelector(".console-line__label").textContent = label;
  fragment.querySelector(".console-line__text").textContent = text;
  consoleLogEl.appendChild(fragment);
  consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
}

function openConsole() {
  commandConsoleEl.classList.remove("hidden");
  commandConsoleEl.setAttribute("aria-hidden", "false");
  resetConsoleHistoryNavigation();
  closeActionsMenu();
  focusWithoutScroll(consoleInputEl);
}

function closeConsole() {
  commandConsoleEl.classList.add("hidden");
  commandConsoleEl.setAttribute("aria-hidden", "true");
  focusWithoutScroll(promptEl);
}

function openActionsMenu() {
  actionsMenuEl?.classList.remove("hidden");
  actionsMenuButtonEl?.setAttribute("aria-expanded", "true");
}

function closeActionsMenu() {
  actionsMenuEl?.classList.add("hidden");
  actionsMenuButtonEl?.setAttribute("aria-expanded", "false");
}

function toggleActionsMenu() {
  if (!actionsMenuEl || !actionsMenuButtonEl) {
    return;
  }

  if (actionsMenuEl.classList.contains("hidden")) {
    openActionsMenu();
  } else {
    closeActionsMenu();
  }
}

async function copyShareLink() {
  if (!currentConversation?.id) {
    addConsoleLine("system", "Сначала отправь хотя бы одно сообщение, чтобы появился share-link.");
    return;
  }

  const shareUrl = `${window.location.origin}${window.location.pathname}?c=${currentConversation.id}`;
  await navigator.clipboard.writeText(shareUrl);
  addConsoleLine("system", `Ссылка скопирована: ${shareUrl}`);
}

function startNewChat() {
  currentConversation = null;
  updateUrlForConversation("");
  renderConversation(null);
  closeActionsMenu();
}

function consoleHeaders() {
  return consoleToken ? { Authorization: `Bearer ${consoleToken}` } : {};
}

async function createConversation(modelOverride = "") {
  const response = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelOverride })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Не удалось создать диалог");
  }

  currentConversation = data;
  updateUrlForConversation(data.id);
  updateConversationMeta();
  return data;
}

async function loadConversation(conversationId) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Не удалось загрузить диалог");
  }
  currentConversation = data;
  updateUrlForConversation(data.id);
  renderConversation(data);
  return data;
}

async function listConversations(options = {}) {
  const url = new URL("/api/conversations", window.location.origin);
  if (typeof options.search === "string" && options.search.trim()) {
    url.searchParams.set("search", options.search.trim());
  }

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Не удалось получить список диалогов");
  }
  return Array.isArray(data.conversations) ? data.conversations : [];
}

async function patchConversation(patch) {
  if (!currentConversation?.id) {
    await createConversation();
  }

  const response = await fetch(`/api/conversations/${encodeURIComponent(currentConversation.id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...consoleHeaders()
    },
    body: JSON.stringify(patch)
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      consoleLocked = true;
    }
    throw new Error(data.error || "Не удалось обновить диалог");
  }

  currentConversation = data;
  updateConversationMeta();
  return data;
}

async function patchConversationById(conversationId, patch) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...consoleHeaders()
    },
    body: JSON.stringify(patch)
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      consoleLocked = true;
    }
    throw new Error(data.error || "Не удалось обновить диалог");
  }

  if (currentConversation?.id === data.id) {
    currentConversation = data;
    updateConversationMeta();
  }

  return data;
}

async function deleteConversationById(conversationId) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    headers: {
      ...consoleHeaders()
    }
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      consoleLocked = true;
    }
    throw new Error(data.error || "Не удалось удалить диалог");
  }

  if (currentConversation?.id === conversationId) {
    currentConversation = null;
    updateUrlForConversation("");
    renderConversation(null);
  }

  return data;
}

async function unlockConsole(password) {
  const response = await fetch("/api/console/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Не удалось разблокировать консоль");
  }
  consoleLocked = false;
  consoleToken = data.token || "";
  if (consoleToken) {
    sessionStorage.setItem(consoleTokenKey, consoleToken);
  }
  addConsoleLine("system", "Консоль разблокирована.");
}

async function checkHealth() {
  const consoleResponse = await fetch("/api/console/config");
  const consoleConfig = await consoleResponse.json();
  consoleLocked = Boolean(consoleConfig.locked);
}

async function submitPrompt(prompt) {
  if (!prompt.trim()) {
    return;
  }

  setPending(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: currentConversation?.id || "",
        modelOverride: currentConversation?.modelOverride || "",
        message: prompt
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Не удалось получить ответ");
    }

    currentConversation = data.conversation;
    updateUrlForConversation(currentConversation.id);
    renderConversation(currentConversation);
    promptEl.value = "";
  } catch (error) {
    addMessage(
      "assistant",
      `Пока не получилось получить ответ: ${error.message}. Попробуй переформулировать вопрос чуть короче.`
    );
  } finally {
    setPending(false);
    focusWithoutScroll(promptEl);
  }
}

async function runCommand(rawCommand) {
  const command = rawCommand.trim();
  if (!command) {
    return;
  }

  rememberConsoleCommand(command);
  addConsoleLine("~", command);

  if (consoleLocked && !command.startsWith("unlock ")) {
    addConsoleLine("system", "Консоль заблокирована. Введи: unlock <пароль>");
    return;
  }

  if (command.startsWith("unlock ")) {
    const password = command.slice(7).trim();
    if (!password) {
      addConsoleLine("system", "После unlock нужно указать пароль.");
      return;
    }
    await unlockConsole(password);
    return;
  }

  if (command === "help") {
    addConsoleLine(
      "system",
      "help | history | history clear | dialogs | dialogs last | dialogs last <число> | dialogs first | dialogs first <число> | dialogs all | dialogs <число> | dialogs <поиск> | dialogs \"<фраза>\" | load <id> | rename <current|id> <новое имя> | delete <current|id> | model | model <id> | share | new | clear | test <текст> | ping"
    );
    return;
  }

  if (command === "history") {
    if (!consoleHistory.length) {
      addConsoleLine("system", "История команд пока пуста.");
      return;
    }

    addConsoleLine("system", `История команд: ${consoleHistory.length}. Показываю последние ${Math.min(consoleHistory.length, 20)}.`);
    const entries = consoleHistory.slice(-20);
    entries.forEach((entry, index) => {
      const number = consoleHistory.length - entries.length + index + 1;
      addConsoleLine("history", `${number}. ${entry}`);
    });
    return;
  }

  if (command === "history clear") {
    clearConsoleHistory();
    addConsoleLine("system", "История команд очищена.");
    return;
  }

  if (command === "dialogs" || command.startsWith("dialogs ")) {
    const rawArgument = command === "dialogs" ? "" : command.slice(8).trim();
    const normalizedArgument = rawArgument.toLowerCase();
    const argumentParts = rawArgument.split(/\s+/).filter(Boolean);
    const quotedSearchMatch = rawArgument.match(/^"(.*)"$/);
    let query = "";
    let contentSearch = "";
    let dialogsToShow = 12;
    let pickMode = "last";
    let modeLabel = `последние ${dialogsToShow}`;

    if (quotedSearchMatch) {
      contentSearch = quotedSearchMatch[1].trim();
      pickMode = "all";
      dialogsToShow = Infinity;
      modeLabel = "все";
    } else if (!rawArgument || normalizedArgument === "last") {
      dialogsToShow = 12;
      modeLabel = `последние ${dialogsToShow}`;
    } else if (argumentParts.length === 2 && argumentParts[0].toLowerCase() === "last" && /^\d+$/.test(argumentParts[1])) {
      dialogsToShow = Math.max(1, Number.parseInt(argumentParts[1], 10));
      pickMode = "last";
      modeLabel = `последние ${dialogsToShow}`;
    } else if (normalizedArgument === "first") {
      dialogsToShow = 12;
      pickMode = "first";
      modeLabel = `первые ${dialogsToShow}`;
    } else if (argumentParts.length === 2 && argumentParts[0].toLowerCase() === "first" && /^\d+$/.test(argumentParts[1])) {
      dialogsToShow = Math.max(1, Number.parseInt(argumentParts[1], 10));
      pickMode = "first";
      modeLabel = `первые ${dialogsToShow}`;
    } else if (normalizedArgument === "all") {
      dialogsToShow = Infinity;
      pickMode = "all";
      modeLabel = "все";
    } else if (/^\d+$/.test(rawArgument)) {
      dialogsToShow = Math.max(1, Number.parseInt(rawArgument, 10));
      pickMode = "last";
      modeLabel = `последние ${dialogsToShow}`;
    } else {
      query = normalizedArgument;
    }

    const conversations = await listConversations({ search: contentSearch });
    const filtered = query
      ? conversations.filter((conversation) => {
          const haystack = [
            conversation.id,
            conversation.title,
            conversation.modelOverride,
            conversation.createdAt,
            conversation.updatedAt
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : conversations;

    if (!filtered.length) {
      if (contentSearch) {
        addConsoleLine("system", `Диалоги с фразой "${contentSearch}" не найдены.`);
      } else {
        addConsoleLine("system", query ? `Диалоги по запросу "${query}" не найдены.` : "Сохранённых диалогов пока нет.");
      }
      return;
    }

    const visibleConversations =
      pickMode === "first" ? filtered.slice(0, dialogsToShow) : pickMode === "all" ? filtered : filtered.slice(-dialogsToShow);

    addConsoleLine(
      "system",
      contentSearch
        ? `Найдено диалогов с фразой "${contentSearch}": ${filtered.length}.`
        : `Найдено диалогов: ${filtered.length}. Показываю ${modeLabel === "все" ? "все" : modeLabel.replace(String(dialogsToShow), String(Math.min(filtered.length, dialogsToShow)))}.`
    );
    for (const conversation of visibleConversations) {
      const model = conversation.modelOverride || "default";
      addConsoleLine(
        "dialog",
        `${conversation.id} | ${conversation.title} | ${conversation.messageCount} msg | ${model} | ${conversation.updatedAt}`
      );
    }
    addConsoleLine("system", "Чтобы открыть диалог, введи: load <id>");
    return;
  }

  if (command.startsWith("load ")) {
    const conversationId = command.slice(5).trim();
    if (!conversationId) {
      addConsoleLine("system", "После load нужно указать id диалога.");
      return;
    }
    const conversation = await loadConversation(conversationId);
    addConsoleLine("system", `Загружен диалог: ${conversation.title} (${conversation.id})`);
    return;
  }

  if (command.startsWith("rename ")) {
    const payload = command.slice(7).trim();
    const firstSpaceIndex = payload.indexOf(" ");
    if (firstSpaceIndex === -1) {
      addConsoleLine("system", "Используй: rename <current|id> <новое имя>");
      return;
    }

    const target = payload.slice(0, firstSpaceIndex).trim();
    const nextTitle = payload.slice(firstSpaceIndex + 1).trim();
    if (!nextTitle) {
      addConsoleLine("system", "После id нужно указать новое имя диалога.");
      return;
    }

    const conversationId = target === "current" ? currentConversation?.id || "" : target;
    if (!conversationId) {
      addConsoleLine("system", "Сейчас нет открытого диалога. Укажи конкретный id.");
      return;
    }

    const conversation = await patchConversationById(conversationId, { title: nextTitle });
    addConsoleLine("system", `Диалог переименован: ${conversation.title} (${conversation.id})`);
    return;
  }

  if (command.startsWith("delete ")) {
    const target = command.slice(7).trim();
    const conversationId = target === "current" ? currentConversation?.id || "" : target;
    if (!conversationId) {
      addConsoleLine("system", "Используй: delete <current|id>");
      return;
    }

    await deleteConversationById(conversationId);
    addConsoleLine("system", `Диалог удалён: ${conversationId}`);
    return;
  }

  if (command === "model") {
    const currentModel = currentConversation?.modelOverride || "default";
    addConsoleLine("system", `Текущая модель диалога: ${currentModel}`);
    return;
  }

  if (command.startsWith("model ")) {
    const nextModel = command.slice(6).trim();
    if (!nextModel) {
      addConsoleLine("system", "Укажи идентификатор модели после команды model");
      return;
    }
    const conversation = await patchConversation({ modelOverride: nextModel });
    addConsoleLine("system", `Для этого диалога выбрана модель: ${conversation.modelOverride}`);
    return;
  }

  if (command === "share") {
    await copyShareLink();
    return;
  }

  if (command === "new") {
    currentConversation = null;
    updateUrlForConversation("");
    renderConversation(null);
    addConsoleLine("system", "Начат новый пустой диалог.");
    return;
  }

  if (command === "clear") {
    currentConversation = null;
    updateUrlForConversation("");
    renderConversation(null);
    addConsoleLine("system", "Текущий экран очищен. Старый диалог остаётся доступен по своей ссылке.");
    return;
  }

  if (command === "ping") {
    addConsoleLine("system", "Сервер отвечает.");
    return;
  }

  if (command.startsWith("test ")) {
    const prompt = command.slice(5).trim();
    if (!prompt) {
      addConsoleLine("system", "После test нужно указать текст запроса.");
      return;
    }
    closeConsole();
    await submitPrompt(prompt);
    return;
  }

  addConsoleLine("system", "Неизвестная команда. Напиши help, чтобы увидеть список.");
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) {
    return;
  }
  await submitPrompt(prompt);
});

promptEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && event.ctrlKey && !event.shiftKey && !isPending) {
    event.preventDefault();
    const prompt = promptEl.value.trim();
    if (!prompt) {
      return;
    }
    await submitPrompt(prompt);
  }
});

suggestionsEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".suggestion");
  if (!button || button.disabled) {
    return;
  }

  const prompt = button.dataset.prompt || "";
  if (!prompt) {
    return;
  }

  promptEl.value = prompt;
  await submitPrompt(prompt);
});

shareButtonEl.addEventListener("click", async () => {
  try {
    await copyShareLink();
    closeActionsMenu();
  } catch (error) {
    addConsoleLine("system", `Не удалось скопировать ссылку: ${error.message}`);
  }
});

newChatButtonEl.addEventListener("click", startNewChat);
actionsMenuButtonEl?.addEventListener("click", toggleActionsMenu);
menuNewChatButtonEl?.addEventListener("click", startNewChat);
menuShareButtonEl?.addEventListener("click", async () => {
  try {
    await copyShareLink();
    closeActionsMenu();
  } catch (error) {
    addConsoleLine("system", `Не удалось скопировать ссылку: ${error.message}`);
  }
});

consoleBackdropEl.addEventListener("click", closeConsole);

document.addEventListener("click", (event) => {
  if (!actionsMenuEl || !actionsMenuButtonEl) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }

  if (actionsMenuEl.contains(target) || actionsMenuButtonEl.contains(target)) {
    return;
  }

  closeActionsMenu();
});

consoleFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const command = consoleInputEl.value;
  consoleInputEl.value = "";
  resetConsoleHistoryNavigation();
  try {
    await runCommand(command);
  } catch (error) {
    addConsoleLine("system", `Ошибка: ${error.message}`);
  }
});

consoleInputEl.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    applyConsoleHistory(-1);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    applyConsoleHistory(1);
  }
});

consoleTriggerTitleEl?.addEventListener("click", () => {
  registerConsoleTriggerTap();
});

window.addEventListener("keydown", (event) => {
  const isTilde = event.key === "~" || event.key === "`";
  if (isTilde && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    if (commandConsoleEl.classList.contains("hidden")) {
      openConsole();
    } else {
      closeConsole();
    }
    return;
  }

  if (event.key === "Escape" && actionsMenuEl && !actionsMenuEl.classList.contains("hidden")) {
    closeActionsMenu();
    return;
  }

  if (event.key === "Escape" && !commandConsoleEl.classList.contains("hidden")) {
    closeConsole();
  }
});

async function boot() {
  renderConversation(null);
  await checkHealth();

  if (consoleLocked) {
    addConsoleLine("system", "Консоль защищена паролем. Введи: unlock <пароль>");
  } else {
    addConsoleLine("system", "Скрытая консоль готова. Нажми ~ и введи help.");
  }

  const urlConversationId = new URL(window.location.href).searchParams.get("c");
  const storedConversationId = localStorage.getItem(storageKey);
  const conversationId = urlConversationId || storedConversationId;

  if (conversationId) {
    try {
      await loadConversation(conversationId);
      addConsoleLine("system", `Диалог восстановлен: ${currentConversation.title}`);
      return;
    } catch (error) {
      updateUrlForConversation("");
      addConsoleLine("system", `Не удалось загрузить сохранённый диалог: ${error.message}`);
    }
  }
}

boot();



