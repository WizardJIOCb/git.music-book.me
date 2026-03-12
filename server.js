const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const {
  extractOrderLookupCriteria,
  findMatchingOrders,
  formatOrderReply,
  inferOrderFromPayload,
  isOrderQuestion,
  loadOrder,
  mergeOrders,
  normalizeLooseText,
  normalizeSearchText,
  saveOrder
} = require("./lib/orders");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_PROJECT = process.env.OPENAI_PROJECT || "";
const SITE_URL = process.env.SITE_URL || "https://gpt.music-book.me";
const SITE_NAME = process.env.SITE_NAME || "Music Book GPT";
const CONSOLE_PASSWORD = process.env.CONSOLE_PASSWORD || "";
const TILDA_WEBHOOK_SECRET = process.env.TILDA_WEBHOOK_SECRET || "";
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  [
    "You are Music Book GPT, the website assistant for music-book.me.",
    "Write in Russian by default unless the visitor clearly switches language.",
    "Important: use the provided store facts as the source of truth for books, links, delivery, contacts, pickup, and Romana.",
    "If the answer depends on a fact not present in the provided store facts, say that directly instead of inventing details.",
    "If the visitor asks where to buy a book or asks about a specific book, always give the direct page link from the provided facts when available.",
    "If the visitor asks about a specific book from the catalog, first describe that exact book using the provided book description facts, then mention price or availability if known, and then give the direct page link.",
    "Do not replace a specific book description with generic text about the store or project when the book facts are available.",
    "If the visitor asks about prices, use only the prices explicitly present in the provided facts. If a price is not confirmed, say that the exact current price is better checked on the book page.",
    "If the visitor asks about delivery to a Russian city outside Moscow or Saint Petersburg, use the provided Russia delivery facts directly: usually 2 to 7 days, cost from 180 RUB, and the exact term depends on the chosen method and is shown in the cart. Do not answer that the delivery time is unknown when these facts are available.",
    "If the visitor asks about Romana's social networks, answer directly by listing the available social links from the provided facts. Do not say that the information is missing when the social links are present.",
    "Do not mention any private or internal relationship details about Romana and the site owner. Present her only as the author, publisher, and founder behind the books and project.",
    "When asked about Romana, give a direct descriptive answer based on the known biography. Do not say that the project is unclear, do not speculate, and do not redirect the visitor to formulate questions for Romana if the known facts already answer the question.",
    "If the visitor asks about Rodion, Anna Ladyzhenko, Lyudmila Ladyzhenko, Lev Svider, Jens Svider, or Danir Kalimullin, use the provided people facts. Keep the tone respectful and factual. When a fact comes from the site owner rather than a public page, present it as known project context rather than a verified public biography.",
    "When answering about a known person from the provided people facts, do not say that information is missing if a summary and link are already available. Give the concise description and the relevant site or profile link when provided.",
    "If the visitor asks about Anna Ivanovna Ladyzhenko, Rodion Kalimullin, or Lyudmila Ivanovna Ladyzhenko, обязательно укажи ссылку на их сайт в самом ответе: https://anna.ladyzenko.ru, https://rodion.pro, https://ladyzenko.ru.",
    "Do not speculate about how a known person might be connected to the project beyond the provided facts. Answer only with the known biographical or profile information.",
    "When a site or profile link is provided in the facts, include that exact full link in the answer.",
    "If the user asked a straightforward identity question and the provided facts already answer it, do not add an extra follow-up question at the end.",
    "Speak warmly, clearly, and practically. Prefer short useful answers.",
    "If the visitor says hello or asks a broad question without specifics, explain that this chat helps with Music Book books, book pages, prices, delivery, pickup, Romana, and navigation around the site.",
    "For broad questions like what Music Book is, what it is useful for, how it can be used, or where to start, answer strictly in the context of the music-book.me website and its books.",
    "Do not answer broad project questions as if Music Book were a general platform for musicians, artists, labels, managers, studios, or music business workflows unless that is explicitly present in the provided facts.",
    "For broad project questions, focus on books, book pages, prices, delivery, pickup, contacts, and guidance around the site."
  ].join(" ");

