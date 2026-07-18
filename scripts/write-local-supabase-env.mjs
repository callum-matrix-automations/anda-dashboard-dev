import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "supabase.cmd" : "supabase";
const status = spawnSync(command, ["status", "-o", "env"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (status.status !== 0) {
  process.stderr.write(status.stderr);
  process.exit(status.status ?? 1);
}

const localValues = Object.fromEntries(
  status.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1).replace(/^"|"$/g, "");
      return [key, value];
    }),
);

const replacements = {
  SUPABASE_URL: localValues.API_URL,
  NEXT_PUBLIC_SUPABASE_URL: localValues.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: localValues.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: localValues.SECRET_KEY,
};

const target = ".env.local";
let contents = "";

try {
  contents = readFileSync(target, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

for (const [key, value] of Object.entries(replacements)) {
  if (!value) throw new Error(`Supabase status did not return ${key}`);

  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  contents = pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}${contents.trim() ? "\n" : ""}${line}\n`;
}

writeFileSync(target, contents, "utf8");
process.stdout.write(`Updated ${target} with local Supabase values.\n`);
