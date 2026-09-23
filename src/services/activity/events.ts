// Everything the gateway records, for extra sinks (e.g. a central audit log later). The local database is always written.

export type GatewayEvent =
  | {
      type: "pre";
      toolUseId: string;
      sessionId: string;
      toolName: string;
      decision: string;
      ruleId: number | null;
      requestId: number | null;
    }
  | { type: "post"; toolUseId: string; sessionId: string; toolName: string };

export type EventSink = (event: GatewayEvent) => void;
const eventSinks: EventSink[] = [];

export function addEventSink(sink: EventSink): void {
  eventSinks.push(sink);
}

export function emitEvent(event: GatewayEvent): void {
  for (const sink of eventSinks) {
    try {
      sink(event);
    } catch {
      // A failing sink must never affect the decision.
    }
  }
}