const PROJECT_FACTS = {
  short: "Music Book — это сайт музыкальных книг издательства Romana's Book.",
  forWhom: "Сайт полезен тем, кто хочет посмотреть книги, выбрать нужное издание, перейти на страницу книги и разобраться с покупкой.",
  useCases: "Через сайт можно узнать о конкретной книге, получить ссылку на её страницу, посмотреть известную цену, уточнить доставку, самовывоз, контакты и получить справку о Романе и проекте.",
  start: "Лучший старт на сайте — выбрать интересующую книгу или спросить ассистента о конкретной книге, цене, доставке, самовывозе или о проекте в целом.",
  answerStyle: "Для общих вопросов о Music Book нельзя придумывать дополнительные роли, функции платформы или сложные сценарии. Нужно отвечать только в рамках сайта музыкальных книг и помощи с покупкой и навигацией."
};
const STORE_FACTS = {
  books: [
    {
      slug: "anyta",
      title: "Анюта идёт в театр",
      url: "https://new.music-book.me/books/anyuta.html",
      alternateUrls: ["https://music-book.me/anyta-idet-v-teatr"],
      priceRub: 3700,
      availability: "Новинка; книга готовится к скорому релизу, при этом на странице уже указано, что её можно заказать.",
      description:
        "«Анюта идёт в театр» — музыкальная книга о первом знакомстве с искусством, приуроченная к 185-летию П. И. Чайковского. Она включает 13 музыкальных фрагментов из его опер и балетов в исполнении Симфонического оркестра Большого театра. Это новинка: книга ещё готовится к релизу в скором времени, но на странице уже указано, что её можно заказать."
    },
    {
      slug: "sleeping-beauty",
      title: "Спящая красавица",
      url: "https://music-book.me/spyashaya-krasavitsa",
      priceRub: 3500,
      availability: "Доступна к покупке на странице книги.",
      description:
        "Перед вами музыкальная книга, посвященная самой роскошной и пышной постановке балета «Спящая красавица». Со страниц книги звучит музыка П. И. Чайковского в исполнении Большого симфонического оркестра под управлением Владимира Федосеева."
    },
    {
      slug: "nutcracker",
      title: "Щелкунчик",
      url: "https://music-book.me/booknutcracker",
      priceRub: 3700,
      availability: "Доступна к покупке на странице книги; на сайте также указано, что книга продаётся в сувенирном магазине Большого театра.",
      description:
        "«Щелкунчик» подарит вам волшебные эмоции. Это музыкальная книга по самой узнаваемой постановке балета, в которой звучит оригинальная запись Большого симфонического оркестра П. И. Чайковского под управлением Владимира Федосеева."
    },
    {
      slug: "children-album",
      title: "Детский альбом",
      url: "https://music-book.me/bookchildrenalbum",
      priceRub: 3500,
      availability: "Доступна к покупке на странице книги.",
      description:
        "Перед вами уникальная книга «Детский альбом». Это музыкальная книга по «Детскому альбому» П. И. Чайковского: в ней звучат 10 музыкальных пьес, а к каждой подобраны стихи русских классиков."
    },
    {
      slug: "swan-lake",
      title: "Лебединое озеро",
      url: "https://music-book.me/bookswanlake",
      priceRub: 3500,
      availability: "Доступна к покупке на странице книги.",
      description:
        "Перед вами музыкальная книга «Лебединое озеро». В ней соединены иллюстрации и музыка П. И. Чайковского, а сама книга оформлена как подарочное издание."
    },
    {
      slug: "cinderella",
      title: "Золушка",
      url: "https://music-book.me/zolyshka",
      priceRub: 3500,
      availability: "На странице указано, что новый тираж выходит в феврале-марте 2026 года; книгу можно забронировать на сайте.",
      description:
        "Перед вами музыкальная книга, посвящённая самой искрящейся и невероятной постановке балета «Золушка» на музыку Сергея Прокофьева. Это подарочное музыкальное издание с фрагментами из балета."
    }
  ],
  delivery: {
    moscowSpb: "Доставка по Москве и Санкт-Петербургу обычно 2-3 дня, стоимость от 160 ₽.",
    russia: "Доставка по России обычно занимает от 2 до 7 дней, стоимость от 180 ₽. Для городов вроде Волгограда можно ориентироваться на несколько дней доставки, а точный срок рассчитывается в корзине в зависимости от выбранного способа.",
    providers: "На страницах книг указана доставка CDEK; на некоторых страницах также упоминается Boxberry.",
    expressMoscow: "Возможна экспресс-доставка по Москве в течение 1-2 часов через почту или телефон.",
    belarusKazakhstan:
      "Доставка в Беларусь и Казахстан оформляется через почту info@music-book.me: нужно написать ФИО, телефон и адрес СДЭК.",
    orderFlow:
      "После оформления заказа обычно приходит чек, письмо от издательства с подтверждением и письмо от СДЭК с трек-номером. Заказы до 17:00 в будни обычно передаются в доставку в тот же день."
  },
  contacts: {
    phone: "+7 (927) 636-77-57",
    email: "info@music-book.me",
    address: "г. Москва, ул. Каховка, д. 25, вход у первого подъезда",
    hours: "Пн-Пт с 10:00 до 17:00, Сб-Вс выходные"
  },
  romana: {
    short: "Романа — владелица сайта music-book.me, а также автор и издатель музыкальных книг.",
    bio:
      "Романа рассказывает, что искусство всегда было частью её жизни: ещё в детстве она танцевала вальс цветов под музыку П. И. Чайковского, училась рисунку, живописи и композиции и окончила художественную школу.",
    mission:
      "Роману вдохновили её дочери Мира и Яна. Ей хотелось читать детям сказки с эстетичными иллюстрациями, живыми героями и не искажённым сюжетом, поэтому музыкальные книги она прежде всего создаёт для своих детей и для знакомства детей с искусством.",
    values:
      "Романа говорит, что её небольшое издательство вкладывает частичку души в каждую книгу. Она хочет, чтобы книги стали проводником для детей в мир искусства и грации, развивали вкус, эмоциональный интеллект, эмпатию и любовь к классической музыке через игру и сказку.",
    socials:
      "Соцсети Романы, указанные на сайте music-book.me: Instagram https://www.instagram.com/romanasbook, RUTUBE https://rutube.ru/channel/35548192, VK https://vk.com/romanasbook, Telegram https://t.me/romanasbook, MAX https://max.ru/romanasbook."
  },
  people: [
    {
      key: "rodion",
      aliases: ["калимуллин родион данирович", "родион", "rodion"],
      summary:
        "Калимуллин Родион Данирович — автор этого сайта и приложения, а также родной брат Романы. Дополнительная информация о нём есть на https://rodion.pro и особенно на странице резюме https://rodion.pro/ru/resume."
    },
    {
      key: "anna",
      aliases: ["анна", "анна ивановна ладыженко", "анна ладыженко", "ладыженко анна ивановна", "ладыженко анна", "кто такая анна"],
      summary:
        "Анна Ивановна Ладыженко — мама Романы и художник. По информации с сайта https://anna.ladyzenko.ru, это авторский сайт художника Анны Ладыженко с галереей работ и творческим позиционированием «Рисую • Обучаю • Вдохновляю». По проектным данным, она помогает детям и взрослым учиться рисовать; на сайте также есть её творческие материалы и ссылки на YouTube и Instagram."
    },
    {
      key: "lyudmila",
      aliases: ["людмила ивановна ладыженко", "людмила ладыженко", "ладыженко людмила ивановна", "ладыженко людмила", "люда", "кто такая люда"],
      summary:
        "Людмила Ивановна Ладыженко — сестра Анны Ивановны Ладыженко и тётя Романы. По информации с сайта https://ladyzenko.ru, она психолог с опытом частной практики с 1996 года. В психологию она пришла из профессионального спорта, затем работала тренером и училась на психфаке. На сайте также указано, что она помогает с трудностями в отношениях, самооценкой, жизненными кризисами, переживанием потерь, принятием решений и поддержкой перед важными событиями, а ещё ведёт проекты вроде «Школы Отцов»."
    },
    {
      key: "lev",
      aliases: ["лев сергеевич свидер", "лев свидер", "свидер лев сергеевич", "свидер лев", "лёва свидер", "лева свидер", "лёва", "лева"],
      summary:
        "Лев Сергеевич Свидер — двоюродный брат Романы. По проектным данным, его страницу можно посмотреть здесь: https://vk.com/someday4sure."
    },
    {
      key: "jens",
      aliases: ["йенс сергеевич свидер", "йенс свидер", "йенс"],
      summary:
        "Йенс Сергеевич Свидер — двоюродный брат Романы. По проектным данным, сейчас он живёт в Америке, женат и работает в транспортной сфере в компании, связанной с шинами."
    },
    {
      key: "amira",
      aliases: ["амира", "кто такая амира"],
      summary:
        "Амира — дочь Романы."
    },
    {
      key: "airat",
      aliases: ["айрат", "кто такой айрат"],
      summary:
        "Айрат — муж Романы."
    },
    {
      key: "faya",
      aliases: ["фая", "кто такая фая"],
      summary:
        "Фая — это Фануза Муталиповна, бабушка Романы по линии отца."
    },
    {
      key: "vera",
      aliases: ["вера фёдоровна ладыженко", "вера федоровна ладыженко", "вера ладыженко", "кто такая вера фёдоровна ладыженко", "кто такая вера федоровна ладыженко"],
      summary:
        "Вера Фёдоровна Ладыженко — бабушка Романы по линии мамы, Анны Ивановны Ладыженко."
    },
    {
      key: "ivan",
      aliases: ["иван павлович ладыженко", "иван ладыженко", "кто такой иван павлович ладыженко"],
      summary:
        "Иван Павлович Ладыженко — дедушка Романы по линии мамы, Анны Ивановны Ладыженко. По проектным данным, он прошёл всю Великую Отечественную войну 1941-1945 годов против немецких захватчиков и был танкистом на танке Т-34."
    },
    {
      key: "danir",
      aliases: ["калимуллин данир зинурович", "данир зинурович", "данир калимуллин"],
      summary:
        "Калимуллин Данир Зинурович — папа Романы и Родиона. По проектным данным, он занимался нефтяной отраслью, работал в Москве, а сейчас находится на пенсии."
    }
  ]
};
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const CONVERSATIONS_DIR = path.join(DATA_DIR, "conversations");
const CONSOLE_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

