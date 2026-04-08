import { readFile } from 'fs/promises';
import { join } from 'path';

interface DetectedStack {
  name?: string;
  techStack: string;
}

const DETECTORS: Array<{
  file: string;
  detect: (content: string, filePath: string) => DetectedStack | null;
}> = [
  {
    file: 'package.json',
    detect: (content) => {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const tags: string[] = [];
        if (deps['typescript'] || deps['ts-node']) tags.push('TypeScript');
        else tags.push('JavaScript');
        tags.push('Node.js');
        if (deps['react']) tags.push('React');
        if (deps['next']) tags.push('Next.js');
        if (deps['express']) tags.push('Express');
        if (deps['vitest'] || deps['jest']) tags.push('Vitest/Jest');
        if (deps['effect']) tags.push('Effect');
        return { name: pkg.name, techStack: tags.join(', ') };
      } catch { return null; }
    },
  },
  {
    file: 'pom.xml',
    detect: (content) => {
      const tags: string[] = ['Java', 'Maven'];
      if (content.includes('spring-boot')) tags.push('Spring Boot');
      if (content.includes('spring-webmvc') || content.includes('spring-context')) tags.push('Spring');
      if (content.includes('sqlite')) tags.push('SQLite');
      if (content.includes('junit')) tags.push('JUnit');
      if (content.includes('mockito')) tags.push('Mockito');
      const artifactMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
      const name = artifactMatch ? artifactMatch[1] : undefined;
      return { name, techStack: tags.join(', ') };
    },
  },
  {
    file: 'build.gradle',
    detect: (content) => {
      const tags: string[] = ['Java', 'Gradle'];
      if (content.includes('spring-boot')) tags.push('Spring Boot');
      if (content.includes('org.springframework')) tags.push('Spring');
      return { techStack: tags.join(', ') };
    },
  },
  {
    file: 'pom.xml',
    detect: (content) => {
      const tags: string[] = ['Java', 'Maven'];
      
      // Spring Boot - more accurate detection
      const hasSpringBootStarter = /<artifactId>spring-boot-starter/.test(content);
      const hasSpringBootGroup = /<groupId>org\.springframework\.boot<\/groupId>/.test(content);
      const hasSpringBootParent = /<parent>[\s\S]*<groupId>org\.springframework\.boot<\/groupId>/.test(content);
      
      if (hasSpringBootStarter || hasSpringBootGroup || hasSpringBootParent) {
        tags.push('Spring Boot');
      }
      
      // Spring Framework (non-Boot)
      const hasSpringGroup = /<groupId>org\.springframework<\/groupId>/.test(content);
      if (hasSpringGroup && !tags.includes('Spring Boot')) {
        tags.push('Spring');
      }
      
      // Javalin - lightweight web framework
      const hasJavalin = /<groupId>io\.javalin<\/groupId>/.test(content);
      if (hasJavalin) {
        tags.push('Javalin');
      }
      
      // SQLite
      if (/<artifactId>sqlite<\/artifactId>/.test(content) || /<groupId>org\.xerial<\/groupId>/.test(content)) {
        tags.push('SQLite');
      }
      
      // JUnit 5
      if (/<artifactId>org\.junit\.jupiter<\/artifactId>/.test(content)) {
        tags.push('JUnit 5');
      }
      
      // Mockito
      if (/<artifactId>org\.mockito<\/artifactId>/.test(content)) {
        tags.push('Mockito');
      }
      
      // AssertJ
      if (/<artifactId>org\.assertj<\/artifactId>/.test(content)) {
        tags.push('AssertJ');
      }
      
      const artifactMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
      const name = artifactMatch ? artifactMatch[1] : undefined;
      
      return { name, techStack: tags.join(', ') };
    },
  },
  {
    file: 'go.mod',
    detect: (content) => {
      const tags: string[] = ['Go'];
      const nameMatch = content.match(/^module\s+(\S+)/m);
      return { name: nameMatch?.[1], techStack: tags.join(', ') };
    },
  },
  {
    file: 'pyproject.toml',
    detect: (content) => {
      const tags: string[] = ['Python'];
      if (content.includes('django')) tags.push('Django');
      if (content.includes('fastapi')) tags.push('FastAPI');
      if (content.includes('flask')) tags.push('Flask');
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      return { name: nameMatch?.[1], techStack: tags.join(', ') };
    },
  },
];

export async function detectTechStack(projectPath: string): Promise<DetectedStack> {
  for (const detector of DETECTORS) {
    try {
      const filePath = join(projectPath, detector.file);
      const content = await readFile(filePath, 'utf-8');
      const result = detector.detect(content, filePath);
      if (result) return result;
    } catch { /* file not found, skip */ }
  }

  return { techStack: 'Unknown' };
}
