export type IssueType = 'bug' | 'architecture' | 'recommendation';
export type Severity = 'critical' | 'warning' | 'info';
export type OutputFormat = 'cli' | 'github';

export interface ReviewIssue {
  type: IssueType;
  file: string;
  line?: number;
  endLine?: number;
  severity: Severity;
  message: string;
  suggestion?: string;
  codeSnippet?: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  rawDiff: string;
}

export interface DiffResult {
  files: FileChange[];
  baseRef: string;
  headRef: string;
  stats: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface ReviewResult {
  issues: ReviewIssue[];
  summary: string;
  stats: DiffResult['stats'];
  filesAnalyzed: number;
  duration: number;
  lang: 'en' | 'ru';
}

export interface ReviewOptions {
  projectPath: string;
  baseRef?: string;
  headRef?: string;
  prNumber?: number;
  format: OutputFormat;
  outputFile?: string;
  useRag: boolean;
  debug: boolean;
  lang?: 'en' | 'ru';
}

export interface GitHubAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
  title?: string;
  raw_details?: string;
}

export interface GitHubCheckOutput {
  title: string;
  summary: string;
  text: string;
  annotations: GitHubAnnotation[];
}
