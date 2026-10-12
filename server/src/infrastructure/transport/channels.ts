/**
 * Channel subscription registry shared by the WebSocket transport and the SSE
 * fallback: channel key -> set of subscribers. Pushes are always per-subscriber
 * so each player receives their own sanitized view.
 */

export interface ChannelSubscriber {
  playerId?: string;
  send: (event: string, payload: unknown) => void;
}

export class ChannelSubscribers {
  private readonly channels = new Map<string, Set<ChannelSubscriber>>();

  add(channel: string, sub: ChannelSubscriber): void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(sub);
  }

  remove(channel: string, sub: ChannelSubscriber): void {
    const set = this.channels.get(channel);
    if (!set) return;
    set.delete(sub);
    if (set.size === 0) this.channels.delete(channel);
  }

  forEach(channel: string, fn: (sub: ChannelSubscriber) => void): void {
    this.channels.get(channel)?.forEach(fn);
  }
}
