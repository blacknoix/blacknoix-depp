import type { ThreatEventEnvelope } from "./envelope";

/**
 * Gossip seam for THREATEVENT dissemination. Real libp2p gossipsub is deferred.
 */
export interface GossipSeam {
  publish(envelope: ThreatEventEnvelope): Promise<void>;
}

/**
 * In-memory / single-node gossip: records publishes for tests; no network.
 */
export function createInMemoryGossip(): GossipSeam & {
  published: ThreatEventEnvelope[];
} {
  const published: ThreatEventEnvelope[] = [];
  return {
    published,
    async publish(envelope) {
      published.push(envelope);
    },
  };
}
