// 010 FR-031: one assertion per row of the audit's "Controls verified as sound" table that had no dedicated test.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_CSP } from "../../../src/main/csp";
import { EVENT_CHANNELS, INVOKE_CHANNELS, METHODS } from "../../../src/shared/ipc-contract";

const root = resolve(import.meta.dirname, "../../..");
const SANDBOX_PROBE = join(root, "src/main/sandbox-probe.ts");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("audit controls kept as regression tests (010 FR-031)", () => {
  it("Dependencies: every dependency is pinned to an exact version, the lockfile exists, npm ci runs in CI", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const [name, version] of [...Object.entries(pkg.dependencies), ...Object.entries(pkg.devDependencies)]) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    }
    expect(statSync(join(root, "package-lock.json")).isFile()).toBe(true);
    expect(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")).toContain("npm ci");
  });

  it("Dependencies: no electron/remote, no shell commands, no eval in the source tree", () => {
    for (const file of sources(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/["']@electron\/remote["']|["']electron\/remote["']/);
      // 017 FR-006a (PRD Q265): the Linux sandbox probe is the one child process, checked below.
      if (file !== SANDBOX_PROBE) expect(text, file).not.toMatch(/\bchild_process\b|\b(?:execSync|execFileSync|spawnSync|execFile|spawn)\(/);
      expect(text, file).not.toMatch(/\beval\(|new Function\(/);
    }
  });

  it("017 FR-006a: the sandbox probe runs only unshare, by absolute path, with fixed arguments and no shell", () => {
    const text = readFileSync(SANDBOX_PROBE, "utf8");
    expect(text.match(/\b(?:execSync|execFileSync|spawnSync|execFile|spawn)\(/g)).toEqual(["spawnSync("]);
    expect(text).toContain('spawnSync(unshare, ["-Ur", "true"], { stdio: "ignore", timeout: 2000, shell: false })');
    expect(text).toContain('UNSHARE_PATHS = ["/usr/bin/unshare", "/bin/unshare"]');
    expect(readFileSync(join(root, "src/main/index.ts"), "utf8")).toContain('app.isPackaged && process.platform === "linux" ? userNamespacesBlocked() : false');
  });

  it("CSP: default-src self, no inline script or style, object none, base-uri none, form-action none", () => {
    expect(PRODUCTION_CSP).toContain("default-src 'self'");
    expect(PRODUCTION_CSP).toContain("object-src 'none'");
    expect(PRODUCTION_CSP).toContain("base-uri 'none'");
    expect(PRODUCTION_CSP).toContain("form-action 'none'");
    expect(PRODUCTION_CSP).not.toMatch(/unsafe-inline|unsafe-eval|data:(?!\s|$)[^;]*script/);
  });

  it("Preload: the contract names every channel the preload may expose, and only those", () => {
    const fromMethods = Object.values(METHODS).flatMap((group) => Object.values(group));
    expect([...fromMethods].sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(EVENT_CHANNELS.length).toBeGreaterThan(0);
    const preload = readFileSync(join(root, "src/preload/index.ts"), "utf8");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).toContain("Object.freeze");
    expect(preload).not.toMatch(/require\(|nodeIntegration|process\.env/);
  });

  it("Test hooks: fault injection and test hooks are gated on an unpackaged build", () => {
    const index = readFileSync(join(root, "src/main/index.ts"), "utf8");
    expect(index).toMatch(/if \(!app\.isPackaged\) \{\s*\n\s*\(globalThis as \{ __vestaTest\?: unknown \}\)\.__vestaTest = \{/);
    expect(index).toContain("initFaults(app.isPackaged)");
    const faults = readFileSync(join(root, "src/main/faults.ts"), "utf8");
    expect(faults).toMatch(/isPackaged/);
  });
});
