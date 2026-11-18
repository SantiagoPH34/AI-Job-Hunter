import type { NotificationPort } from "../../domain/ports/NotificationPort.js";
import type { ProfileRepositoryPort } from "../../domain/ports/ProfileRepositoryPort.js";
import type { SeenJobsRepositoryPort } from "../../domain/ports/SeenJobsRepositoryPort.js";

export class TestNotificationUseCase {
  constructor(
    private readonly notifier: NotificationPort,
    private readonly profileRepo: ProfileRepositoryPort,
    private readonly seenRepo: SeenJobsRepositoryPort
  ) {}

  async sendTest(): Promise<{ ok: true; message: string }> {
    const profile = this.profileRepo.load();
    await this.notifier.sendTestMessage(profile);
    return { ok: true, message: "Mensaje de prueba enviado a Telegram." };
  }

  async resendLatestQualified(): Promise<{ ok: boolean; message?: string; error?: string }> {
    const profile = this.profileRepo.load();
    const latest = this.seenRepo.loadLatestResults();
    const qualified = (latest?.results ?? []).filter((r) => r.keep);

    if (qualified.length === 0) {
      return {
        ok: false,
        error: "No hay ofertas aprobadas en la última búsqueda para enviar.",
      };
    }

    const result = await this.notifier.sendJobs(qualified, profile);
    if (!result.sent) {
      return { ok: false, error: result.error || "No se pudo enviar a Telegram." };
    }

    return {
      ok: true,
      message: `Se enviaron ${qualified.length} ofertas en ${result.messageCount} mensaje(s).`,
    };
  }
}
