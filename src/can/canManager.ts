import { CanFrame, CanSpeed, CanIdType } from '../types';

export class CanManager {
  private frames: CanFrame[] = [];
  private maxStoredFrames = 150;
  private listeners: ((frames: CanFrame[]) => void)[] = [];
  private pendingBatch: CanFrame[] = [];
  private throttleTimer: any = null;
  private filterId: string = '';
  private isPaused: boolean = false;

  public subscribe(listener: (frames: CanFrame[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public setFilter(idFilter: string) {
    this.filterId = idFilter.trim();
  }

  public togglePause(paused?: boolean) {
    this.isPaused = paused !== undefined ? paused : !this.isPaused;
    return this.isPaused;
  }

  public getIsPaused() {
    return this.isPaused;
  }

  public addFrame(frame: Partial<CanFrame> & { id: string; dlc: number; dataHex: string; dataBytes: number[]; direction: 'Rx' | 'Tx' }): CanFrame {
    const fullFrame: CanFrame = {
      ...frame,
      timestamp: frame.timestamp || new Date().toLocaleTimeString(),
      isExtended: frame.isExtended || false,
      description: frame.description || ''
    };

    this.frames.push(fullFrame);
    if (this.frames.length > this.maxStoredFrames) {
      this.frames = this.frames.slice(-this.maxStoredFrames);
    }
    
    if (!this.isPaused) {
      this.pendingBatch.push(fullFrame);
      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          const batch = [...this.pendingBatch];
          this.pendingBatch = [];
          this.throttleTimer = null;
          if (batch.length > 0) {
            this.listeners.forEach(l => l(batch));
          }
        }, 100); // Batch and throttle UI updates to 10fps max
      }
    }
    return fullFrame;
  }

  public clear() {
    this.frames = [];
    this.pendingBatch = [];
  }

  public clearFrames() {
    this.clear();
  }

  public getFrames(): CanFrame[] {
    return [...this.frames];
  }

  public static formatBytesToHex(bytes: number[]): string {
    return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  }

  public static parseHexStringToBytes(hex: string): number[] {
    const cleaned = hex.replace(/[^0-9A-Fa-f]/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
    }
    return bytes;
  }
}

export const canManager = new CanManager();
