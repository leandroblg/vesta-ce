/** Test-only fault injection (research.md §8). Packaged builds ignore VESTA_FAULT. */
/** 008 adds export-write, pre-import-backup, import-write and undo-restore (research §12). */
export type Fault =
  | "save"
  | "backup"
  | "purge"
  | "damaged"
  | "asset-write"
  | "asset-unlink"
  | "export-write"
  | "pre-import-backup"
  | "import-write"
  | "undo-restore"
  /** Holds an import for 1.5 s after the file is picked, so tests can act while it runs. */
  | "slow-import"
  /** 018 T085: holds an export for 1.5 s after the folder is picked, so tests can run the purge while it runs. */
  | "slow-export";

let isPackaged = true;

export function initFaults(packaged: boolean): void {
  isPackaged = packaged;
}

export function faultActive(name: Fault): boolean {
  if (isPackaged) return false;
  return (process.env["VESTA_FAULT"] ?? "").split(",").includes(name);
}
