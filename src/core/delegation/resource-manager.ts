import type { ResourceLock } from './types';
import { logger } from '../logger';

export class FileResourceManager {
  private reservedPaths: Map<string, string> = new Map();
  private resultCache: Map<string, unknown> = new Map();
  private locks: Map<string, ResourceLock> = new Map();
  private lockTimeout: number = 30000;

  reserve(paths: string[], taskId: string): boolean {
    for (const path of paths) {
      const normalizedPath = this.normalizePath(path);
      const currentOwner = this.reservedPaths.get(normalizedPath);
      
      if (currentOwner && currentOwner !== taskId) {
        logger.warn('delegation', `Path "${normalizedPath}" already reserved by task "${currentOwner}"`, {
          path: normalizedPath,
          requestedBy: taskId,
          ownedBy: currentOwner,
        });
        return false;
      }
    }
    
    for (const path of paths) {
      const normalizedPath = this.normalizePath(path);
      this.reservedPaths.set(normalizedPath, taskId);
    }
    
    logger.debug('delegation', `Reserved ${paths.length} paths for task "${taskId}"`, {
      taskId,
      paths: paths.slice(0, 5),
      total: paths.length,
    });
    
    return true;
  }

  release(taskId: string): void {
    const pathsToRelease: string[] = [];
    
    for (const [path, owner] of this.reservedPaths.entries()) {
      if (owner === taskId) {
        pathsToRelease.push(path);
      }
    }
    
    pathsToRelease.forEach(path => this.reservedPaths.delete(path));
    
    for (const [key, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(key);
      }
    }
    
    if (pathsToRelease.length > 0) {
      logger.debug('delegation', `Released ${pathsToRelease.length} paths for task "${taskId}"`, {
        taskId,
        paths: pathsToRelease.slice(0, 5),
      });
    }
  }

  isReserved(path: string): boolean {
    const normalizedPath = this.normalizePath(path);
    return this.reservedPaths.has(normalizedPath);
  }

  getOwner(path: string): string | undefined {
    const normalizedPath = this.normalizePath(path);
    return this.reservedPaths.get(normalizedPath);
  }

  async acquireLock(path: string, taskId: string, timeout?: number): Promise<boolean> {
    const normalizedPath = this.normalizePath(path);
    const lockTimeout = timeout ?? this.lockTimeout;
    
    const existingLock = this.locks.get(normalizedPath);
    if (existingLock) {
      if (Date.now() - existingLock.acquiredAt > existingLock.timeout) {
        this.locks.delete(normalizedPath);
      } else if (existingLock.taskId !== taskId) {
        logger.debug('delegation', `Lock acquisition failed: path "${normalizedPath}" locked by "${existingLock.taskId}"`, {
          path: normalizedPath,
          requestedBy: taskId,
          lockedBy: existingLock.taskId,
        });
        return false;
      }
    }
    
    this.locks.set(normalizedPath, {
      path: normalizedPath,
      taskId,
      acquiredAt: Date.now(),
      timeout: lockTimeout,
    });
    
    logger.debug('delegation', `Lock acquired for path "${normalizedPath}" by task "${taskId}"`, {
      path: normalizedPath,
      taskId,
      timeout: lockTimeout,
    });
    
    return true;
  }

  releaseLock(path: string, taskId: string): void {
    const normalizedPath = this.normalizePath(path);
    const lock = this.locks.get(normalizedPath);
    
    if (lock && lock.taskId === taskId) {
      this.locks.delete(normalizedPath);
      logger.debug('delegation', `Lock released for path "${normalizedPath}" by task "${taskId}"`);
    }
  }

  getCachedResult<T>(key: string): T | null {
    const result = this.resultCache.get(key);
    if (result !== undefined) {
      logger.debug('delegation', `Cache hit for key "${key.substring(0, 50)}..."`);
      return result as T;
    }
    return null;
  }

  setCachedResult<T>(key: string, value: T): void {
    this.resultCache.set(key, value);
    logger.debug('delegation', `Cached result for key "${key.substring(0, 50)}..."`, {
      keyLength: key.length,
      cacheSize: this.resultCache.size,
    });
  }

  hasCachedResult(key: string): boolean {
    return this.resultCache.has(key);
  }

  clearCache(): void {
    const size = this.resultCache.size;
    this.resultCache.clear();
    logger.info('delegation', `Cleared result cache`, { entriesCleared: size });
  }

  getStats(): {
    reservedPaths: number;
    activeLocks: number;
    cacheSize: number;
  } {
    return {
      reservedPaths: this.reservedPaths.size,
      activeLocks: this.locks.size,
      cacheSize: this.resultCache.size,
    };
  }

  cleanup(): void {
    const now = Date.now();
    let expiredLocks = 0;
    
    for (const [key, lock] of this.locks.entries()) {
      if (now - lock.acquiredAt > lock.timeout) {
        this.locks.delete(key);
        expiredLocks++;
      }
    }
    
    if (expiredLocks > 0) {
      logger.debug('delegation', `Cleaned up ${expiredLocks} expired locks`);
    }
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }
}
