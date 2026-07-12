// Checkpoint E: the first-push visibility gate's pure parser (the API probe is fetch-trivial).
import { describe, expect, it } from 'vitest';
import { parseGitHubRepo } from '../../src/services/nativeGit';

describe('parseGitHubRepo', () => {
  it('parses https, https+.git, ssh, and trailing-slash forms', () => {
    expect(parseGitHubRepo('https://github.com/Dewflash/denote.git')).toEqual({ owner: 'Dewflash', repo: 'denote' });
    expect(parseGitHubRepo('https://github.com/Dewflash/denote')).toEqual({ owner: 'Dewflash', repo: 'denote' });
    expect(parseGitHubRepo('git@github.com:Dewflash/denote.git')).toEqual({ owner: 'Dewflash', repo: 'denote' });
    expect(parseGitHubRepo('https://github.com/Dewflash/denote/')).toEqual({ owner: 'Dewflash', repo: 'denote' });
  });
  it('rejects non-GitHub and malformed urls', () => {
    expect(parseGitHubRepo('https://gitlab.com/a/b')).toBeNull();
    expect(parseGitHubRepo('not a url')).toBeNull();
    expect(parseGitHubRepo('https://github.com/only-owner')).toBeNull();
  });
});
