import { invoke } from '@tauri-apps/api/core';
import { readGitHubToken } from './keychain';

export interface GitCommitInfo {
  oid: string;
  summary: string;
  time: number;
}

export interface GitStatusInfo {
  enabled: boolean;
  head?: string | null;
  remoteUrl?: string | null;
  dirty: boolean;
}

export interface GitPullResult {
  status: GitStatusInfo;
  conflicts: string[];
}

export const gitHistoryEnable = (root: string): Promise<GitStatusInfo> =>
  invoke('git_history_enable', { root });

export const gitHistoryStatus = (root: string): Promise<GitStatusInfo> =>
  invoke('git_history_status', { root });

export const gitCommitAll = (root: string, message: string): Promise<GitCommitInfo | null> =>
  invoke('git_commit_all', { root, message });

export const gitFileHistory = (root: string, relPath: string): Promise<GitCommitInfo[]> =>
  invoke('git_file_history', { root, relPath });

export const gitReadFileAt = (root: string, relPath: string, commit: string): Promise<string> =>
  invoke('git_read_file_at', { root, relPath, commit });

export const gitSetRemote = (root: string, url: string): Promise<GitStatusInfo> =>
  invoke('git_set_remote', { root, url });

export async function gitPushOrigin(root: string): Promise<void> {
  const token = await readGitHubToken();
  await invoke('git_push_origin', { root, token });
}

export async function gitPullFastForward(root: string): Promise<GitPullResult> {
  const token = await readGitHubToken();
  return invoke('git_pull_fast_forward', { root, token });
}

// ── First-push visibility gate (checkpoint E architect fix; pass-11 brief: "first push
// requires explicit confirm showing repo visibility — a church-notes vault pushed public by
// default would be catastrophic"). Pure URL parsing + a GitHub API probe; the CONFIRM lives
// in the Settings push handler and fires only on a vault's first-ever push. ────────────────

export type RepoVisibility = 'private' | 'public' | 'unknown';

/** Parse `owner/repo` out of the GitHub remote-url shapes we accept (https / ssh, ±.git). */
export function parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const m =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
      remoteUrl.trim(),
    );
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Look up whether the remote repo is private. Any failure (non-GitHub remote, no token,
 *  network, 404) returns 'unknown' — the confirm dialog then says so instead of guessing. */
export async function githubRepoVisibility(remoteUrl: string): Promise<RepoVisibility> {
  const parsed = parseGitHubRepo(remoteUrl);
  if (!parsed) return 'unknown';
  const token = await readGitHubToken();
  if (!token) return 'unknown';
  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return 'unknown';
    const body = (await res.json()) as { private?: boolean };
    return body.private === true ? 'private' : body.private === false ? 'public' : 'unknown';
  } catch {
    return 'unknown';
  }
}
