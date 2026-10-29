/** 009 SC-005: launching with Chromium's NetLog, which records every lookup and connection from every process. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchVesta, type LaunchOptions, type Launched } from "./launch";

export { netLogHosts } from "../../unit/fixtures/netlog";

export async function launchWithNetLog(options: LaunchOptions = {}): Promise<Launched & { netLog: string }> {
  const netLog = join(mkdtempSync(join(tmpdir(), "vesta-netlog-")), "net.json");
  const launched = await launchVesta({ ...options, args: [...(options.args ?? []), `--log-net-log=${netLog}`] });
  return { ...launched, netLog };
}
