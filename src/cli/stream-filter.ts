const CODE_BLOCK_OPEN = '```';
const DSML_PIPE = '\uFF5C';
const DELEGATE_MARKER = '"pattern"';
const DELEGATE_PATTERNS = ['"fan-out"', '"chain"', '"router"'];

export class StreamContentFilter {
  private buffer = '';
  private state: 'text' | 'code_block' | 'dsml' | 'delegate_json' = 'text';
  private readonly output: (text: string) => void;
  private readonly LOOKAHEAD = 10;

  constructor(output: (text: string) => void) {
    this.output = output;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    this.process();
  }

  flush(): void {
    if (this.state === 'text') {
      const clean = this.buffer;
      this.buffer = '';
      if (clean) this.emit(clean);
    } else {
      this.buffer = '';
    }
  }

  reset(): void {
    this.buffer = '';
    this.state = 'text';
  }

  private emit(text: string): void {
    const trimmed = text.replace(/\n{3,}/g, '\n\n');
    if (trimmed) this.output(trimmed);
  }

  private looksLikeDelegateStart(pos: number): boolean {
    const after = this.buffer.substring(pos, pos + 80);
    if (!after.includes(DELEGATE_MARKER)) return false;
    return DELEGATE_PATTERNS.some(p => after.includes(p));
  }

  private findJsonStart(fromPos: number): number {
    for (let i = fromPos; i >= 0; i--) {
      if (this.buffer[i] === '{') return i;
    }
    return -1;
  }

  private findJsonEnd(startPos: number): number {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = startPos; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  private process(): void {
    let safety = 200;
    while (this.buffer.length > 0 && safety-- > 0) {
      if (this.state === 'text') {
        const codeIdx = this.buffer.indexOf(CODE_BLOCK_OPEN);
        const dsmlIdx = this.buffer.indexOf('<' + DSML_PIPE);
        const delegateIdx = this.buffer.indexOf(DELEGATE_MARKER);

        let firstIdx = -1;
        let nextState: 'code_block' | 'dsml' | 'delegate_json' | null = null;

        const candidates: Array<{ idx: number; state: 'code_block' | 'dsml' | 'delegate_json' }> = [];
        if (codeIdx !== -1) candidates.push({ idx: codeIdx, state: 'code_block' });
        if (dsmlIdx !== -1) candidates.push({ idx: dsmlIdx, state: 'dsml' });
        if (delegateIdx !== -1 && this.looksLikeDelegateStart(delegateIdx)) {
          const jsonStart = this.findJsonStart(delegateIdx);
          if (jsonStart !== -1) candidates.push({ idx: jsonStart, state: 'delegate_json' });
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.idx - b.idx);
          firstIdx = candidates[0]!.idx;
          nextState = candidates[0]!.state;
        }

        if (firstIdx !== -1 && nextState) {
          if (firstIdx > 0) {
            this.emit(this.buffer.substring(0, firstIdx));
          }
          this.buffer = this.buffer.substring(firstIdx);
          this.state = nextState;
        } else {
          const safeLen = Math.max(0, this.buffer.length - this.LOOKAHEAD);
          if (safeLen > 0) {
            this.emit(this.buffer.substring(0, safeLen));
            this.buffer = this.buffer.substring(safeLen);
          }
          break;
        }
      } else if (this.state === 'code_block') {
        const nlIdx = this.buffer.indexOf('\n');
        if (nlIdx === -1) break;

        const closeIdx = this.buffer.indexOf(CODE_BLOCK_OPEN, nlIdx + 1);
        if (closeIdx !== -1) {
          this.buffer = this.buffer.substring(closeIdx + 3);
          this.state = 'text';
        } else {
          break;
        }
      } else if (this.state === 'dsml') {
        const dsmlClose = '</' + DSML_PIPE + 'DSML' + DSML_PIPE + 'function_calls>';
        const closeIdx = this.buffer.indexOf(dsmlClose);
        if (closeIdx !== -1) {
          this.buffer = this.buffer.substring(closeIdx + dsmlClose.length);
          this.state = 'text';
        } else {
          const altClose = '</' + DSML_PIPE + 'DSML' + DSML_PIPE;
          if (this.buffer.length > 5000 && this.buffer.indexOf(altClose) === -1) {
            this.buffer = '';
            this.state = 'text';
          }
          break;
        }
      } else if (this.state === 'delegate_json') {
        const endIdx = this.findJsonEnd(0);
        if (endIdx !== -1) {
          this.buffer = this.buffer.substring(endIdx + 1);
          this.state = 'text';
        } else {
          if (this.buffer.length > 8000) {
            this.buffer = '';
            this.state = 'text';
          }
          break;
        }
      }
    }
  }
}
