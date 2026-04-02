import pc from 'picocolors';
import { Orchestrator } from '../core/orchestrator';
import { logger } from '../core/logger';

export interface OneshotOptions {
  projectPath: string;
  query: string;
  debug?: boolean;
}

export async function runOneshot(options: OneshotOptions): Promise<void> {
  logger.setDebugMode(options.debug ?? false);

  console.log(pc.cyan('Henchman - AI Developer Assistant'));
  console.log(pc.gray(`Project: ${options.projectPath}`));
  console.log();

  const initSpinner = showSpinner('Initializing project...');

  const orchestrator = new Orchestrator({
    projectPath: options.projectPath,
    autoIndex: true,
  });

  hideSpinner(initSpinner);
  console.log(pc.green('✓ Project initialized'));
  console.log();

  const querySpinner = showSpinner('Processing query...');

  try {
    const response = await orchestrator.handleMessage(options.query);
    hideSpinner(querySpinner);
    console.log();
    console.log(pc.green('Response:'));
    console.log(response);
  } catch (error) {
    hideSpinner(querySpinner);
    console.log();
    console.log(pc.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

function showSpinner(message: string): NodeJS.Timeout {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  process.stdout.write(pc.cyan(frames[0] + ' ' + message));

  return setInterval(() => {
    process.stdout.write('\r' + pc.cyan(frames[i] + ' ' + message));
    i = (i + 1) % frames.length;
  }, 80);
}

function hideSpinner(spinner: NodeJS.Timeout): void {
  clearInterval(spinner);
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
}
