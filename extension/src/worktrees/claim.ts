// The claim file a scanning window leaves beside the scan cache, so the windows of one machine share one
// scan. No vscode import and no blocking call: the extension host runs this. Whether a claim still holds is
// `scanDue`'s decision (due.ts); this file only reads, writes and removes it.
import * as fsp from "node:fs/promises";
import { decodeClaim, encodeClaim, type Claim } from "./due.ts";
import { writeWhole, type FsLike } from "./scan.ts";

/** The parts of node:fs/promises the claim needs: the cache's, plus removing a file. */
export type ClaimFs = FsLike & { unlink: (path: string) => Promise<unknown> };

const nodeFs: ClaimFs = {
  mkdir: (p, o) => fsp.mkdir(p, o),
  writeFile: (p, d) => fsp.writeFile(p, d),
  rename: (a, b) => fsp.rename(a, b),
  readFile: (p, e) => fsp.readFile(p, e),
  unlink: (p) => fsp.unlink(p),
};

/** The claim on disk, whatever its age, or nothing when the file is missing, unreadable or damaged. */
export const readClaim = async (file: string, fs: Pick<FsLike, "readFile"> = nodeFs): Promise<Claim | undefined> => {
  try {
    return decodeClaim(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
};

/**
 * Puts this window's claim down, over any claim already there. Swapped in whole, like the cache.
 * False when it could not be written: then this window does not scan.
 */
export const writeClaim = async (file: string, pid: number, at: number, fs: FsLike = nodeFs): Promise<boolean> => {
  try {
    await writeWhole(file, encodeClaim(at, pid), fs, String(pid));
    return true;
  } catch {
    return false;
  }
};

/** Time given to a second window's write to land before the claim is read back. */
export const CLAIM_SETTLE_MS = 100;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Puts this window's claim down and keeps it only when it is still the one on disk after a short wait: two
 * windows that start within milliseconds both write, the last write stands, and only that window's read-back
 * matches. True means this window holds the claim and may scan. False when the write failed or another
 * window's claim replaced it.
 */
export const takeClaim = async (file: string, pid: number, at: number, fs: FsLike = nodeFs, wait: (ms: number) => Promise<void> = sleep): Promise<boolean> => {
  if (!(await writeClaim(file, pid, at, fs))) return false;
  await wait(CLAIM_SETTLE_MS);
  const held = await readClaim(file, fs);
  return held?.pid === pid && held.at === at;
};

/** Removes the claim only while it is still this window's: a window that took over a stale one keeps its own. */
export const dropClaim = async (file: string, pid: number, fs: ClaimFs = nodeFs): Promise<void> => {
  try {
    if ((await readClaim(file, fs))?.pid === pid) await fs.unlink(file);
  } catch {
    // already gone
  }
};