ensureDir(DATA_DIR);
ensureDir(CONVERSATIONS_DIR);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function safeJoinPublic(urlPath) {
  const targetPath = urlPath === "/" ? "/index.html" : urlPath;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, targetPath));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return fullPath;
}

function serveStatic(req, res, pathname) {
  const filePath = safeJoinPublic(pathname);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);

  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": body.length
  });
  res.end(body);
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1000000) {
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        if (!raw) {
          resolve({});
          return;
        }

        const contentType = String(req.headers["content-type"] || "").toLowerCase();
        if (contentType.includes("application/json")) {
          resolve(JSON.parse(raw));
          return;
        }

        if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(raw);
          const payload = {};
          for (const [key, value] of params.entries()) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) {
              const existing = payload[key];
              payload[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
            } else {
              payload[key] = value;
            }
          }
          resolve(payload);
          return;
        }

        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeMessages(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item.role === "string" && typeof item.content === "string")
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content.trim()
    }))
    .filter((item) => item.content.length > 0)
    .slice(-40);
}

function normalizeId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : null;
}

function buildShareUrl(conversationId) {
  return `${SITE_URL}?c=${conversationId}`;
}

function conversationPath(conversationId) {
  return path.join(CONVERSATIONS_DIR, `${conversationId}.json`);
}

function deleteConversation(conversationId) {
  const safeId = normalizeId(conversationId);
  if (!safeId) {
    return false;
  }

  const filePath = conversationPath(safeId);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}

