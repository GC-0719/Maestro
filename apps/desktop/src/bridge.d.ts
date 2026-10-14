export interface MaestroBridge {
  snapshot(): Promise<{ agents: any[]; missions: any[]; version: string }>;
  submit(opts: any): Promise<any>;
  cancel(id: string): Promise<{ cancelled: boolean }>;
  recover(id: string): Promise<{ recovered: boolean }>;
  refreshHealth(): Promise<any[]>;
  onTimeline(fn: (p: { missionId: string; entry: any }) => void): () => void;
}

declare global {
  interface Window {
    maestro?: MaestroBridge;
  }
}

export {};
