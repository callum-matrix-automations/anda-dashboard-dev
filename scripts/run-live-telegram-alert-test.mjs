import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [
    "./node_modules/vitest/vitest.mjs",
    "run",
    "tests/integration/telegram-operational-alert.live.integration.test.ts",
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, RUN_TELEGRAM_LIVE_TEST: "true" },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error("The live Telegram test could not start.", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`The live Telegram test stopped after signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
