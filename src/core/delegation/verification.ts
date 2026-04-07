import type { 
  TaskPlan, 
  SubTask, 
  DelegationResult, 
  VerificationResult, 
  VerificationReport 
} from './types';
import { logger } from '../logger';

export class VerificationGate {
  private coverageThreshold: number = 0.8;

  verify(plan: TaskPlan, results: DelegationResult[]): VerificationReport {
    logger.info('delegation', 'Starting verification', {
      planId: plan.id,
      subtaskCount: plan.subtasks.length,
      resultCount: results.length,
    });

    const verifications: VerificationResult[] = [];

    for (const subtask of plan.subtasks) {
      const result = results.find(r => r.taskId === subtask.id);
      const verification = this.verifySubtask(subtask, result);
      verifications.push(verification);
    }

    const overallStatus = this.determineOverallStatus(verifications);
    const retryable = this.isRetryable(verifications);

    const report: VerificationReport = {
      planId: plan.id,
      results: verifications,
      overallStatus,
      retryable,
    };

    logger.info('delegation', 'Verification completed', {
      planId: plan.id,
      overallStatus,
      retryable,
      completeCount: verifications.filter(v => v.status === 'complete').length,
      partialCount: verifications.filter(v => v.status === 'partial').length,
      failedCount: verifications.filter(v => v.status === 'failed').length,
    });

    return report;
  }

  private verifySubtask(
    subtask: SubTask, 
    result: DelegationResult | undefined
  ): VerificationResult {
    if (!result) {
      return {
        taskId: subtask.id,
        covered: [],
        missed: subtask.scope.include,
        status: 'failed',
        recommendation: 'Task was not executed',
      };
    }

    if (result.status === 'pending') {
      return {
        taskId: subtask.id,
        covered: [],
        missed: subtask.scope.include,
        status: 'failed',
        recommendation: 'Task execution is still pending',
      };
    }

    if (result.status === 'error') {
      return {
        taskId: subtask.id,
        covered: [],
        missed: subtask.scope.include,
        status: 'failed',
        recommendation: this.generateErrorRecommendation(result),
      };
    }

    const coverage = this.calculateCoverage(subtask, result);
    const status = coverage.percentage >= this.coverageThreshold ? 'complete' : 'partial';

    return {
      taskId: subtask.id,
      covered: coverage.covered,
      missed: coverage.missed,
      status,
      recommendation: status === 'partial' 
        ? this.generatePartialRecommendation(subtask, coverage)
        : undefined,
    };
  }

  private calculateCoverage(
    subtask: SubTask, 
    result: DelegationResult
  ): { covered: string[]; missed: string[]; percentage: number } {
    const expectedScope = subtask.scope.include;
    const covered: string[] = [];
    const missed: string[] = [];

    const resultData = result.data as {
      results?: Array<{ file?: string; path?: string }>;
      files?: string[];
      foundFiles?: string[];
    } | null;

    const processedFiles = new Set<string>();

    if (resultData) {
      if (resultData.results && Array.isArray(resultData.results)) {
        resultData.results.forEach((r) => {
          if (r.file) processedFiles.add(r.file);
          if (r.path) processedFiles.add(r.path);
        });
      }
      if (resultData.files && Array.isArray(resultData.files)) {
        resultData.files.forEach(f => processedFiles.add(f));
      }
      if (resultData.foundFiles && Array.isArray(resultData.foundFiles)) {
        resultData.foundFiles.forEach(f => processedFiles.add(f));
      }
    }

    if (result.contextOut.sharedContext?.foundFiles) {
      result.contextOut.sharedContext.foundFiles.forEach(f => processedFiles.add(f));
    }

    for (const scopePath of expectedScope) {
      const isCovered = Array.from(processedFiles).some(file => 
        this.matchesScopePattern(file, scopePath)
      );

      if (isCovered) {
        covered.push(scopePath);
      } else {
        missed.push(scopePath);
      }
    }

    const percentage = expectedScope.length > 0 
      ? covered.length / expectedScope.length 
      : 1.0;

    return { covered, missed, percentage };
  }

  private matchesScopePattern(filePath: string, scopePattern: string): boolean {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedPattern = scopePattern.replace(/\\/g, '/');

    if (normalizedPattern.includes('*')) {
      const regexPattern = normalizedPattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\./g, '\\.');
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(normalizedFile);
    }

    return normalizedFile.startsWith(normalizedPattern) || 
           normalizedFile === normalizedPattern;
  }

  private determineOverallStatus(verifications: VerificationResult[]): 'success' | 'partial' | 'failed' {
    const failedCount = verifications.filter(v => v.status === 'failed').length;
    const partialCount = verifications.filter(v => v.status === 'partial').length;

    if (failedCount > 0) {
      return 'failed';
    }

    if (partialCount > 0) {
      return 'partial';
    }

    return 'success';
  }

  private isRetryable(verifications: VerificationResult[]): boolean {
    return verifications.some(v => 
      v.status === 'partial' || 
      (v.status === 'failed' && v.recommendation?.includes('retry'))
    );
  }

  private generateErrorRecommendation(result: DelegationResult): string {
    const errorLogs = result.logs.filter(log => 
      log.toLowerCase().includes('error') || 
      log.toLowerCase().includes('failed')
    );

    if (errorLogs.some(log => log.includes('timeout'))) {
      return 'Task timed out. Consider increasing timeout or reducing scope.';
    }

    if (errorLogs.some(log => log.includes('not found') || log.includes('does not exist'))) {
      return 'Invalid scope. Replan task with corrected paths.';
    }

    if (errorLogs.some(log => log.includes('permission') || log.includes('access'))) {
      return 'Permission denied. Check file access rights.';
    }

    return 'Task failed. Check logs for details and retry if appropriate.';
  }

  private generatePartialRecommendation(
    _subtask: SubTask, 
    coverage: { covered: string[]; missed: string[]; percentage: number }
  ): string {
    const missedCount = coverage.missed.length;
    
    if (coverage.percentage < 0.3) {
      return `Only ${(coverage.percentage * 100).toFixed(0)}% coverage. Consider expanding search scope or using alternative search strategies.`;
    }

    if (missedCount <= 2) {
      return `Missing ${missedCount} scope path(s): ${coverage.missed.join(', ')}. Retry with focused search.`;
    }

    return `Partial coverage (${(coverage.percentage * 100).toFixed(0)}%). ${missedCount} paths not covered.`;
  }

  setCoverageThreshold(threshold: number): void {
    if (threshold >= 0 && threshold <= 1) {
      this.coverageThreshold = threshold;
      logger.debug('delegation', `Coverage threshold set to ${threshold}`);
    }
  }
}
