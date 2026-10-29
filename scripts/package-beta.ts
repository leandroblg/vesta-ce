/**
 * 017 `npm run package:beta` (and package:mac, package:linux, package:win): builds the betas on this Mac with
 * electron-builder and, for --all, writes release/handout/ (research §8, contracts/build-commands.md). The tester
 * guide shipped in the handout is not kept in this repository: `--all` takes it with `--guide <path>`.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ICON_FALLBACK_MESSAGE, writeIcons } from "./icons.ts";
import { runPackage, type Mode, type Runner } from "./lib/package-steps.ts";
import { writeNotices } from "./third-party-notices.ts";

const root = resolve(import.meta.dirname, "..");

const runner: Runner = {
  exec(cmd, args, options = {}) {
    return new Promise((done, fail) => {
      const child = spawn(cmd, args, { cwd: root, env: options.env ?? process.env, stdio: options.capture === true ? ["ignore", "pipe", "inherit"] : "inherit" });
      let out = "";
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", fail);
      child.on("close", (code) => {
        if (code === 0) done(out);
        else fail(new Error(`${cmd} ${args.join(" ")} exited with ${String(code)}`));
      });
    });
  },
  icons(dir) {
    const composer = writeIcons(dir);
    if (!composer) process.stdout.write(ICON_FALLBACK_MESSAGE);
    return composer;
  },
  notices(dir) {
    const { entries } = writeNotices(dir);
    process.stdout.write(`Third-party notices: ${String(entries)} entries.\n`);
  },
};

const modes: readonly Mode[] = ["--all", "--mac", "--linux", "--win"];
const mode = modes.find((m) => process.argv.includes(m)) ?? "--all";
const guideFlag = process.argv.indexOf("--guide");
const guide = guideFlag === -1 ? undefined : process.argv[guideFlag + 1];
try {
  await runPackage({ root, mode, env: process.env, guide: guide === undefined ? undefined : resolve(guide) }, runner);
  process.stdout.write(mode === "--all" ? "Beta built: hand out release/handout/.\n" : "Build done in release/.\n");
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
