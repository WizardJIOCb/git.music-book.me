const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const ORDERS_DIR = path.join(DATA_DIR, "orders");

ensureDir(DATA_DIR);
ensureDir(ORDERS_DIR);

const ORDER_QUERY_STOP_WORDS = new Set([
  "а",
  "адрес",
  "будет",
  "в",
  "где",
  "дата",
  "доставить",
  "доставка",
  "доставки",
  "доставку",
  "его",
  "ее",
  "есть",
  "заказ",
  "заказа",
  "заказе",
  "и",
  "или",
  "имя",
  "какая",
  "какие",
  "какой",
  "когда",
  "ли",
  "мой",
  "моя",
  "на",
  "найди",
  "номер",
  "номеру",
  "о",
  "по",
  "получателя",
  "получатель",
  "посылка",
  "почта",
  "проверь",
  "проверьте",
  "пожалуйста",
  "с",
  "скажи",
  "скажите",
  "сколько",
  "способ",
  "статус",
  "стоил",
  "стоило",
  "стоимость",
  "телефон",
  "трек",
  "трекномер",
  "трекномерy",
  "трекномерa",
  "трекномерe",
  "трекномером",
  "трекномеру",
  "трекномер",
  "трек-номер",
  "у",
  "что",
  "это"
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeLooseText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value) {
  return normalizeLooseText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@.+/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.length === 10) {
    return `7${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }
  return digits;
}

function normalizeTrackNumber(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function normalizeOrderId(value) {
  const raw = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return raw.slice(0, 120);
}

function splitFullName(value) {
  const customerName = normalizeLooseText(value);
  if (!customerName) {
    return { customerName: "", firstName: "", lastName: "" };
  }

  const parts = customerName.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return {
      customerName,
      firstName: parts[0] || "",
      lastName: ""
    };
  }

  if (parts.length === 2) {
    return {
      customerName,
      firstName: parts[0] || "",
      lastName: parts[1] || ""
    };
  }

  return {
    customerName,
    firstName: parts[1] && parts.length >= 2 ? parts[1] : parts[0] || "",
    lastName: parts[0] || ""
  };
}

function parseDecimal(value) {
  const raw = normalizeLooseText(value);
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferCurrency(...values) {
  const combined = values.map((value) => normalizeLooseText(value)).join(" ");
  if (/руб|₽|rub/i.test(combined)) {
    return "RUB";
  }
  if (/usd|\$/i.test(combined)) {
    return "USD";
  }
  if (/eur|€/i.test(combined)) {
    return "EUR";
  }
  return "";
}

function parseDate(value) {
  const raw = normalizeLooseText(value);
  if (!raw) {
    return "";
  }

  const normalized = raw.replace(" ", "T");
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? raw : new Date(timestamp).toISOString();
}

function deriveCountry(row) {
  const location = normalizeLooseText(row["Местоположение"]);
  if (location.includes("/")) {
    return location.split("/")[0].toUpperCase();
  }

  const address = normalizeLooseText(firstFilled(row["country"], row["Страна"], row["Адрес доставки__2"], row["Адрес доставки"]));
  if (/росси|moscow|москва|ru\b/i.test(address)) {
    return "RU";
  }
  return "";
}

function deriveCity(row) {
  const direct = normalizeLooseText(firstFilled(row["Город"], row["city"]));
  if (direct) {
    return direct;
  }

  const address = normalizeLooseText(firstFilled(row["Адрес доставки__2"], row["Адрес доставки"]));
  const match = address.match(/(?:^|,\s*)(?:г\.?\s*)?([A-ZА-ЯЁ][^,]+?)(?:,\s*ул|\s*,\s*\d{5,6}\b|$)/i);
  if (match) {
    return normalizeLooseText(match[1]);
  }

  const location = normalizeLooseText(row["Местоположение"]);
  if (location.includes("/")) {
    return location.split("/").slice(1).join("/").replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  return "";
}

function derivePostalCode(row) {
  const direct = normalizeLooseText(firstFilled(row["Индекс"], row["postalCode"], row["zip"]));
  if (direct) {
    return direct;
  }

  const address = normalizeLooseText(firstFilled(row["Адрес доставки__2"], row["Адрес доставки"]));
  const match = address.match(/\b\d{5,6}\b/);
  return match ? match[0] : "";
}

function parseItems(rawItems) {
  const itemsSummary = normalizeLooseText(String(rawItems || "").replace(/Romanas Book(?=\S)/g, "Romanas Book "));
  if (!itemsSummary) {
    return [];
  }

  const chunks = itemsSummary
    .split(/\s*(?:\r?\n|;|\s\+\s)\s*/g)
    .map((item) => normalizeLooseText(item))
    .filter(Boolean);

  return chunks.map((chunk) => {
    const quantityMatch = chunk.match(/(?:x|х)\s*(\d+)\b/i);
    const priceMatch = chunk.match(/(?:≡|=)\s*([\d.,]+)/);
    const title = normalizeLooseText(
      chunk
        .replace(/(?:,?\s*(?:pc|шт)\s*(?:x|х)\s*\d+\b.*)$/i, "")
        .replace(/(?:≡|=)\s*[\d.,]+\s*$/i, "")
        .replace(/\(\d{3,}\)\s*$/, "")
    );

    return {
      title: title || chunk,
      quantity: quantityMatch ? Number(quantityMatch[1]) : 1,
      unitPrice: priceMatch ? parseDecimal(priceMatch[1]) : null,
      raw: chunk
    };
  });
}

function firstFilled(...values) {
  for (const value of values) {
    const normalized = normalizeLooseText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeFlags(values) {
  return Array.from(new Set((values || []).map((value) => normalizeLooseText(value)).filter(Boolean)));
}

function orderPath(orderId) {
  return path.join(ORDERS_DIR, `${orderId}.json`);
}

function loadOrder(orderId) {
  const safeId = normalizeOrderId(orderId);
  if (!safeId) {
    return null;
  }

  const filePath = orderPath(safeId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    parsed.id = safeId;
    return parsed;
  } catch {
    return null;
  }
}

function saveOrder(order) {
  const now = new Date().toISOString();
  const nextOrder = {
    ...order,
    id: normalizeOrderId(order.id) || crypto.randomBytes(9).toString("base64url"),
    createdAt: order.createdAt || now,
    updatedAt: order.updatedAt || now,
    phoneNormalized: normalizePhone(order.phoneNormalized || order.phone),
    trackNumber: normalizeTrackNumber(order.trackNumber),
    flags: normalizeFlags(order.flags),
    items: Array.isArray(order.items) ? order.items : [],
    raw: order.raw && typeof order.raw === "object" ? order.raw : {}
  };

  fs.writeFileSync(orderPath(nextOrder.id), JSON.stringify(nextOrder, null, 2), "utf8");
  return nextOrder;
}

function listOrders() {
  return fs
    .readdirSync(ORDERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => loadOrder(path.basename(entry.name, ".json")))
    .filter(Boolean);
}

function uniqueHeaders(headerRow) {
  const counters = new Map();
  return headerRow.map((header) => {
    const base = normalizeLooseText(header) || "column";
    const count = counters.get(base) || 0;
    counters.set(base, count + 1);
    return count === 0 ? base : `${base}__${count + 1}`;
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ";") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function parseTildaCsvFile(filePath) {
  const csvText = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(csvText).filter((row) => row.some((value) => normalizeLooseText(value)));
  if (!rows.length) {
    return [];
  }

  const headers = uniqueHeaders(rows[0]);
  return rows.slice(1).map((row) => {
    const payload = {};
    headers.forEach((header, index) => {
      payload[header] = row[index] || "";
    });
    return payload;
  });
}

function normalizeTildaCsvRow(row) {
  const createdAt = parseDate(row.Date);
  const paymentDate = parseDate(row["Дата оплаты"]);
  const customerFields = splitFullName(firstFilled(row["Получатель доставки__2"], row["Получатель доставки"], row.Name));
  const phone = firstFilled(row.Phone);
  const phoneNormalized = normalizePhone(phone);
  const itemsSummary = normalizeLooseText(firstFilled(row["Товары в заказе"], row.Input).replace(/Romanas Book(?=\S)/g, "Romanas Book "));
  const items = parseItems(itemsSummary);
  const orderStatus = firstFilled(row.Stage, row["Тип обращения"], row.formname, row["Status ID"]);
  const deliveryStatus = "";
  const deliveryMethod = firstFilled(row["Служба доставки"], row["Доставка"]);
  const deliveryMethodName = firstFilled(row["Название доставки"], row["Служба доставки"], row["Доставка"]);
  const deliveryPriceRaw = firstFilled(row["Стоимость доставки__2"], row["Стоимость доставки"]);
  const totalPriceRaw = firstFilled(row["Сумма заказа__2"], row["Сумма заказа"]);
  const currency = inferCurrency(totalPriceRaw, deliveryPriceRaw, itemsSummary) || (totalPriceRaw || deliveryPriceRaw ? "RUB" : "");
  const deliveryPrice = parseDecimal(deliveryPriceRaw);
  const totalPrice = parseDecimal(totalPriceRaw);
  const trackNumber = normalizeTrackNumber(firstFilled(row["Трек номер__2"], row["Трек номер"]));
  const address = firstFilled(row["Адрес доставки__2"], row["Адрес доставки"]);
  const city = deriveCity(row);
  const postalCode = derivePostalCode(row);
  const country = deriveCountry(row);
  const flags = normalizeFlags([
    row["Тип обращения"],
    row["Status ID"] ? `status-id:${row["Status ID"]}` : "",
    row.paymentsystem ? `payment-system:${row.paymentsystem}` : "",
    row.utm_source ? `utm-source:${row.utm_source}` : ""
  ]);
  const notes = firstFilled(
    row.Input && itemsSummary !== row.Input ? row.Input : "",
    row.Промокод ? `Промокод: ${row.Промокод}` : "",
    row.Скидка ? `Скидка: ${row.Скидка}` : ""
  );
  const orderId = normalizeOrderId(firstFilled(row["ID заказа"], row["ID платежа"], row.tranid, row.formid));

  return {
    id: orderId || crypto.randomBytes(9).toString("base64url"),
    source: "tilda-csv",
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: paymentDate || createdAt || new Date().toISOString(),
    customerName: customerFields.customerName,
    firstName: customerFields.firstName,
    lastName: customerFields.lastName,
    phone,
    phoneNormalized,
    email: firstFilled(row.Email),
    address,
    city,
    postalCode,
    country,
    trackNumber,
    orderStatus,
    deliveryStatus,
    paymentStatus: firstFilled(row["Статус оплаты"]),
    paymentMethod: firstFilled(row["Способ оплаты"], row.paymentsystem),
    deliveryMethod,
    deliveryMethodName,
    deliveryPrice,
    deliveryDate: "",
    totalPrice,
    currency,
    items,
    itemsSummary,
    flags,
    notes,
    raw: {
      source: "tilda-csv",
      row
    }
  };
}

function pickField(payload, patterns) {
  const entries = Object.entries(payload || {});
  for (const [key, value] of entries) {
    const normalizedKey = normalizeSearchText(key);
    if (patterns.some((pattern) => pattern.test(normalizedKey))) {
      return Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return "";
}

function inferOrderFromPayload(payload) {
  const address = firstFilled(
    pickField(payload, [/адрес/, /address/, /street/, /улиц/]),
    pickField(payload, [/delivery.*address/, /shipping.*address/])
  );
  const customerFields = splitFullName(
    firstFilled(
      pickField(payload, [/фио/, /получател/, /заказчик/, /customer/, /client/, /^name$/, /full.?name/]),
      pickField(payload, [/first.?name/, /^name$/]),
      pickField(payload, [/last.?name/, /surname/, /family/])
    )
  );
  const phone = firstFilled(pickField(payload, [/телефон/, /phone/, /mobile/]));
  const phoneNormalized = normalizePhone(phone);
  const itemsSummary = firstFilled(pickField(payload, [/товар/, /items?/, /products?/, /basket/, /cart/]));
  const items = parseItems(itemsSummary);
  const orderId = normalizeOrderId(
    firstFilled(
      pickField(payload, [/^id$/, /order.?id/, /lead.?id/, /request/, /transaction/, /tranid/, /payment.?id/, /formid/])
    )
  );
  const deliveryPriceRaw = firstFilled(pickField(payload, [/delivery.*price/, /стоим.*достав/]));
  const totalPriceRaw = firstFilled(pickField(payload, [/total/, /sum/, /сумм/]));
  const currency = inferCurrency(totalPriceRaw, deliveryPriceRaw, pickField(payload, [/currency/, /валют/])) ||
    (totalPriceRaw || deliveryPriceRaw ? "RUB" : "");

  return {
    id: orderId || crypto.randomBytes(9).toString("base64url"),
    source: "tilda-webhook",
    createdAt: parseDate(firstFilled(pickField(payload, [/created/, /date/]), new Date().toISOString())) || new Date().toISOString(),
    updatedAt: parseDate(firstFilled(pickField(payload, [/updated/]), new Date().toISOString())) || new Date().toISOString(),
    customerName: customerFields.customerName,
    firstName: customerFields.firstName,
    lastName: customerFields.lastName,
    phone,
    phoneNormalized,
    email: firstFilled(pickField(payload, [/email/, /e-mail/, /почт/])),
    address,
    city: firstFilled(pickField(payload, [/город/, /city/])),
    postalCode: firstFilled(pickField(payload, [/индекс/, /zip/, /postal/])),
    country: firstFilled(pickField(payload, [/country/, /страна/])),
    trackNumber: normalizeTrackNumber(firstFilled(pickField(payload, [/трек/, /track/]))),
    orderStatus: firstFilled(pickField(payload, [/order.*status/, /^status$/, /статус/])),
    deliveryStatus: firstFilled(pickField(payload, [/delivery.*status/, /статус.*достав/])),
    paymentStatus: firstFilled(pickField(payload, [/payment.*status/, /статус.*оплат/])),
    paymentMethod: firstFilled(pickField(payload, [/payment.*method/, /способ.*оплат/, /paymentsystem/])),
    deliveryMethod: firstFilled(pickField(payload, [/delivery.*method/, /^delivery$/, /доставк/])),
    deliveryMethodName: firstFilled(pickField(payload, [/delivery.*name/, /^delivery$/, /назван.*достав/])),
    deliveryPrice: parseDecimal(deliveryPriceRaw),
    deliveryDate: firstFilled(pickField(payload, [/delivery.*date/, /дата.*достав/])),
    totalPrice: parseDecimal(totalPriceRaw),
    currency,
    items,
    itemsSummary,
    flags: normalizeFlags([pickField(payload, [/source/, /formname/])]),
    notes: firstFilled(pickField(payload, [/коммент/, /comment/, /note/, /примеч/])),
    raw: {
      source: "tilda-webhook",
      payload
    }
  };
}

function mergeOrders(existingOrder, incomingOrder) {
  const merged = {
    ...(existingOrder || {}),
    ...incomingOrder
  };

  const createdAt = existingOrder?.createdAt || incomingOrder.createdAt || new Date().toISOString();
  const updatedAt = incomingOrder.updatedAt || new Date().toISOString();
  merged.createdAt = createdAt;
  merged.updatedAt = updatedAt;
  merged.flags = normalizeFlags([...(existingOrder?.flags || []), ...(incomingOrder.flags || [])]);
  merged.raw = {
    ...(existingOrder?.raw || {}),
    ...(incomingOrder.raw || {}),
    updatedAt: updatedAt
  };
  merged.phoneNormalized = normalizePhone(merged.phoneNormalized || merged.phone);
  merged.trackNumber = normalizeTrackNumber(merged.trackNumber);
  merged.items = Array.isArray(merged.items) ? merged.items : [];
  return merged;
}

function tokenizeOrderQuery(text) {
  return normalizeSearchText(text)
    .split(" ")
    .filter((token) => token.length >= 2 && !ORDER_QUERY_STOP_WORDS.has(token));
}

function extractOrderLookupCriteria(text) {
  const rawText = normalizeLooseText(text);
  const normalizedText = normalizeSearchText(text);
  const phoneFromContext =
    rawText.match(/(?:телефон\w*|phone)\D{0,20}(\+?\d[\d\s().-]{8,}\d)/i)?.[1] || "";
  const trackFromContext =
    rawText.match(/(?:трек\w*|track)\D{0,20}([A-ZА-Я0-9][A-ZА-Я0-9-]{5,})/i)?.[1] || "";
  const phoneCandidates = rawText.match(/(?:\+?\d[\d\s().-]{8,}\d)/g) || [];
  const normalizedPhoneCandidates = phoneCandidates
    .map((item) => normalizePhone(item))
    .filter((item) => item.length >= 10);
  const phone = normalizePhone(phoneFromContext) || (!trackFromContext ? normalizedPhoneCandidates[0] || "" : "");
  const possibleTrackTokens = rawText.match(/[A-ZА-Я0-9-]{6,}/gi) || [];
  const trackCandidates = possibleTrackTokens
    .map((item) => normalizeTrackNumber(item))
    .filter((item) => item.length >= 6);
  const trackNumber =
    normalizeTrackNumber(trackFromContext) ||
    (!phoneFromContext
      ? trackCandidates.find((item) => item !== phone && /[A-Z]/.test(item)) ||
        trackCandidates.find((item) => item !== phone && !normalizedPhoneCandidates.includes(item)) ||
        ""
      : "") ||
    "";

  return {
    phone,
    trackNumber: trackNumber || "",
    rawText,
    queryTokens: tokenizeOrderQuery(normalizedText)
  };
}

function buildOrderSearchIndex(order) {
  const nameText = normalizeSearchText(
    [order.customerName, order.firstName, order.lastName, order.email].filter(Boolean).join(" ")
  );
  const addressText = normalizeSearchText(
    [order.address, order.city, order.postalCode, order.country].filter(Boolean).join(" ")
  );

  return {
    nameText,
    addressText,
    combinedText: normalizeSearchText(`${nameText} ${addressText}`),
    phone: normalizePhone(order.phoneNormalized || order.phone),
    trackNumber: normalizeTrackNumber(order.trackNumber)
  };
}

function matchByPhone(orders, phone) {
  if (!phone || phone.length < 10) {
    return [];
  }

  return orders.filter((order) => {
    const orderPhone = normalizePhone(order.phoneNormalized || order.phone);
    return orderPhone && (orderPhone === phone || orderPhone.endsWith(phone.slice(-10)));
  });
}

function matchByTrack(orders, trackNumber) {
  if (!trackNumber || trackNumber.length < 6) {
    return [];
  }

  return orders.filter((order) => normalizeTrackNumber(order.trackNumber) === trackNumber);
}

function matchByNameAndAddress(orders, queryTokens) {
  if (!Array.isArray(queryTokens) || queryTokens.length < 3) {
    return [];
  }

  return orders.filter((order) => {
    const index = buildOrderSearchIndex(order);
    const nameHits = queryTokens.filter((token) => index.nameText.includes(token));
    const addressHits = queryTokens.filter((token) => index.addressText.includes(token));

    if (nameHits.length < 2 || addressHits.length < 1) {
      return false;
    }

    return queryTokens.every((token) => index.combinedText.includes(token));
  });
}

function findMatchingOrders(criteria, orders = listOrders()) {
  if (!orders.length) {
    return [];
  }

  if (criteria.trackNumber && criteria.phone) {
    const byTrack = matchByTrack(orders, criteria.trackNumber);
    return byTrack.filter((order) => {
      const orderPhone = normalizePhone(order.phoneNormalized || order.phone);
      return orderPhone && (orderPhone === criteria.phone || orderPhone.endsWith(criteria.phone.slice(-10)));
    });
  }

  if (criteria.trackNumber) {
    return matchByTrack(orders, criteria.trackNumber);
  }

  if (criteria.phone) {
    return matchByPhone(orders, criteria.phone);
  }

  return matchByNameAndAddress(orders, criteria.queryTokens || []);
}

function isOrderQuestion(text) {
  return /(заказ|доставк|трек|track|посылк|отправлен|статус|где мой|когда достав|отслед|crm|оплат)/i.test(text);
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 4) {
    return phone || "";
  }
  return `***${normalized.slice(-4)}`;
}

function formatMoney(value, currency) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  if (currency === "RUB" || !currency) {
    return `${numeric.toFixed(2).replace(/\.00$/, "")} ₽`;
  }

  return `${numeric.toFixed(2).replace(/\.00$/, "")} ${currency}`;
}

function formatOrderDate(value) {
  const raw = normalizeLooseText(value);
  if (!raw) {
    return "";
  }

  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    return raw;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function deriveComputedOrderStatus(order) {
  const orderStatus = normalizeSearchText(order.orderStatus);
  const deliveryStatus = normalizeSearchText(order.deliveryStatus);
  const paymentStatus = normalizeSearchText(order.paymentStatus);
  const combined = normalizeSearchText(`${order.orderStatus || ""} ${order.deliveryStatus || ""} ${order.paymentStatus || ""}`);

  const deliveredPatterns = [
    /доставлен/,
    /вручен/,
    /получен/,
    /получила/,
    /получил/,
    /заверш/,
    /выполн/,
    /закрыт/
  ];
  const cancelledPatterns = [
    /отмен/,
    /cancel/,
    /возврат/,
    /refund/,
    /не выкуп/,
    /неполуч/
  ];
  const inTransitPatterns = [
    /в пути/,
    /отправлен/,
    /передан/,
    /доставк/,
    /shipment/,
    /transit/
  ];
  const paidPatterns = [
    /оплачен/,
    /успешн/,
    /paid/
  ];

  const isDelivered = includesAny(combined, deliveredPatterns);
  const isCancelled = includesAny(combined, cancelledPatterns);
  const isInTransit = !isDelivered && includesAny(combined, inTransitPatterns);
  const isPaid = includesAny(paymentStatus, paidPatterns) || (!paymentStatus && includesAny(orderStatus, paidPatterns));
  const isCompleted = isDelivered || includesAny(orderStatus, [/заверш/, /выполн/, /закрыт/]);

  if (isCancelled) {
    return {
      finalStatus: "заказ отменён",
      isDelivered: false,
      isCompleted: false
    };
  }

  if (isDelivered) {
    return {
      finalStatus: "заказ доставлен",
      isDelivered: true,
      isCompleted: true
    };
  }

  if (isCompleted) {
    return {
      finalStatus: "заказ выполнен",
      isDelivered: false,
      isCompleted: true
    };
  }

  if (isInTransit) {
    return {
      finalStatus: "заказ в доставке",
      isDelivered: false,
      isCompleted: false
    };
  }

  if (isPaid) {
    return {
      finalStatus: "заказ оплачен, доставка не подтверждена",
      isDelivered: false,
      isCompleted: false
    };
  }

  return {
    finalStatus: "финальный статус не подтверждён",
    isDelivered: false,
    isCompleted: false
  };
}

function formatOrderReply(matches, criteria) {
  if (!matches.length) {
    if (criteria.queryTokens?.length) {
      return "Не удалось безопасно подтвердить заказ по этим данным. Для точного поиска лучше указать телефон, трек-номер или полные ФИО вместе с адресом доставки.";
    }
    return "Я могу помочь с заказом. Для поиска лучше указать телефон, трек-номер или полные ФИО вместе с адресом доставки.";
  }

  if (matches.length > 1) {
    return "Нашлось несколько похожих заказов. Чтобы ничего лишнего не раскрывать, укажи, пожалуйста, телефон или трек-номер.";
  }

  const order = matches[0];
  const computed = deriveComputedOrderStatus(order);
  const lines = ["Нашёл заказ."];

  if (order.customerName) {
    lines.push(`Получатель: ${order.customerName}`);
  }
  if (order.createdAt) {
    lines.push(`Дата заказа: ${formatOrderDate(order.createdAt)}`);
  }
  if (computed.finalStatus) {
    lines.push(`Итог: ${computed.finalStatus}`);
  }
  if (order.orderStatus) {
    lines.push(`Статус заказа: ${order.orderStatus}`);
  }
  if (order.deliveryStatus) {
    lines.push(`Статус доставки: ${order.deliveryStatus}`);
  }
  if (order.deliveryMethodName || order.deliveryMethod) {
    lines.push(`Способ доставки: ${order.deliveryMethodName || order.deliveryMethod}`);
  }
  if (order.totalPrice !== null && order.totalPrice !== undefined) {
    lines.push(`Стоимость заказа: ${formatMoney(order.totalPrice, order.currency)}`);
  }
  if (order.deliveryPrice !== null && order.deliveryPrice !== undefined) {
    lines.push(`Стоимость доставки: ${formatMoney(order.deliveryPrice, order.currency)}`);
  }
  if (order.deliveryDate) {
    lines.push(`Дата доставки: ${formatOrderDate(order.deliveryDate)}`);
  }
  if (order.trackNumber) {
    lines.push(`Трек-номер: ${order.trackNumber}`);
  }
  if (order.itemsSummary) {
    lines.push(`Состав заказа: ${order.itemsSummary}`);
  }
  if (order.phone) {
    lines.push(`Телефон в заказе: ${maskPhone(order.phone)}`);
  }

  return lines.join("\n");
}

module.exports = {
  ORDERS_DIR,
  extractOrderLookupCriteria,
  findMatchingOrders,
  formatOrderReply,
  inferOrderFromPayload,
  isOrderQuestion,
  listOrders,
  loadOrder,
  mergeOrders,
  normalizeLooseText,
  normalizeOrderId,
  normalizePhone,
  normalizeSearchText,
  normalizeTildaCsvRow,
  normalizeTrackNumber,
  parseTildaCsvFile,
  saveOrder
};
