import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const port = Number(process.env.ANDA_API_SMOKE_PORT ?? "3011");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("ANDA_API_SMOKE_PORT must be a valid TCP port.");
}
const developmentActorProfileId = process.env.ANDA_DEV_ACTOR_PROFILE_ID?.trim()
  || "10000000-0000-4000-8000-000000000001";

const baseUrl = `http://127.0.0.1:${port}`;
let nextProcess;

try {
  nextProcess = spawn(process.execPath, [
    resolve("node_modules/next/dist/bin/next"),
    "dev",
    "--port",
    String(port),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANDA_DEV_ACTOR_PROFILE_ID: developmentActorProfileId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeOutput(nextProcess, "next");
  await waitForServer(`${baseUrl}/api/meetings?limit=1`, nextProcess);

  const list = await expectJson(`${baseUrl}/api/meetings?limit=1`, 200);
  if (!Array.isArray(list.items) || typeof list.total !== "number") {
    throw new Error("Meeting list smoke response did not match the public contract.");
  }
  if (list.items[0] && typeof list.items[0].category !== "string") {
    throw new Error("Meeting list smoke response did not include category.");
  }

  const search = await expectJson(`${baseUrl}/api/meetings/search?q=board&limit=1`, 200);
  if (!Array.isArray(search.items)) {
    throw new Error("Meeting search smoke response did not match the public contract.");
  }

  const invalidDetail = await expectJson(`${baseUrl}/api/meetings/not-a-uuid`, 400);
  if (invalidDetail?.error?.code !== "invalid_meeting_id") {
    throw new Error("Meeting detail smoke response did not use the expected error contract.");
  }

  const invalidRetry = await expectJson(
    `${baseUrl}/api/meetings/${randomUUID()}/analysis/retry`,
    400,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 1,
        transcript: "This field must never be accepted by the public retry action.",
      }),
    },
  );
  if (invalidRetry?.error?.code !== "invalid_request") {
    throw new Error("Analysis retry smoke response did not reject provider input.");
  }

  process.stdout.write("\nMeeting API HTTP smoke test passed.\n");
} finally {
  stopProcess(nextProcess);
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The Next.js API server stopped before becoming ready.");
    try {
      const response = await fetch(url);
      if (response.status > 0) return;
    } catch {}
    await delay(500);
  }
  throw new Error("The Next.js API server did not become ready within 60 seconds.");
}

async function expectJson(url, expectedStatus, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned a non-JSON response.`);
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned HTTP ${response.status}; expected ${expectedStatus}: ${text}`);
  }
  return body;
}

function pipeOutput(child, label) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
}

function stopProcess(child) {
  if (child && child.exitCode === null) child.kill();
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
