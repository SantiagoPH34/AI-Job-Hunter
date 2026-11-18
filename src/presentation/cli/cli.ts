import "dotenv/config";
import { createAppContainer } from "../../infrastructure/di/container.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "run";
  const dryRun = args.includes("--dry-run");
  const ignoreSeen = args.includes("--ignore-seen");

  const container = createAppContainer();

  if (command === "test-telegram") {
    const res = await container.testNotificationUseCase.sendTest();
    console.log(`✅ ${res.message}`);
    return;
  }

  if (command === "run") {
    const summary = await container.huntJobsUseCase.execute({
      dryRun,
      ignoreSeen: dryRun || ignoreSeen,
      notifyTelegram: !dryRun,
    });

    console.log("\n=== RESUMEN ===");
    console.log(
      `Evaluadas: ${summary.evaluatedCount} | Aprobadas: ${summary.qualifiedCount} | Telegram: ${summary.telegramSent ? "Enviado" : "No enviado"}`
    );

    const top = summary.results.slice(0, 10);
    for (const job of top) {
      const tag = job.keep ? "✅" : "•";
      console.log(
        `${tag} [${job.score}/10 | ${job.scoredBy}] ${job.title} @ ${job.company} (${job.location} · ${job.language.toUpperCase()} · ${job.source})`
      );
      console.log(`   ${job.reasoning}`);
      console.log(`   ${job.url}`);
    }
    return;
  }

  console.error(`Comando desconocido: ${command}. Usa "run", "run --dry-run" o "test-telegram".`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
