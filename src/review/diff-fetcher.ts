import simpleGit from 'simple-git';
import { execSync } from 'child_process';
import type { DiffResult, FileChange, DiffHunk } from './types';
import { logger } from '../core/logger';

export interface DiffFetcherOptions {
  projectPath: string;
  baseRef?: string;
  headRef?: string;
  prNumber?: number;
}

export class DiffFetcher {
  private projectPath: string;
  private git;

  constructor(options: DiffFetcherOptions) {
    this.projectPath = options.projectPath;
    this.git = simpleGit(options.projectPath);
  }

  async fetchDiff(options: DiffFetcherOptions): Promise<DiffResult> {
    if (options.prNumber) {
      return this.fetchPrDiff(options.prNumber);
    }
    return this.fetchLocalDiff(options.baseRef, options.headRef);
  }

  private async fetchPrDiff(prNumber: number): Promise<DiffResult> {
    logger.info('main', `Fetching PR #${prNumber} diff via gh CLI`);

    try {
      const rawDiff = execSync(`gh pr diff ${prNumber}`, {
        cwd: this.projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const prInfo = execSync(`gh pr view ${prNumber} --json baseRefName,headRefName,additions,deletions,changedFiles`, {
        cwd: this.projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const info = JSON.parse(prInfo);

      return {
        files: this.parseDiff(rawDiff),
        baseRef: info.baseRefName,
        headRef: info.headRefName,
        stats: {
          files: info.changedFiles,
          additions: info.additions,
          deletions: info.deletions,
        },
      };
    } catch (error) {
      throw new Error(`Failed to fetch PR diff: ${(error as Error).message}`);
    }
  }

  private async fetchLocalDiff(baseRef?: string, headRef?: string): Promise<DiffResult> {
    const base = baseRef || 'main';
    const head = headRef || 'HEAD';

    logger.info('main', `Fetching local diff: ${base}...${head}`);

    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        throw new Error('Not a git repository');
      }

      let rawDiff: string;

      if (baseRef || headRef) {
        rawDiff = await this.git.diff([`${base}..${head}`]);
      } else {
        try {
          rawDiff = await this.git.diff(['main..HEAD']);
        } catch {
          try {
            rawDiff = await this.git.diff(['master..HEAD']);
          } catch {
            rawDiff = await this.git.diff(['HEAD~1..HEAD']);
          }
        }
      }

      const actualBase = await this.detectBaseBranch();
      const currentBranch = (await this.git.branch()).current;

      const stats = await this.getDiffStats(actualBase, head);

      return {
        files: this.parseDiff(rawDiff),
        baseRef: actualBase,
        headRef: currentBranch || head,
        stats,
      };
    } catch (error) {
      throw new Error(`Failed to fetch local diff: ${(error as Error).message}`);
    }
  }

  private async detectBaseBranch(): Promise<string> {
    try {
      const branches = await this.git.branchLocal();
      if (branches.all.includes('main')) return 'main';
      if (branches.all.includes('master')) return 'master';
      if (branches.all.includes('develop')) return 'develop';
      return 'main';
    } catch {
      return 'main';
    }
  }

  private async getDiffStats(base: string, head: string): Promise<DiffResult['stats']> {
    try {
      const diffSummary = await this.git.diffSummary([`${base}..${head}`]);
      return {
        files: diffSummary.files.length,
        additions: diffSummary.insertions,
        deletions: diffSummary.deletions,
      };
    } catch {
      return { files: 0, additions: 0, deletions: 0 };
    }
  }

  private parseDiff(rawDiff: string): FileChange[] {
    const files: FileChange[] = [];
    const fileDiffs = rawDiff.split(/^diff --git /m).filter(Boolean);

    for (const fileDiff of fileDiffs) {
      const file = this.parseFileDiff(fileDiff);
      if (file) {
        files.push(file);
      }
    }

    return files;
  }

  private parseFileDiff(rawDiff: string): FileChange | null {
    const headerMatch = rawDiff.match(/^a\/(.+?) b\/(.+?)[\r\n]/);
    if (!headerMatch || !headerMatch[1] || !headerMatch[2]) return null;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];

    let status: FileChange['status'] = 'modified';
    if (rawDiff.includes('new file mode')) {
      status = 'added';
    } else if (rawDiff.includes('deleted file mode')) {
      status = 'deleted';
    } else if (oldPath !== newPath) {
      status = 'renamed';
    }

    const hunks = this.parseHunks(rawDiff);

    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      const lines = hunk.content.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
    }

    return {
      path: newPath,
      status,
      additions,
      deletions,
      hunks,
      rawDiff,
    };
  }

  private parseHunks(diff: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const hunkRegex = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g;

    const lines = diff.split('\n');
    let currentHunkStart = -1;
    let currentHunk: DiffHunk | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      hunkRegex.lastIndex = 0;
      const hunkMatch = hunkRegex.exec(line);

      if (hunkMatch) {
        if (currentHunk && currentHunkStart >= 0) {
          currentHunk.content = lines.slice(currentHunkStart, i).join('\n');
          hunks.push(currentHunk);
        }

        const oldStartStr = hunkMatch[1] ?? '0';
        const oldLinesStr = hunkMatch[2];
        const newStartStr = hunkMatch[3] ?? '0';
        const newLinesStr = hunkMatch[4];

        currentHunk = {
          oldStart: parseInt(oldStartStr, 10),
          oldLines: oldLinesStr ? parseInt(oldLinesStr, 10) : 1,
          newStart: parseInt(newStartStr, 10),
          newLines: newLinesStr ? parseInt(newLinesStr, 10) : 1,
          content: '',
        };
        currentHunkStart = i;
      }
    }

    if (currentHunk && currentHunkStart >= 0) {
      currentHunk.content = lines.slice(currentHunkStart).join('\n');
      hunks.push(currentHunk);
    }

    return hunks;
  }
}

export function createDiffFetcher(options: DiffFetcherOptions): DiffFetcher {
  return new DiffFetcher(options);
}
