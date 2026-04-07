import type { 
  DelegationExecutorOptions, 
  TaskPlan, 
  SubTask, 
  ScopeDefinition 
} from './types';
import { DEFAULT_EXCLUDE } from './types';
import { logger } from '../logger';
import { LLMClient } from '../../llm/client';

const SIMPLE_PATTERNS = [
  /найди\s+(класс|функцию|компонент|интерфейс|метод|переменную)/i,
  /покажи\s+(код|файл|директорию|содержимое)/i,
  /где\s+(определён|используется|находится)/i,
  /find\s+(class|function|component|interface|method)/i,
  /show\s+(code|file|directory|content)/i,
  /where\s+(is|defined|used)/i,
  /list|read|search|grep/i,
];

const COMPLEX_PATTERNS = [
  /анализ(ировать)?|рефактор(инг)?|миграц/i,
  /все|каждый|параллельно|одновременно/i,
  /проверь.*и.*исправь/i,
  /analyze|refactor|migrate/i,
  /all|every|parallel|simultaneously/i,
  /check.*and.*fix/i,
];

interface OverlapReport {
  task1Id: string;
  task2Id: string;
  overlappingPaths: string[];
}

export class TaskPlanner {
  private llmClient: LLMClient;

  constructor(_options: DelegationExecutorOptions) {
    this.llmClient = new LLMClient();
  }

  async plan(goal: string): Promise<TaskPlan> {
    logger.info('delegation', 'Starting task planning', { goal: goal.substring(0, 100) });

    const complexity = await this.classifyComplexity(goal);
    logger.debug('delegation', `Task complexity: ${complexity}`, { goal: goal.substring(0, 50) });

    let subtasks: SubTask[];

    if (complexity === 'simple') {
      subtasks = this.heuristicPlan(goal);
      logger.info('delegation', 'Used heuristic planning', { subtaskCount: subtasks.length });
    } else {
      subtasks = await this.llmDecompose(goal);
      logger.info('delegation', 'Used LLM decomposition', { subtaskCount: subtasks.length });
    }

    const normalizedSubtasks = this.normalizeAndValidate(subtasks);
    const adjacencyList = this.buildDAG(normalizedSubtasks);

    const plan: TaskPlan = {
      id: this.generatePlanId(),
      goal,
      subtasks: normalizedSubtasks,
      adjacencyList,
      estimatedComplexity: complexity,
      createdAt: Date.now(),
    };

    logger.info('delegation', 'Task plan created', {
      planId: plan.id,
      subtaskCount: plan.subtasks.length,
      complexity: plan.estimatedComplexity,
    });

    return plan;
  }

  private async classifyComplexity(goal: string): Promise<'simple' | 'moderate' | 'complex'> {
    for (const pattern of SIMPLE_PATTERNS) {
      if (pattern.test(goal)) {
        return 'simple';
      }
    }

    for (const pattern of COMPLEX_PATTERNS) {
      if (pattern.test(goal)) {
        return 'complex';
      }
    }

    if (goal.split(/\s+/).length > 15) {
      return 'complex';
    }

    return 'moderate';
  }

  private heuristicPlan(goal: string): SubTask[] {
    const taskId = this.generateTaskId('search');
    
    return [
      {
        id: taskId,
        description: goal,
        scope: {
          include: ['**/*'],
          exclude: DEFAULT_EXCLUDE,
        },
        dependencies: [],
        tools: ['content_search', 'rag_search', 'read_file'],
        priority: 'high',
      },
    ];
  }