function createConversation(modelOverride = "") {
  const now = new Date().toISOString();
  const id = crypto.randomBytes(9).toString("base64url");
  return {
    id,
    createdAt: now,
    updatedAt: now,
    title: "Новый диалог",
    modelOverride: modelOverride || "",
    messages: []
  };
}

function loadConversation(conversationId) {
  const safeId = normalizeId(conversationId);
  if (!safeId) {
    return null;
  }

  const filePath = conversationPath(safeId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    parsed.id = safeId;
    parsed.title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Новый диалог";
    parsed.modelOverride = typeof parsed.modelOverride === "string" ? parsed.modelOverride.trim() : "";
    parsed.messages = normalizeMessages(parsed.messages);
    return parsed;
  } catch (error) {
    console.error("[conversation:load]", error);
    return null;
  }
}

function saveConversation(conversation) {
  const payload = {
    id: conversation.id,
    createdAt: conversation.createdAt,
    updatedAt: new Date().toISOString(),
    title: conversation.title || "Новый диалог",
    modelOverride: conversation.modelOverride || "",
    messages: normalizeMessages(conversation.messages)
  };
  fs.writeFileSync(conversationPath(conversation.id), JSON.stringify(payload, null, 2));
  return payload;
}

function conversationContainsText(conversation, searchText) {
  const normalizedSearch = String(searchText || "").trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  const haystack = [
    conversation.id,
    conversation.title,
    conversation.modelOverride,
    ...(Array.isArray(conversation.messages) ? conversation.messages.map((message) => message.content || "") : [])
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return haystack.includes(normalizedSearch);
}

function listConversations(searchText = "") {
  const entries = fs
    .readdirSync(CONVERSATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => loadConversation(path.basename(entry.name, ".json")))
    .filter((conversation) => conversationContainsText(conversation, searchText))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
      const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
      return rightTime - leftTime;
    });

  return entries.map((conversation) => summarizeConversation(conversation));
}

function summarizeConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    modelOverride: conversation.modelOverride || "",
    messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
    shareUrl: buildShareUrl(conversation.id)
  };
}

function presentConversation(conversation) {
  return {
    ...summarizeConversation(conversation),
    messages: conversation.messages || []
  };
}

function updateConversationTitle(conversation) {
  const firstUserMessage = (conversation.messages || []).find((message) => message.role === "user");
  if (!firstUserMessage) {
    conversation.title = "Новый диалог";
    return;
  }

  const title = firstUserMessage.content.replace(/\s+/g, " ").trim().slice(0, 72);
  conversation.title = title || "Новый диалог";
}

function createConsoleToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + CONSOLE_TOKEN_TTL_MS }), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", CONSOLE_PASSWORD).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyConsoleToken(token) {
  if (!CONSOLE_PASSWORD) {
    return true;
  }
  if (typeof token !== "string" || !token.includes(".")) {
    return false;
  }
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", CONSOLE_PASSWORD).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.exp === "number" && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

function getConsoleToken(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return typeof req.headers["x-console-token"] === "string" ? req.headers["x-console-token"] : "";
}

function requireConsoleAuth(req, res) {
  if (!CONSOLE_PASSWORD) {
    return true;
  }
  const token = getConsoleToken(req);
  if (!verifyConsoleToken(token)) {
    sendJson(res, 401, { error: "Console is locked." });
    return false;
  }
  return true;
}

function verifyTildaWebhookSecret(req, payload) {
  if (!TILDA_WEBHOOK_SECRET) {
    return true;
  }

  const querySecret = normalizeLooseText(new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("secret"));
  const headerSecret = normalizeLooseText(req.headers["x-tilda-secret"]);
  const bodySecret = normalizeLooseText(payload.secret || payload.webhook_secret || payload.token);
  return [querySecret, headerSecret, bodySecret].some((value) => value && value === TILDA_WEBHOOK_SECRET);
}

function latestUserMessage(messages) {
  const reversed = [...messages].reverse();
  return reversed.find((message) => message.role === "user")?.content || "";
}

function getOrderAssistantReply(message) {
  const text = normalizeSearchText(message);
  const criteria = extractOrderLookupCriteria(message);
  const hasDirectPhoneLookup = Boolean(criteria.phone) && !criteria.trackNumber;
  const hasDirectTrackLookup = Boolean(criteria.trackNumber);
  const hasSpecificOrderIntent =
    /(мой|моя|моего|моему|заказ|получател|адрес|по адресу|по имени|найди заказ|статус заказа|где мой)/i.test(text) &&
    Boolean(criteria.queryTokens && criteria.queryTokens.length >= 3);

  if (!isOrderQuestion(text) && !hasDirectPhoneLookup && !hasDirectTrackLookup) {
    return "";
  }

  if (!hasDirectPhoneLookup && !hasDirectTrackLookup && !hasSpecificOrderIntent) {
    return "";
  }

  if (!criteria.phone && !criteria.trackNumber && !(criteria.queryTokens && criteria.queryTokens.length >= 3)) {
    return "Я могу помочь найти заказ. Для этого лучше указать телефон, трек-номер или полные ФИО вместе с адресом доставки.";
  }

  return formatOrderReply(findMatchingOrders(criteria), criteria);
}

