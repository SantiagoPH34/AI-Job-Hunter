const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "ai-job-hunter/1.0 (+https://github.com/SantiagoPH34/AI-Job-Hunter)",
  Accept: "application/json, application/xml, text/xml, */*",
};

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...DEFAULT_HEADERS,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyPreview = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status} ${response.statusText}${bodyPreview ? `: ${bodyPreview.slice(0, 160)}` : ""}`
      );
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const res = await fetchWithTimeout(url, init, timeoutMs);
  return (await res.json()) as T;
}

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<string> {
  const res = await fetchWithTimeout(url, init, timeoutMs);
  return await res.text();
}

export function stripHtml(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectLanguage(text: string): string {
  const sample = text.toLowerCase().slice(0, 1800);
  if (!sample) return "en";

  const spanishMarkers = [
    " buscamos ",
    " experiencia ",
    " requisitos ",
    " conocimientos ",
    " empresa ",
    " desarrollo ",
    " salario ",
    " remoto ",
    " trabajo ",
    " puesto ",
    " años ",
    " habilidades ",
    " inglés ",
  ];

  const englishMarkers = [
    " we are ",
    " looking for ",
    " experience ",
    " requirements ",
    " responsibilities ",
    " skills ",
    " engineering ",
    " remote ",
    " salary ",
    " benefits ",
    " years ",
    " team ",
    " developer ",
  ];

  const germanMarkers = [" wir suchen ", " erfahrung ", " entwickler ", " kenntnisse ", " deutsch ", " vollzeit "];
  const portugueseMarkers = [
    " estamos procurando ",
    " vaga ",
    " experiência ",
    " requisitos ",
    " desenvolvimento ",
    " trabalho ",
  ];

  const countHits = (markers: string[]) =>
    markers.reduce((acc, marker) => acc + (sample.includes(marker) ? 1 : 0), 0);

  const esHits = countHits(spanishMarkers);
  const enHits = countHits(englishMarkers);
  const deHits = countHits(germanMarkers);
  const ptHits = countHits(portugueseMarkers);

  const maxHits = Math.max(esHits, enHits, deHits, ptHits);
  if (maxHits === 0) return "en";
  if (enHits === maxHits) return "en";
  if (esHits === maxHits) return "es";
  if (deHits === maxHits) return "de";
  return "pt";
}

const COUNTRY_NAME_TO_CODE: Array<[RegExp, string]> = [
  [/\b(worldwide|anywhere|global|international|everywhere)\b/i, "GLOBAL"],
  [/\b(united states|usa|u\.s\.|us only|san francisco|new york|austin|seattle)\b/i, "US"],
  [/\b(united kingdom|uk|london|england|scotland|manchester)\b/i, "GB"],
  [/\b(canada|toronto|vancouver|montreal)\b/i, "CA"],
  [/\b(germany|deutschland|berlin|munich|hamburg)\b/i, "DE"],
  [/\b(spain|españa|madrid|barcelona)\b/i, "ES"],
  [/\b(netherlands|amsterdam|rotterdam|holland)\b/i, "NL"],
  [/\b(australia|sydney|melbourne)\b/i, "AU"],
  [/\b(colombia|bogota|bogotá|medellin|medellín)\b/i, "CO"],
  [/\b(mexico|méxico|cdmx|guadalajara|monterrey)\b/i, "MX"],
  [/\b(argentina|buenos aires|cordoba)\b/i, "AR"],
  [/\b(brazil|brasil|sao paulo|são paulo)\b/i, "BR"],
  [/\b(chile|santiago)\b/i, "CL"],
  [/\b(peru|perú|lima)\b/i, "PE"],
  [/\b(uruguay|montevideo)\b/i, "UY"],
  [/\b(ecuador|quito|guayaquil)\b/i, "EC"],
  [/\b(costa rica|san jose|san josé)\b/i, "CR"],
  [/\b(panama|panamá)\b/i, "PA"],
  [/\b(latam|latin america|south america)\b/i, "LATAM"],
  [/\b(europe|emea|eu)\b/i, "EU"],
  [/\b(france|paris)\b/i, "FR"],
  [/\b(portugal|lisbon|porto)\b/i, "PT"],
  [/\b(poland|warsaw|krakow)\b/i, "PL"],
  [/\b(india|bangalore|bengaluru|mumbai|hyderabad)\b/i, "IN"],
];

export function inferCountryCode(locationRaw: string, isRemote: boolean): string {
  const loc = locationRaw.trim();
  if (!loc) return isRemote ? "GLOBAL" : "UNKNOWN";

  for (const [pattern, code] of COUNTRY_NAME_TO_CODE) {
    if (pattern.test(loc)) {
      return code;
    }
  }

  if (/^[A-Z]{2}$/.test(loc)) return loc;
  return isRemote ? "GLOBAL" : "OTHER";
}

export function normalizeDate(raw: unknown): string {
  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  return new Date().toISOString();
}

export function formatSalary(
  min?: number | string | null,
  max?: number | string | null,
  currency = "USD"
): string | undefined {
  const minNum = typeof min === "string" ? Number(min) : min;
  const maxNum = typeof max === "string" ? Number(max) : max;
  const hasMin = typeof minNum === "number" && Number.isFinite(minNum) && minNum > 0;
  const hasMax = typeof maxNum === "number" && Number.isFinite(maxNum) && maxNum > 0;

  if (!hasMin && !hasMax) return undefined;
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  if (hasMin && hasMax) return `${currency} ${fmt(minNum!)} - ${fmt(maxNum!)}`;
  if (hasMin) return `${currency} ${fmt(minNum!)}+`;
  return `Up to ${currency} ${fmt(maxNum!)}`;
}
