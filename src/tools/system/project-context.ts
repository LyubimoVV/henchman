let currentProjectPath: string | null = null;

export function setCurrentProjectPath(path: string): void {
  currentProjectPath = path;
}

export function getCurrentProjectPath(): string | null {
  return currentProjectPath;
}
