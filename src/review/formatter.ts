import type { ReviewResult, ReviewIssue, GitHubAnnotation, GitHubCheckOutput, OutputFormat } from './types';

const SEVERITY_ICONS: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

const TYPE_ICONS: Record<string, string> = {
  bug: '🐛',
  architecture: '🏗️',
  recommendation: '💡',
};

export function formatReview(result: ReviewResult, format: OutputFormat): string {
  if (format === 'github') {
    return formatGitHubComment(result);
  }
  return formatCli(result);
}

export function formatCli(result: ReviewResult): string {
  const lines: string[] = [];

  lines.push('═'.repeat(60));
  lines.push('📋 CODE REVIEW RESULTS');
  lines.push('═'.repeat(60));
  lines.push('');

  lines.push(`📊 Files analyzed: ${result.filesAnalyzed}`);
  lines.push(`⏱️  Duration: ${result.duration}ms`);
  lines.push('');

  if (result.issues.length === 0) {
    lines.push('✅ No issues found!');
    lines.push('');
    return lines.join('\n');
  }

  const grouped = groupBySeverity(result.issues);

  if (grouped.critical.length > 0) {
    lines.push('🔴 CRITICAL ISSUES');
    lines.push('─'.repeat(40));
    for (const issue of grouped.critical) {
      lines.push(formatIssueCli(issue));
    }
    lines.push('');
  }

  if (grouped.warning.length > 0) {
    lines.push('🟡 WARNINGS');
    lines.push('─'.repeat(40));
    for (const issue of grouped.warning) {
      lines.push(formatIssueCli(issue));
    }
    lines.push('');
  }

  if (grouped.info.length > 0) {
    lines.push('🔵 SUGGESTIONS');
    lines.push('─'.repeat(40));
    for (const issue of grouped.info) {
      lines.push(formatIssueCli(issue));
    }
    lines.push('');
  }

  lines.push('─'.repeat(60));
  lines.push(result.summary);

  return lines.join('\n');
}

function formatIssueCli(issue: ReviewIssue): string {
  const typeIcon = TYPE_ICONS[issue.type] || '•';
  const location = issue.line
    ? `${issue.file}:${issue.line}`
    : issue.file;

  const lines: string[] = [];
  lines.push(`  ${typeIcon} ${location}`);
  lines.push(`    ${issue.message}`);

  if (issue.suggestion) {
    lines.push(`    💡 ${issue.suggestion}`);
  }

  return lines.join('\n');
}

export function formatGitHubComment(result: ReviewResult): string {
  const lines: string[] = [];

  lines.push('## 🤖 AI Code Review');
  lines.push('');

  if (result.issues.length === 0) {
    lines.push('✅ **No significant issues found in this PR.**');
    lines.push('');
    lines.push(`_Reviewed ${result.filesAnalyzed} files in ${result.duration}ms_`);
    return lines.join('\n');
  }

  const grouped = groupByType(result.issues);

  if (grouped.bug.length > 0) {
    lines.push('### 🐛 Potential Bugs');
    lines.push('');
    for (const issue of grouped.bug) {
      lines.push(formatIssueGitHub(issue));
    }
    lines.push('');
  }

  if (grouped.architecture.length > 0) {
    lines.push('### 🏗️ Architecture Concerns');
    lines.push('');
    for (const issue of grouped.architecture) {
      lines.push(formatIssueGitHub(issue));
    }
    lines.push('');
  }

  if (grouped.recommendation.length > 0) {
    lines.push('### 💡 Recommendations');
    lines.push('');
    for (const issue of grouped.recommendation) {
      lines.push(formatIssueGitHub(issue));
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`<details>`);
  lines.push(`<summary>📊 Stats</summary>`);
  lines.push('');
  lines.push(`- Files analyzed: ${result.filesAnalyzed}`);
  lines.push(`- Issues found: ${result.issues.length}`);
  lines.push(`- Duration: ${result.duration}ms`);
  lines.push(`</details>`);

  return lines.join('\n');
}

function formatIssueGitHub(issue: ReviewIssue): string {
  const severityIcon = SEVERITY_ICONS[issue.severity] || '•';
  const fileLink = issue.line
    ? `[\`${issue.file}:${issue.line}\`](${issue.file}#L${issue.line})`
    : `\`${issue.file}\``;

  const lines: string[] = [];
  lines.push(`- ${severityIcon} **${fileLink}**`);
  lines.push(`  ${issue.message}`);

  if (issue.suggestion) {
    lines.push(`  > 💡 ${issue.suggestion}`);
  }

  return lines.join('\n');
}

export function createGitHubAnnotations(result: ReviewResult): GitHubAnnotation[] {
  return result.issues
    .filter(issue => issue.line !== undefined)
    .map(issue => ({
      path: issue.file,
      start_line: issue.line!,
      end_line: issue.endLine || issue.line!,
      annotation_level: mapSeverityToLevel(issue.severity),
      message: issue.message,
      title: `${issue.type}: ${issue.severity}`,
      raw_details: issue.suggestion,
    }));
}

function mapSeverityToLevel(severity: string): 'failure' | 'warning' | 'notice' {
  switch (severity) {
    case 'critical':
      return 'failure';
    case 'warning':
      return 'warning';
    default:
      return 'notice';
  }
}

export function createGitHubCheckOutput(result: ReviewResult): GitHubCheckOutput {
  const annotations = createGitHubAnnotations(result);

  const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
  const warningCount = result.issues.filter(i => i.severity === 'warning').length;

  return {
    title: criticalCount > 0
      ? `❌ ${criticalCount} critical, ${warningCount} warnings`
      : warningCount > 0
        ? `⚠️ ${warningCount} warnings`
        : '✅ No issues found',
    summary: result.summary,
    text: formatGitHubComment(result),
    annotations,
  };
}

interface SeverityGroups {
  critical: ReviewIssue[];
  warning: ReviewIssue[];
  info: ReviewIssue[];
}

interface TypeGroups {
  bug: ReviewIssue[];
  architecture: ReviewIssue[];
  recommendation: ReviewIssue[];
}

function groupBySeverity(issues: ReviewIssue[]): SeverityGroups {
  const result: SeverityGroups = {
    critical: [],
    warning: [],
    info: [],
  };

  for (const issue of issues) {
    result[issue.severity].push(issue);
  }

  return result;
}

function groupByType(issues: ReviewIssue[]): TypeGroups {
  const result: TypeGroups = {
    bug: [],
    architecture: [],
    recommendation: [],
  };

  for (const issue of issues) {
    result[issue.type].push(issue);
  }

  return result;
}

export function formatJson(result: ReviewResult): string {
  return JSON.stringify(result, null, 2);
}
