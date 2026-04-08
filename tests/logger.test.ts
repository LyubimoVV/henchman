import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../src/core/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger('warn', false);
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should log debug messages when debug mode is enabled', () => {
    logger.setDebugMode(true);
    logger.debug('main', 'test message');
    
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should not log debug messages when min level is warn', () => {
    logger.setLevel('warn');
    logger.debug('main', 'test message');
    
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should log info messages when level is info', () => {
    logger.setLevel('info');
    logger.info('main', 'info message');
    
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should log warn messages', () => {
    logger.warn('main', 'warn message');
    
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should log error messages to console.error', () => {
    logger.error('main', 'error message');
    
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should set debug mode and show debug logs', () => {
    logger.setDebugMode(true);
    logger.debug('main', 'debug message');
    
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should disable debug mode and hide debug logs', () => {
    logger.setDebugMode(true);
    logger.setDebugMode(false);
    logger.debug('main', 'should not appear');
    
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
