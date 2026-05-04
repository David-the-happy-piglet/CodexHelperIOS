import type { EventType } from "@codex-companion/protocol";
import WebSocket from "ws";

export class EventBroadcaster {
  private readonly clients = new Set<WebSocket>();
  private countChanged?: (count: number) => void;

  setCountChangedHandler(handler: (count: number) => void): void {
    this.countChanged = handler;
  }

  attach(client: WebSocket): void {
    this.clients.add(client);
    this.countChanged?.(this.clients.size);

    client.on("close", () => {
      this.clients.delete(client);
      this.countChanged?.(this.clients.size);
    });
  }

  broadcast<T>(event: EventType, data: T): void {
    const payload = JSON.stringify({ event, data });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  count(): number {
    return this.clients.size;
  }
}

