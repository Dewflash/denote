// tests/helpers/nodeStorage.ts — a node:fs StorageBackend for integration tests. It mirrors
// the Rust backend's observable behavior (atomic writes, the shared ignore set) so the
// Repository can be exercised against real temp-dir vaults in Vitest. Test-only: never shipped.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isIgnoredPath, type DirEntry, type FileStat, type StorageBackend } from '../../src/services/storage';

const toRel = (root: string, full: string): string =>
  path.relative(root, full).split(path.sep).join('/');
const isMd = (name: string): boolean => name.toLowerCase().endsWith('.md');

export function nodeStorage(): StorageBackend {
  return {
    async registerVaultRoot() {
      /* no containment in tests */
    },

    async listVaultFiles(root) {
      const out: DirEntry[] = [];
      await walk(root, root, out);
      return out;
    },

    async listDir(root, relPath) {
      const dir = path.join(root, relPath);
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const out: DirEntry[] = [];
      for (const d of entries) {
        const full = path.join(dir, d.name);
        const st = await fs.stat(full).catch(() => null);
        out.push({
          relPath: toRel(root, full),
          isDir: d.isDirectory(),
          isMarkdown: isMd(d.name),
          mtime: st ? st.mtimeMs : 0,
          btime: st ? st.birthtimeMs : 0,
          size: st ? st.size : 0,
        });
      }
      return out;
    },

    async readNote(root, relPath) {
      return fs.readFile(path.join(root, relPath), 'utf8');
    },

    async writeNote(root, relPath, content) {
      const full = path.join(root, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      const tmp = full + '.denote-tmp';
      await fs.writeFile(tmp, content, 'utf8');
      await fs.rename(tmp, full); // atomic (S7)
    },

    async createDir(root, relPath) {
      await fs.mkdir(path.join(root, relPath), { recursive: true });
    },

    async deletePath(root, relPath) {
      await fs.rm(path.join(root, relPath), { recursive: true, force: true });
    },

    async renamePath(root, from, to) {
      const dst = path.join(root, to);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.rename(path.join(root, from), dst);
    },

    async stat(root, relPath): Promise<FileStat | null> {
      try {
        const st = await fs.stat(path.join(root, relPath));
        return { mtime: st.mtimeMs, btime: st.birthtimeMs, size: st.size };
      } catch {
        return null;
      }
    },

    async exists(root, relPath) {
      try {
        await fs.access(path.join(root, relPath));
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function walk(root: string, dir: string, out: DirEntry[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of entries) {
    const full = path.join(dir, d.name);
    const relPath = toRel(root, full);
    if (isIgnoredPath(relPath)) continue;
    if (d.isDirectory()) {
      await walk(root, full, out);
    } else {
      const st = await fs.stat(full).catch(() => null);
      out.push({
        relPath,
        isDir: false,
        isMarkdown: isMd(d.name),
        mtime: st ? st.mtimeMs : 0,
        btime: st ? st.birthtimeMs : 0,
        size: st ? st.size : 0,
      });
    }
  }
}

/** Create a unique empty temp vault dir; returns its absolute path. */
export async function makeTempVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'denote-vault-'));
}

/** Write a file directly on disk (simulating an EXTERNAL editor — bypasses the Repository). */
export async function externalWrite(root: string, relPath: string, content: string): Promise<void> {
  const full = path.join(root, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

/** Rename a file directly on disk (simulating an external Finder move). */
export async function externalRename(root: string, from: string, to: string): Promise<void> {
  const dst = path.join(root, to);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(path.join(root, from), dst);
}

export async function cleanup(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

/** A controllable clock for deterministic time-window tests (S8 5s, S9 move 2s, D21 snapshots). */
export function makeClock(start = 1_000_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (v: number) => {
      t = v;
    },
  };
}
