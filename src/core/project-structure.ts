import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';

export interface ProjectStructure {
  language: 'java' | 'typescript' | 'python' | 'javascript' | 'unknown';
  buildTool: 'maven' | 'gradle' | 'npm' | 'pip' | 'unknown';
  sourceDirs: string[];
  buildDirs: string[];
  testDirs: string[];
  configFiles: string[];
}

interface LanguageConfig {
  language: ProjectStructure['language'];
  configFiles: string[];
  sourceDirs: string[];
  buildDirs: string[];
  testDirs: string[];
}

const LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    language: 'java',
    configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    sourceDirs: ['src/main/java', 'src/main/kotlin'],
    buildDirs: ['target', 'bin', 'build'],
    testDirs: ['src/test/java', 'src/test/kotlin'],
  },
  {
    language: 'typescript',
    configFiles: ['package.json', 'tsconfig.json'],
    sourceDirs: ['src', 'lib', 'app'],
    buildDirs: ['dist', 'build', '.next'],
    testDirs: ['tests', '__tests__', 'test'],
  },
  {
    language: 'python',
    configFiles: ['requirements.txt', 'setup.py', 'pyproject.toml'],
    sourceDirs: ['src', 'lib', 'app'],
    buildDirs: ['build', 'dist', '__pycache__'],
    testDirs: ['tests', 'test'],
  },
  {
    language: 'javascript',
    configFiles: ['package.json'],
    sourceDirs: ['src', 'lib', 'app', 'js'],
    buildDirs: ['dist', 'build'],
    testDirs: ['tests', '__tests__', 'test'],
  },
];

export function detectProjectStructure(projectPath: string): ProjectStructure {
  const detectedLanguages: Map<string, ProjectStructure> = new Map();

  for (const config of LANGUAGE_CONFIGS) {
    const hasConfigFile = config.configFiles.some((configFile: string) => 
      existsSync(join(projectPath, configFile))
    );

    if (hasConfigFile) {
      const buildTool = determineBuildTool(projectPath, config.language);
      
      detectedLanguages.set(config.language, {
        language: config.language,
        buildTool,
        sourceDirs: config.sourceDirs,
        buildDirs: config.buildDirs,
        testDirs: config.testDirs,
        configFiles: config.configFiles,
      });

      logger.debug('main', `Detected ${config.language} project`, {
        language: config.language,
        configFile: config.configFiles.find((f: string) => existsSync(join(projectPath, f))),
      });
    }
  }

  if (detectedLanguages.size === 0) {
    logger.info('main', 'No known project structure detected, using defaults');
    return {
      language: 'unknown',
      buildTool: 'unknown',
      sourceDirs: ['src'],
      buildDirs: ['dist', 'build', 'target', 'bin'],
      testDirs: ['tests', 'test'],
      configFiles: [],
    };
  }

  if (detectedLanguages.size === 1) {
    const entries = Array.from(detectedLanguages.entries());
    const [language, structure] = entries[0]!;
    logger.info('main', `Detected ${language} project structure`, {
      language: structure.language,
      buildTool: structure.buildTool,
      sourceDirs: structure.sourceDirs,
    });
    return structure;
  }

  const primary = Array.from(detectedLanguages.keys()).find((lang: string) => 
    lang === 'java' || lang === 'typescript'
  ) || Array.from(detectedLanguages.keys())[0];

  if (primary) {
    const primaryStructure = detectedLanguages.get(primary);
    if (primaryStructure) {
      logger.info('main', `Multiple languages detected, prioritizing ${primary}`, {
        detected: Array.from(detectedLanguages.keys()),
        primary,
      });
      return primaryStructure;
    }
  }

  logger.info('main', 'Multiple languages detected, using combined structure');
  return {
    language: 'unknown',
    buildTool: 'unknown',
    sourceDirs: Array.from(new Set(
      ...Array.from(detectedLanguages.values()).flatMap((s: ProjectStructure) => s.sourceDirs)
    )),
    buildDirs: Array.from(new Set(
      ...Array.from(detectedLanguages.values()).flatMap((s: ProjectStructure) => s.buildDirs)
    )),
    testDirs: Array.from(new Set(
      ...Array.from(detectedLanguages.values()).flatMap((s: ProjectStructure) => s.testDirs)
    )),
    configFiles: Array.from(new Set(
      ...Array.from(detectedLanguages.values()).flatMap((s: ProjectStructure) => s.configFiles)
    )),
  };
}

function determineBuildTool(projectPath: string, language: string): ProjectStructure['buildTool'] {
  if (language === 'java') {
    if (existsSync(join(projectPath, 'pom.xml'))) {
      return 'maven';
    }
    if (existsSync(join(projectPath, 'build.gradle')) || existsSync(join(projectPath, 'build.gradle.kts'))) {
      return 'gradle';
    }
  }
  
  if (language === 'typescript' || language === 'javascript') {
    return 'npm';
  }
  
  if (language === 'python') {
    if (existsSync(join(projectPath, 'pyproject.toml'))) {
      return 'pip';
    }
    return 'pip';
  }

  return 'unknown';
}

export function getExcludePatterns(structure: ProjectStructure): string[] {
  const excludePatterns: string[] = [
    'node_modules/**',
    '**/dist/**',
    '**/.git/**',
  ];

  for (const buildDir of structure.buildDirs) {
    excludePatterns.push(`${buildDir}/**`);
    excludePatterns.push(`**/${buildDir}/**`);
  }

  excludePatterns.push('**/*.class');
  excludePatterns.push('**/*.jar');
  excludePatterns.push('**/*.log');
  excludePatterns.push('**/*.iml');
  excludePatterns.push('.vscode/**');
  excludePatterns.push('.idea/**');
  excludePatterns.push('**/surefire-reports/**');
  excludePatterns.push('**/test-classes/**');

  return excludePatterns;
}