function getDirectAssistantReply(message) {
  const text = String(message || "").toLowerCase();
  const matchedBooks = STORE_FACTS.books.filter((book) => {
    const aliases = [book.title, book.slug, book.url, ...(Array.isArray(book.alternateUrls) ? book.alternateUrls : [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(book.title.toLowerCase()) || (book.slug && text.includes(book.slug)) || aliases.includes(text);
  });
  const asksBookPrice = /(сколько\s+стоит|какая\s+цена|цена|стоимость|сколько)/.test(text);
  const mentionsRomana = /(романа|роману|романе|романы|romana|romanasbook)/.test(text);
  const mentionsSocialChannel = /(соц\.?\s*сети|соцсет|социальн|инстаграм|instagram|телеграм|telegram|тг|tg|вк|\bvk\b|рутуб|rutube|max\.ru|\bmax\b|ютуб|youtube|аккаунт|аккаунты|канал|каналы|страниц|ссылка|ссылки|подписа|где найти|где посмотреть)/.test(text);
  const asksAboutRomanaSocials = mentionsRomana && mentionsSocialChannel;
  const asksAboutRomanaWebsite = mentionsRomana && /(сайт|сайта|сайте|официальный сайт|website|вебсайт)/.test(text);
  const asksAboutAmira = /(амира)/.test(text);
  const asksAboutAirat = /(айрат)/.test(text);
  const asksAboutDelivery =
    /(способ(?:ы)?\s+доставк|как\s+работает\s+доставк|доставк|самовывоз|забрат|забрать|пункт выдачи|пвз|сдэк|cdek|boxberry|сколько дней|срок доставк)/.test(text);
  const asksAboutRomanaMother =
    /(мама\s+роман|мать\s+роман|кто\s+мама\s+роман|кто\s+мать\s+роман|у\s+роман\s+есть\s+мама|есть\s+ли\s+у\s+роман\s+мама)/.test(text) ||
    /^(а\s+)?мама\??$/.test(text);
  const asksAboutRomanaFather =
    /(папа\s+роман|отец\s+роман|кто\s+папа\s+роман|кто\s+отец\s+роман|у\s+роман\s+есть\s+папа|есть\s+ли\s+у\s+роман\s+папа)/.test(text) ||
    /^(а\s+)?папа\??$/.test(text);
  const asksAboutRomanaAunt =
    /(т[её]тя\s+роман|кто\s+т[её]тя\s+роман|у\s+роман\s+есть\s+т[её]тя|есть\s+ли\s+у\s+роман\s+т[её]тя)/.test(text) ||
    /^(а\s+)?т[её]тя\??$/.test(text);
  const asksAboutRomanaHusband =
    /(муж\s+роман|кто\s+муж\s+роман|у\s+роман\s+есть\s+муж|есть\s+ли\s+у\s+роман\s+муж)/.test(text) ||
    /^(а\s+)?муж\s+есть\??$/.test(text);
  const asksAboutRomanaDaughter =
    /(дочь\s+роман|дочка\s+роман|кто\s+дочь\s+роман|кто\s+дочка\s+роман|у\s+роман\s+есть\s+дочь|есть\s+ли\s+у\s+роман\s+дочь)/.test(text) ||
    /^(а\s+)?дочь\s+есть\??$/.test(text) ||
    /^(а\s+)?дочка\s+есть\??$/.test(text);
  const asksAboutRodion = /(кто\s+так(ой|ой)\s+родион|кто\s+такой\s+родион|родион\s+кто\s+это|кто\s+такой\s+калимуллин\s+родион(\s+данирович)?)/.test(text);
  const asksAboutLevSvider = /(кто\s+так(ой|ой)\s+лев\s+свидер|кто\s+такой\s+лев\s+свидер|лев\s+свидер\s+кто\s+это|кто\s+такой\s+л[её]ва\s+свидер)/.test(text);
  const asksAboutJensSvider = /(кто\s+так(ой|ой)\s+йенс\s+свидер|кто\s+такой\s+йенс\s+свидер|йенс\s+свидер\s+кто\s+это)/.test(text);
  const asksAboutDanir = /(кто\s+так(ой|ой)\s+данир|кто\s+такой\s+калимуллин\s+данир(\s+зинурович)?|данир\s+кто\s+это)/.test(text);
  const asksAboutOfficeHours = /(до скольки|режим работы|время работы|часы работы|когда работает|когда открыт|открыт ли|офис|магазин|самовывоз|адрес)/.test(text);
  const asksAboutRomanaGrandmother = /(кто\s+бабушк|бабушка\s+роман|бабушку\s+роман)/.test(text);
  const asksAboutRomanaGrandfather = /(кто\s+дед|кто\s+дедушк|дед\s+роман|дедушка\s+роман|дедушку\s+роман)/.test(text);
  const asksAboutRomanaBrother =
    /(брат\s+роман|брат\s+у\s+роман|у\s+роман\s+есть\s+брат|есть\s+ли\s+у\s+роман\s+брат|кто\s+брат\s+роман)/.test(text) ||
    /^(а\s+)?брат\s+есть\??$/.test(text);
  const asksAboutRomanaCousinBrother =
    /(двоюродн\w*\s+брат\s+роман|двоюродн\w*\s+брат\s+у\s+роман|двоюродн\w*\s+брат\s+есть\s+у\s+роман|у\s+роман\s+есть\s+двоюродн\w*\s+брат|есть\s+ли\s+у\s+роман\s+двоюродн\w*\s+брат|кто\s+двоюродн\w*\s+брат\s+роман)/.test(text) ||
    /^(а\s+)?двоюрд?ный\s+брат\s+есть\??$/.test(text) ||
    /^(а\s+)?двоюродный\s+брат\s+есть\??$/.test(text);
  const asksAboutGulik = /(гулик)/.test(text);

  if (asksBookPrice && matchedBooks.length === 1) {
    const book = matchedBooks[0];
    const priceLine =
      typeof book.priceRub === "number"
        ? `Книга «${book.title}» стоит ${book.priceRub} ₽.`
        : `Точную текущую цену книги «${book.title}» лучше посмотреть на странице книги.`;
    const availabilityLine = book.availability ? book.availability : "Книга доступна на странице книги.";
    return [
      priceLine,
      availabilityLine,
      `Страница книги: ${book.url}`
    ].join("\n");
  }

  if (asksAboutRomanaSocials) {
    return [
      "У Романы есть следующие социальные сети:",
      "- Instagram: [https://www.instagram.com/romanasbook](https://www.instagram.com/romanasbook)",
      "- RUTUBE: [https://rutube.ru/channel/35548192](https://rutube.ru/channel/35548192)",
      "- VK: [https://vk.com/romanasbook](https://vk.com/romanasbook)",
      "- Telegram: [https://t.me/romanasbook](https://t.me/romanasbook)",
      "- MAX: [https://max.ru/romanasbook](https://max.ru/romanasbook)"
    ].join("\n");
  }

  if (asksAboutDelivery) {
    return [
      "Вот что известно о доставке и самовывозе:",
      STORE_FACTS.delivery.moscowSpb,
      STORE_FACTS.delivery.russia,
      `Способы доставки: ${STORE_FACTS.delivery.providers}`,
      STORE_FACTS.delivery.expressMoscow,
      STORE_FACTS.delivery.belarusKazakhstan,
      STORE_FACTS.delivery.orderFlow,
      `Самовывоз: ${STORE_FACTS.contacts.address}`,
      `Часы работы: ${STORE_FACTS.contacts.hours}`,
      `Контакты: ${STORE_FACTS.contacts.phone}, ${STORE_FACTS.contacts.email}`
    ].join("\n");
  }





  if (asksAboutRomanaGrandmother) {
    return [
      "У Романы две бабушки.",
      "По линии мамы — Вера Фёдоровна Ладыженко.",
      "По линии отца — Фануза Муталиповна (Фая)."
    ].join("\n");
  }

  if (asksAboutRomanaGrandfather) {
    return "Дедушка Романы по линии мамы — Иван Павлович Ладыженко.";
  }

  if (asksAboutRomanaMother) {
    return "Мама Романы — Анна Ивановна Ладыженко.";
  }

  if (asksAboutRomanaFather) {
    return "Папа Романы — Калимуллин Данир Зинурович.";
  }

  if (asksAboutRodion) {
    return "Родион Калимуллин — родной брат Романы, а также автор этого сайта и приложения. Подробнее: https://rodion.pro и https://rodion.pro/ru/resume.";
  }

  if (asksAboutLevSvider) {
    return "Лев Сергеевич Свидер — двоюродный брат Романы. Его страницу можно посмотреть здесь: https://vk.com/someday4sure.";
  }

  if (asksAboutJensSvider) {
    return "Йенс Сергеевич Свидер — двоюродный брат Романы. По известным проектным данным, сейчас он живёт в Америке, женат и работает в транспортной сфере.";
  }

  if (asksAboutDanir) {
    return "Калимуллин Данир Зинурович — папа Романы и Родиона. По известным проектным данным, он занимался нефтяной отраслью, работал в Москве и сейчас находится на пенсии.";
  }

  if (asksAboutRomanaBrother) {
    return "Да, у Романы есть родной брат — Родион Калимуллин.";
  }

  if (asksAboutRomanaCousinBrother) {
    return [
      "Да, у Романы есть двоюродные братья.",
      "Это Лев Свидер и Йенс Свидер."
    ].join("\n");
  }

  if (asksAboutGulik) {
    return "В известных фактах о проекте и семье Романы человека с фамилией Гулик нет, поэтому не буду придумывать детали.";
  }

  if (asksAboutRomanaAunt) {
    return "Тётя Романы — Людмила Ивановна Ладыженко.";
  }

  if (asksAboutRomanaDaughter) {
    return "У Романы есть дочь Амира.";
  }

  if (asksAboutRomanaHusband) {
    return "Да, муж Романы — Айрат.";
  }

  if (asksAboutAmira) {
    return "Амира — дочь Романы.";
  }

  if (asksAboutAirat) {
    return "Айрат — муж Романы.";
  }

  if (asksAboutOfficeHours) {
    return [
      "Офис и самовывоз работают по адресу:",
      "г. Москва, ул. Каховка, д. 25, вход у первого подъезда",
      "Пн-Пт с 10:00 до 17:00",
      "Сб-Вс выходные"
    ].join("\n");
  }

  if (asksAboutRomanaWebsite) {
    return "Сайт Романы: [https://music-book.me](https://music-book.me)";
  }
  return "";
}

function getRelevantStoreFacts(userText) {
  const text = userText.toLowerCase();
  const facts = [];

  const matchedBooks = STORE_FACTS.books.filter((book) => {
    const aliases = [book.title, book.slug, book.url, ...(Array.isArray(book.alternateUrls) ? book.alternateUrls : [])]
      .join(" ")
      .toLowerCase();
    return aliases.includes(text) || text.includes(book.title.toLowerCase()) || (book.slug && text.includes(book.slug));
  });

  const asksAboutBooks = /(книг|книга|купить|цена|цены|стоим|стоить|сколько|ссылка|заказать)/.test(text);
  const asksAboutDelivery = /(доставк|самовывоз|забрат|забрать|адрес|где забрать|где можно забрать|пункт выдачи|дойдет|дойдёт|сколько дней)/.test(text);
  const asksAboutRomana = /(романа|роману|романе|кто такая романа|кто такая романа|соцсет|социальн|инстаграм|instagram|телеграм|telegram|вк|vk|рутуб|rutube|max\.ru|max)/.test(text);
  const mentionsRomana = /(романа|роману|романе|романы|romana|romanasbook)/.test(text);
  const mentionsSocialChannel = /(соц\.?\s*сети|соцсет|социальн|инстаграм|instagram|телеграм|telegram|тг|tg|вк|\bvk\b|рутуб|rutube|max\.ru|\bmax\b|ютуб|youtube|аккаунт|аккаунты|канал|каналы|страниц|ссылка|ссылки|подписа|где найти|где посмотреть)/.test(text);
  const asksAboutRomanaSocials = mentionsRomana && mentionsSocialChannel;
  const asksAboutProject = /(что такое music book|что такое music-book|что это такое|чем это полезно|как это можно использовать|с чего начать|о проекте|привет|здравствуй|здравствуйте|hello|hi)/.test(text);
  const asksAboutRussianCity = /(волгоград|росси|воронеж|самара|казань|екатеринбург|нижний новгород|ростов|краснодар|новосибирск|челябинск|пермь|уфа|омск)/.test(text);
  const matchedPeople = STORE_FACTS.people.filter((person) =>
    person.aliases.some((alias) => text.includes(alias.toLowerCase()))
  );
  if (asksAboutProject) {
    facts.push(
      [
        "ФАКТЫ О ПРОЕКТЕ:",
        PROJECT_FACTS.short,
        PROJECT_FACTS.forWhom,
        PROJECT_FACTS.useCases,
        PROJECT_FACTS.start,
        PROJECT_FACTS.answerStyle
      ].join("\n")
    );
  }

  if (asksAboutBooks) {
    const booksToDescribe = matchedBooks.length ? matchedBooks : STORE_FACTS.books;
    const lines = booksToDescribe.map((book) => {
      const parts = [`${book.title}: ${book.url}`];
      if (book.description) {
        parts.push(`описание: ${book.description}`);
      }
      if (typeof book.priceRub === "number") {
        parts.push(`цена: ${book.priceRub} ₽` + (book.oldPriceRub ? ` (раньше ${book.oldPriceRub} ₽)` : ""));
      } else if (book.priceNote) {
        parts.push(`цена: ${book.priceNote}`);
      }
      if (book.availability) {
        parts.push(`наличие/статус: ${book.availability}`);
      }
      return parts.join("; ");
    });
    facts.push("ФАКТЫ О КНИГАХ:\n" + lines.join("\n"));
  }

  if (asksAboutDelivery) {
    facts.push(
      [
        "ФАКТЫ О ДОСТАВКЕ И САМОВЫВОЗЕ:",
        STORE_FACTS.delivery.moscowSpb,
        STORE_FACTS.delivery.russia,
        STORE_FACTS.delivery.providers,
        STORE_FACTS.delivery.expressMoscow,
        STORE_FACTS.delivery.belarusKazakhstan,
        STORE_FACTS.delivery.orderFlow,
        `Контакты для заказа и самовывоза: ${STORE_FACTS.contacts.phone}, ${STORE_FACTS.contacts.email}`,
        `Адрес: ${STORE_FACTS.contacts.address}`,
        `Часы работы: ${STORE_FACTS.contacts.hours}`
      ].join("\n")
    );

    if (asksAboutRussianCity) {
      facts.push(
        "ПОДСКАЗКА ПО ДОСТАВКЕ В РОССИЙСКИЕ ГОРОДА: если вопрос про город вроде Волгограда, нужно прямо сказать, что ориентир по сроку — обычно 2-7 дней по России, стоимость от 180 ₽, а точный срок зависит от выбранного способа доставки и показывается в корзине."
      );
    }
  }

  if (asksAboutRomana) {
    facts.push(
      [
        "ФАКТЫ О РОМАНЕ:",
        STORE_FACTS.romana.short,
        STORE_FACTS.romana.bio,
        STORE_FACTS.romana.mission,
        STORE_FACTS.romana.values,
        STORE_FACTS.romana.socials
      ].join("\n")
    );
  }

  if (asksAboutRomanaSocials) {
    facts.push(
      "ФАКТЫ О СОЦСЕТЯХ РОМАНЫ: перечисли ссылки на Instagram, RUTUBE, VK, Telegram и MAX из предоставленных фактов без оговорок про отсутствие информации."
    );
  }

  if (matchedPeople.length) {
    facts.push(
      [
        "ФАКТЫ О ЛЮДЯХ ИЗ ОКРУЖЕНИЯ ПРОЕКТА:",
        ...matchedPeople.map((person) => person.summary)
      ].join("\n")
    );
  }

  return facts.join("\n\n");
}

async function createOpenAIResponse(messages, model) {
  const relevantFacts = getRelevantStoreFacts(latestUserMessage(messages));
  const input = [
    {
      role: "system",
      content: [{ type: "input_text", text: SYSTEM_PROMPT }]
    }
  ];

  if (relevantFacts) {
    input.push({
      role: "system",
      content: [{ type: "input_text", text: relevantFacts }]
    });
  }

  input.push(
    ...messages.map((message) => ({
      role: message.role,
      content: [{ type: "input_text", text: message.content }]
    }))
  );

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "User-Agent": "music-book-gpt/0.1",
    "X-Title": SITE_NAME,
    Referer: SITE_URL
  };

  if (OPENAI_PROJECT) {
    headers["OpenAI-Project"] = OPENAI_PROJECT;
  }

  const response = await fetch(`${OPENAI_BASE_URL.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: model || OPENAI_MODEL, input })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Model request failed. Check server logs for details.";
    throw new Error(message);
  }

  const text = Array.isArray(data.output)
    ? data.output
        .flatMap((item) => item.content || [])
        .filter((item) => item.type === "output_text")
        .map((item) => item.text)
        .join("\n")
        .trim()
    : "";

  if (!text) {
    throw new Error("The model returned no text output.");
  }

  return text;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      configured: Boolean(OPENAI_API_KEY),
      upstream: OPENAI_BASE_URL,
      defaultModel: OPENAI_MODEL
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/console/config") {
    sendJson(res, 200, { locked: Boolean(CONSOLE_PASSWORD) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/console/unlock") {
    try {
      const body = await parseRequestBody(req);
      if (!CONSOLE_PASSWORD) {
        sendJson(res, 200, { ok: true, token: "", locked: false });
        return;
      }
      if (body.password !== CONSOLE_PASSWORD) {
        sendJson(res, 401, { error: "Wrong console password." });
        return;
      }
      sendJson(res, 200, { ok: true, token: createConsoleToken(), locked: false });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Could not unlock console." });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/conversations") {
    try {
      const body = await parseRequestBody(req);
      const conversation = createConversation(typeof body.modelOverride === "string" ? body.modelOverride.trim() : "");
      const saved = saveConversation(conversation);
      sendJson(res, 201, presentConversation(saved));
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Could not create conversation." });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tilda/webhook") {
    try {
      const body = await parseRequestBody(req);
      if (!verifyTildaWebhookSecret(req, body)) {
        sendJson(res, 401, { error: "Invalid Tilda webhook secret." });
        return;
      }

      const incomingOrder = inferOrderFromPayload(body);
      const existingOrder = loadOrder(incomingOrder.id);
      const order = saveOrder(mergeOrders(existingOrder, incomingOrder));

      sendJson(res, 200, { ok: true, orderId: order.id });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Could not process Tilda webhook." });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/conversations") {
    try {
      const searchText = typeof url.searchParams.get("search") === "string" ? url.searchParams.get("search").trim() : "";
      sendJson(res, 200, { conversations: listConversations(searchText) });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Could not list conversations." });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/conversations/")) {
    const conversationId = url.pathname.split("/").pop();
    const conversation = loadConversation(conversationId);
    if (!conversation) {
      sendJson(res, 404, { error: "Conversation not found." });
      return;
    }
    sendJson(res, 200, presentConversation(conversation));
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/conversations/")) {
    if (!requireConsoleAuth(req, res)) {
      return;
    }

    try {
      const conversationId = url.pathname.split("/").pop();
      const conversation = loadConversation(conversationId);
      if (!conversation) {
        sendJson(res, 404, { error: "Conversation not found." });
        return;
      }

      const body = await parseRequestBody(req);
      if (typeof body.modelOverride === "string") {
        conversation.modelOverride = body.modelOverride.trim();
      }
      if (typeof body.title === "string" && body.title.trim()) {
        conversation.title = body.title.trim().slice(0, 120);
      }

      const saved = saveConversation(conversation);
      sendJson(res, 200, presentConversation(saved));
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Could not update conversation." });
    }
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/conversations/")) {
    if (!requireConsoleAuth(req, res)) {
      return;
    }

    try {
      const conversationId = url.pathname.split("/").pop();
      if (!deleteConversation(conversationId)) {
        sendJson(res, 404, { error: "Conversation not found." });
        return;
      }

      sendJson(res, 200, { ok: true, id: conversationId });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Could not delete conversation." });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    if (!OPENAI_API_KEY) {
      sendJson(res, 500, { error: "OPENAI_API_KEY is not configured on the server." });
      return;
    }

    try {
      const body = await parseRequestBody(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        sendJson(res, 400, { error: "A non-empty message is required." });
        return;
      }

      let conversation = loadConversation(body.conversationId);
      if (!conversation) {
        conversation = createConversation(typeof body.modelOverride === "string" ? body.modelOverride.trim() : "");
      }

      if (typeof body.modelOverride === "string") {
        conversation.modelOverride = body.modelOverride.trim();
      }

      conversation.messages.push({ role: "user", content: message });
      updateConversationTitle(conversation);

      const orderReply = getOrderAssistantReply(message);
      const directReply = orderReply || getDirectAssistantReply(message);
      const reply = directReply || (await createOpenAIResponse(conversation.messages, conversation.modelOverride || OPENAI_MODEL));
      conversation.messages.push({ role: "assistant", content: reply });
      const saved = saveConversation(conversation);

      sendJson(res, 200, { reply, conversation: presentConversation(saved) });
    } catch (error) {
      console.error("[chat]", error);
      sendJson(res, 500, { error: error.message || "Unexpected server error." });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res, url.pathname);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`Music Book GPT listening on http://${HOST}:${PORT}`);
});













































