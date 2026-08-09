export async function runMigrations(): Promise<void> {
  // Phase 2 owns real Drizzle migrations. Phase 0 keeps the script entrypoint stable.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
}