  private async llmDecompose(goal: string): Promise<SubTask[]> {
    const prompt = this.buildDecompositionPrompt(goal);

    try {
      const response = await this.llmClient.chatCompletion({
        messages: [
          {
            role: 'system',
            content: 'You are a task decomposition expert. Return only valid JSON array.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: 2000,
      });

      const content = response.content?.trim();
      if (!content) {
        logger.warn('delegation', 'LLM decomposition returned empty content, falling back to heuristic');
        return this.heuristicPlan(goal);
      }

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('delegation', 'LLM decomposition did not return valid JSON, falling back to heuristic');
        return this.heuristicPlan(goal);
      }

      const rawSubtasks = JSON.parse(jsonMatch[0]);
      return this.parseSubtasks(rawSubtasks);
    } catch (error) {
      logger.error('delegation', 'LLM decomposition failed, falling back to heuristic', {
        error: (error as Error).message,
      });
      return this.heuristicPlan(goal);
    }
  }

  private buildDecompositionPrompt(goal: string): string {
    return `
Decompose the following goal into subtasks:

Goal: "${goal}"

Project structure hints:
- Source code: src/
- Tests: tests/ or __tests__/
- Config: *.json, *.yaml, *.yml
- Documentation: *.md

Return JSON array with maximum 5 subtasks:
[
  {
    "id": "task_1",
    "description": "string - clear task description",
    "scope": {
      "include": ["glob patterns for files to search"],
      "exclude": ["optional patterns to exclude"],
      "fileTypes": [".ts", ".tsx"]
    },
    "dependencies": ["task_id"],
    "tools": ["content_search", "rag_search", "read_file"],
    "priority": "high"
  }
]

Rules:
- Maximum 5 subtasks
- No circular dependencies
- Each scope should be mutually exclusive when possible
- Include tests in scope only if explicitly requested
- Use "content_search" for exact code/component names
- Use "rag_search" for conceptual searches
- Keep descriptions concise and actionable
`;
  }

  private parseSubtasks(rawSubtasks: unknown[]): SubTask[] {
    return rawSubtasks.map((raw: any, index: number) => ({
      id: raw.id || `task_${index + 1}`,
      description: raw.description || `Task ${index + 1}`,
      scope: {
        include: raw.scope?.include || ['**/*'],
        exclude: raw.scope?.exclude || DEFAULT_EXCLUDE,
        fileTypes: raw.scope?.fileTypes,
      },
      dependencies: raw.dependencies || [],
      tools: raw.tools || ['content_search', 'rag_search', 'read_file'],
      priority: raw.priority || 'medium',
    }));
  }

  private normalizeAndValidate(subtasks: SubTask[]): SubTask[] {
    const overlaps = this.detectOverlaps(subtasks);
    
    if (overlaps.length > 0) {
      logger.warn('delegation', `Detected ${overlaps.length} scope overlaps, normalizing...`);
      subtasks = this.resolveOverlaps(subtasks, overlaps);
    }

    for (const subtask of subtasks) {
      if (!subtask.scope.exclude || subtask.scope.exclude.length === 0) {
        subtask.scope.exclude = DEFAULT_EXCLUDE;
      }

      const validDependencies = subtask.dependencies.filter(depId =>
        subtasks.some(st => st.id === depId)
      );
      
      if (validDependencies.length !== subtask.dependencies.length) {
        logger.warn('delegation', `Removed invalid dependencies from task "${subtask.id}"`, {
          taskId: subtask.id,
          invalidDependencies: subtask.dependencies.filter(d => !validDependencies.includes(d)),
        });
        subtask.dependencies = validDependencies;
      }
    }

    return subtasks;
  }

  private detectOverlaps(subtasks: SubTask[]): OverlapReport[] {
    const overlaps: OverlapReport[] = [];

    for (let i = 0; i < subtasks.length; i++) {
      for (let j = i + 1; j < subtasks.length; j++) {
        const task1 = subtasks[i];
        const task2 = subtasks[j];
        
        if (!task1 || !task2) continue;

        const overlappingPaths = this.findOverlappingPaths(
          task1.scope,
          task2.scope
        );

        if (overlappingPaths.length > 0) {
          overlaps.push({
            task1Id: task1.id,
            task2Id: task2.id,
            overlappingPaths,
          });
        }
      }
    }

    return overlaps;
  }

  private findOverlappingPaths(scope1: ScopeDefinition, scope2: ScopeDefinition): string[] {
    const paths1 = new Set(scope1.include);
    const paths2 = new Set(scope2.include);
    const overlapping: string[] = [];

    for (const path of paths1) {
      if (paths2.has(path)) {
        overlapping.push(path);
      }
    }

    return overlapping;
  }

  private resolveOverlaps(subtasks: SubTask[], overlaps: OverlapReport[]): SubTask[] {
    for (const overlap of overlaps) {
      const task1 = subtasks.find(st => st.id === overlap.task1Id);
      const task2 = subtasks.find(st => st.id === overlap.task2Id);

      if (task1 && task2) {
        for (const overlappingPath of overlap.overlappingPaths) {
          const index = task2.scope.include.indexOf(overlappingPath);
          if (index > -1) {
            task2.scope.include.splice(index, 1);
            logger.debug('delegation', `Removed overlapping path "${overlappingPath}" from task "${task2.id}"`);
          }
        }

        if (!task2.dependencies.includes(task1.id)) {
          task2.dependencies.push(task1.id);
          logger.debug('delegation', `Added dependency: "${task2.id}" depends on "${task1.id}"`);
        }
      }
    }

    return subtasks;
  }

  private buildDAG(subtasks: SubTask[]): Map<string, string[]> {
    const adjacencyList = new Map<string, string[]>();

    for (const subtask of subtasks) {
      adjacencyList.set(subtask.id, [...subtask.dependencies]);
    }

    if (this.hasCycles(adjacencyList)) {
      logger.warn('delegation', 'Detected cycles in DAG, removing problematic dependencies');
      this.removeCycles(adjacencyList, subtasks);
    }

    return adjacencyList;
  }

  private hasCycles(adjacencyList: Map<string, string[]>): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const [nodeId] of adjacencyList) {
      if (this.detectCycle(nodeId, adjacencyList, visited, recursionStack)) {
        return true;
      }
    }

    return false;
  }

  private detectCycle(
    nodeId: string,
    adjacencyList: Map<string, string[]>,
    visited: Set<string>,
    recursionStack: Set<string>
  ): boolean {
    if (recursionStack.has(nodeId)) {
      return true;
    }

    if (visited.has(nodeId)) {
      return false;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const dependencies = adjacencyList.get(nodeId) || [];
    for (const depId of dependencies) {
      if (this.detectCycle(depId, adjacencyList, visited, recursionStack)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  private removeCycles(adjacencyList: Map<string, string[]>, subtasks: SubTask[]): void {
    for (const subtask of subtasks) {
      const validDeps: string[] = [];
      
      for (const depId of subtask.dependencies) {
        const tempDeps = [...validDeps, depId];
        const tempAdjacencyList = new Map(adjacencyList);
        tempAdjacencyList.set(subtask.id, tempDeps);

        if (!this.detectCycle(subtask.id, tempAdjacencyList, new Set(), new Set())) {
          validDeps.push(depId);
        } else {
          logger.warn('delegation', `Removed cyclic dependency: "${subtask.id}" -> "${depId}"`);
        }
      }

      subtask.dependencies = validDeps;
      adjacencyList.set(subtask.id, validDeps);
    }
  }

  private generatePlanId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateTaskId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
