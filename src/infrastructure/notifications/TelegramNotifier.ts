import type { ScoredJobOffer } from "../../domain/entities/JobOffer.js";
import type { ProfileConfig } from "../../domain/entities/Profile.js";
import type { NotificationPort, NotificationResult } from "../../domain/ports/NotificationPort.js";

const TELEGRAM_MAX_LENGTH = 3900;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreBadge(score: number): string {
  if (score >= 9) return "🔥";
  if (score >= 7) return "✅";
  return "⚠️";
}

export function formatJobTelegramBlock(job: ScoredJobOffer, index: number): string {
  const skills = job.matchedSkills.length > 0 ? job.matchedSkills.slice(0, 6).join(", ") : "N/A";
  const salaryLine = job.salary ? `\n💰 <b>Salario:</b> ${escapeHtml(job.salary)}` : "";

  return [
    `${index + 1}. ${scoreBadge(job.score)} <b>${job.score}/10 — ${escapeHtml(job.title)}</b>`,
    `🏢 ${escapeHtml(job.company)} | 📍 ${escapeHtml(job.location)} (${escapeHtml(job.source)})`,
    `🗣 ${escapeHtml(job.languageFit)} | 🌍 ${escapeHtml(job.locationFit)}${salaryLine}`,
    `🛠 <b>Stack:</b> ${escapeHtml(skills)}`,
    `🤖 ${escapeHtml(job.reasoning || "Evaluado según tu perfil.")}`,
    `🔗 <a href="${escapeHtml(job.url)}">Ver y aplicar</a>`,
  ].join("\n");
}

export function buildTelegramMessages(jobs: ScoredJobOffer[], profile: ProfileConfig): string[] {
  if (jobs.length === 0) {
    return [
      `<b>🔍 AI Job Hunter — Sin novedades hoy</b>\nNo se encontraron ofertas nuevas con puntaje ≥ ${profile.scoring.minScoreToNotify}/10 para <i>${escapeHtml(profile.targetRole)}</i>.`,
    ];
  }

  const header = [
    `<b>🚀 AI Job Hunter — ${jobs.length} oferta${jobs.length === 1 ? "" : "s"} recomendada${jobs.length === 1 ? "" : "s"}</b>`,
    `🎯 Perfil: <i>${escapeHtml(profile.targetRole)}</i> (umbral ≥ ${profile.scoring.minScoreToNotify}/10)`,
    "",
  ].join("\n");

  const blocks = jobs.map((job, idx) => formatJobTelegramBlock(job, idx));
  const messages: string[] = [];
  let current = header;

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > TELEGRAM_MAX_LENGTH) {
      if (current) messages.push(current);
      if (block.length > TELEGRAM_MAX_LENGTH) {
        messages.push(block.slice(0, TELEGRAM_MAX_LENGTH));
        current = "";
      } else {
        current = block;
      }
    } else {
      current = candidate;
    }
  }

  if (current) {
    messages.push(current);
  }

  return messages;
}

export class TelegramNotifier implements NotificationPort {
  isConfigured(): boolean {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
  }

  async sendJobs(
    jobs: ScoredJobOffer[],
    profile: ProfileConfig,
    options: { notifyWhenEmpty?: boolean } = {}
  ): Promise<NotificationResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

    if (!token || !chatId) {
      return {
        sent: false,
        messageCount: 0,
        error: "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env",
      };
    }

    if (jobs.length === 0 && !options.notifyWhenEmpty) {
      return { sent: false, messageCount: 0 };
    }

    const messages = buildTelegramMessages(jobs, profile);
    for (const msg of messages) {
      await this.postHtml(token, chatId, msg);
    }

    return { sent: true, messageCount: messages.length };
  }

  async sendTestMessage(profile: ProfileConfig): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

    if (!token || !chatId) {
      throw new Error("Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en tu archivo .env primero.");
    }

    const html = [
      "<b>🤖 AI Job Hunter — Conexión exitosa</b>",
      `🎯 Rol configurado: <i>${escapeHtml(profile.targetRole)}</i>`,
      `🛠 Stack principal: ${escapeHtml(profile.primaryStack.join(", ") || "N/A")}`,
      `🌍 Remoto global: ${profile.locations.includeGlobalRemote ? "Sí" : "No"} | Países: ${escapeHtml(profile.locations.targetCountries.join(", "))}`,
      `🗣 Idiomas: ${escapeHtml(profile.languages.accepted.join(", ").toUpperCase())} (Principal: ${escapeHtml(profile.languages.primary.toUpperCase())})`,
    ].join("\n");

    await this.postHtml(token, chatId, html);
  }

  private async postHtml(token: string, chatId: string, html: string): Promise<void> {
    const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    let res: Response | undefined;
    let lastNetErr: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        break;
      } catch (err) {
        lastNetErr = err;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }

    if (!res) {
      throw lastNetErr instanceof Error ? lastNetErr : new Error(String(lastNetErr ?? "Telegram fetch failed"));
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Telegram API HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }
}
