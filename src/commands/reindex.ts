import type { Orchestrator } from '../core/orchestrator';
import pc from 'picocolors';

export async function handleIndexCommand(orchestrator: Orchestrator): Promise<string> {
  try {
    const result = await orchestrator.reindexProject();
    return pc.green(`Project re-indexed: ${result.files} files, ${result.chunks} chunks`);
  } catch (error) {
    return pc.red(`Failed to re-index: ${(error as Error).message}`);
  }
}
