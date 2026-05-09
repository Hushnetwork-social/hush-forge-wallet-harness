import { randomUUID } from "crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";

interface RelayRequest {
  id?: number | string;
  idRaw?: string;
  jsonrpc?: "2.0";
  method?: string;
  params?: Record<string, unknown>;
}

interface RelaySubscription {
  id: string;
  socket: WebSocket;
  topic: string;
}

interface RelayMessage {
  message: unknown;
  publishedAt: number;
  topic: string;
}

export interface LocalWalletConnectRelay {
  close(): Promise<void>;
  url: string;
}

export async function startLocalWalletConnectRelay(
  port: number
): Promise<LocalWalletConnectRelay> {
  const server = new WebSocketServer({ port });
  const subscriptions = new Map<string, RelaySubscription[]>();
  const messages = new Map<string, RelayMessage[]>();
  const proposers = new Map<string, WebSocket>();
  const virtualSubscriptions = new Map<string, Set<WebSocket>>();

  server.on("connection", (socket) => {
    debugRelay("connection", "open", { clients: server.clients.size });

    socket.on("message", (raw) => {
      const request = parseRelayRequest(raw);
      if (!request?.method) return;

      handleRelayRequest(
        socket,
        request,
        subscriptions,
        messages,
        proposers,
        virtualSubscriptions
      );
    });

    socket.on("close", () => {
      debugRelay("connection", "close", { clients: server.clients.size });
      for (const [topic, entries] of subscriptions) {
        const active = entries.filter((entry) => entry.socket !== socket);
        if (active.length) subscriptions.set(topic, active);
        else subscriptions.delete(topic);
      }
      for (const [topic, proposer] of proposers) {
        if (proposer === socket) proposers.delete(topic);
      }
      for (const [topic, sockets] of virtualSubscriptions) {
        sockets.delete(socket);
        if (sockets.size === 0) virtualSubscriptions.delete(topic);
      }
    });
  });

  await new Promise<void>((resolve) => {
    if (server.address()) resolve();
    else server.once("listening", resolve);
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of server.clients) client.close();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: `ws://127.0.0.1:${actualPort}`,
  };
}

function handleRelayRequest(
  socket: WebSocket,
  request: RelayRequest,
  subscriptions: Map<string, RelaySubscription[]>,
  messages: Map<string, RelayMessage[]>,
  proposers: Map<string, WebSocket>,
  virtualSubscriptions: Map<string, Set<WebSocket>>
): void {
  const method = request.method ?? "";
  debugRelay("request", method, request.params);

  if (
    handleCustomWalletConnectRequest(
      socket,
      request,
      subscriptions,
      messages,
      proposers,
      virtualSubscriptions
    )
  ) {
    return;
  }

  const customMessage = readCustomWalletConnectMessage(request);
  if (customMessage) {
    storeRelayMessage(customMessage.topic, customMessage.message, messages);
    sendResult(socket, request, true);
    publishToSubscribers(
      customMessage.topic,
      customMessage.message,
      subscriptions,
      virtualSubscriptions,
      socket
    );
    return;
  }

  if (method.endsWith("_subscribe")) {
    const topic = readTopic(request);
    const id = randomUUID();
    const entries = subscriptions.get(topic) ?? [];
    entries.push({ id, socket, topic });
    subscriptions.set(topic, entries);
    sendResult(socket, request, id);
    replayTopicMessages({ id, socket, topic }, messages.get(topic) ?? []);
    return;
  }

  if (method.endsWith("_batchSubscribe")) {
    const topics = readTopics(request);
    for (const topic of topics) {
      const id = randomUUID();
      const entries = subscriptions.get(topic) ?? [];
      const subscription = { id, socket, topic };
      entries.push(subscription);
      subscriptions.set(topic, entries);
      replayTopicMessages(subscription, messages.get(topic) ?? []);
    }
    sendResult(socket, request, true);
    return;
  }

  if (method.endsWith("_publish")) {
    const topic = readTopic(request);
    const message = request.params?.message;
    storeRelayMessage(topic, message, messages);
    sendResult(socket, request, true);
    publishToSubscribers(topic, message, subscriptions, virtualSubscriptions, socket);
    return;
  }

  if (method.endsWith("_batchFetchMessages")) {
    sendResult(socket, request, {
      messages: readTopics(request).flatMap((topic) => messages.get(topic) ?? []),
    });
    return;
  }

  if (method.endsWith("_unsubscribe")) {
    const topic = readTopic(request);
    const id = String(request.params?.id ?? "");
    const entries = subscriptions.get(topic) ?? [];
    subscriptions.set(
      topic,
      entries.filter((entry) => entry.id !== id)
    );
    sendResult(socket, request, true);
    return;
  }

  sendResult(socket, request, true);
}

function handleCustomWalletConnectRequest(
  socket: WebSocket,
  request: RelayRequest,
  subscriptions: Map<string, RelaySubscription[]>,
  messages: Map<string, RelayMessage[]>,
  proposers: Map<string, WebSocket>,
  virtualSubscriptions: Map<string, Set<WebSocket>>
): boolean {
  if (request.method === "wc_proposeSession") {
    const topic = readStringParam(request.params ?? {}, "pairingTopic");
    const message = readStringParam(request.params ?? {}, "sessionProposal");
    if (!topic || !message) return false;

    proposers.set(topic, socket);
    addVirtualSubscription(virtualSubscriptions, topic, socket);
    storeRelayMessage(topic, message, messages);
    sendResult(socket, request, true);
    publishToSubscribers(topic, message, subscriptions, virtualSubscriptions, socket);
    return true;
  }

  if (request.method === "wc_approveSession") {
    const pairingTopic = readStringParam(request.params ?? {}, "pairingTopic");
    const pairingResponse = readStringParam(
      request.params ?? {},
      "sessionProposalResponse"
    );
    const sessionTopic = readStringParam(request.params ?? {}, "sessionTopic");
    const sessionSettlement = readStringParam(
      request.params ?? {},
      "sessionSettlementRequest"
    );
    if (!pairingTopic || !pairingResponse || !sessionTopic || !sessionSettlement) {
      return false;
    }

    storeRelayMessage(sessionTopic, sessionSettlement, messages);
    addVirtualSubscription(virtualSubscriptions, sessionTopic, socket);
    sendResult(socket, request, true);

    storeRelayMessage(pairingTopic, pairingResponse, messages);
    const pairingDeliveries = publishToSubscribers(
      pairingTopic,
      pairingResponse,
      subscriptions,
      new Map(),
      socket
    );
    const proposer = proposers.get(pairingTopic);
    if (pairingDeliveries === 0 && proposer) {
      sendRelayMessage(
        { id: randomUUID(), socket: proposer, topic: pairingTopic },
        {
          message: pairingResponse,
          publishedAt: Date.now(),
          topic: pairingTopic,
        }
      );
    }
    publishToSubscribers(
      sessionTopic,
      sessionSettlement,
      subscriptions,
      virtualSubscriptions,
      socket
    );
    return true;
  }

  return false;
}

function addVirtualSubscription(
  virtualSubscriptions: Map<string, Set<WebSocket>>,
  topic: string,
  socket: WebSocket
): void {
  const sockets = virtualSubscriptions.get(topic) ?? new Set<WebSocket>();
  sockets.add(socket);
  virtualSubscriptions.set(topic, sockets);
}

function readCustomWalletConnectMessage(
  request: RelayRequest
): RelayMessage | null {
  const params = request.params;
  if (!params) return null;

  const topic =
    readStringParam(params, "pairingTopic") ??
    readStringParam(params, "sessionTopic") ??
    readStringParam(params, "topic");
  const message =
    readStringParam(params, "sessionProposal") ??
    readStringParam(params, "sessionProposalResponse") ??
    readStringParam(params, "sessionSettle") ??
    readStringParam(params, "sessionSettlementRequest") ??
    readStringParam(params, "sessionRequest") ??
    readStringParam(params, "sessionResponse") ??
    readStringParam(params, "message");

  if (!topic || !message || !request.method?.startsWith("wc_")) {
    return null;
  }

  return {
    message,
    publishedAt: Date.now(),
    topic,
  };
}

function readStringParam(
  params: Record<string, unknown>,
  name: string
): string | null {
  const value = params[name];
  return typeof value === "string" ? value : null;
}

function storeRelayMessage(
  topic: string,
  message: unknown,
  messages: Map<string, RelayMessage[]>
): void {
  const topicMessages = messages.get(topic) ?? [];
  topicMessages.push({ message, publishedAt: Date.now(), topic });
  messages.set(topic, topicMessages.slice(-100));
}

function replayTopicMessages(
  subscription: RelaySubscription,
  messages: RelayMessage[]
): void {
  for (const message of messages) {
    sendRelayMessage(subscription, message);
  }
}

function publishToSubscribers(
  topic: string,
  message: unknown,
  subscriptions: Map<string, RelaySubscription[]>,
  virtualSubscriptions: Map<string, Set<WebSocket>>,
  excludeSocket?: WebSocket
): number {
  let deliveries = 0;
  debugRelay("publish", topic, {
    subscribers: subscriptions.get(topic)?.length ?? 0,
    virtualSubscribers: virtualSubscriptions.get(topic)?.size ?? 0,
  });
  for (const entry of subscriptions.get(topic) ?? []) {
    if (entry.socket === excludeSocket) continue;
    sendRelayMessage(entry, { message, publishedAt: Date.now(), topic });
    deliveries += 1;
  }
  for (const socket of virtualSubscriptions.get(topic) ?? []) {
    if (socket === excludeSocket) continue;
    sendRelayMessage(
      { id: randomUUID(), socket, topic },
      { message, publishedAt: Date.now(), topic }
    );
    deliveries += 1;
  }
  return deliveries;
}

function sendRelayMessage(
  subscription: RelaySubscription,
  message: RelayMessage
): void {
  send(subscription.socket, {
    id: Date.now(),
    jsonrpc: "2.0",
    method: "irn_subscription",
    params: {
      data: message,
      id: subscription.id,
    },
  });
}

function debugRelay(event: string, label: string, data: unknown): void {
  if (process.env.FORGE_WALLET_HARNESS_RELAY_DEBUG === "true") {
    console.debug("[forge-wallet-relay]", event, label, data);
  }
}

function readTopic(request: RelayRequest): string {
  const topic = request.params?.topic;
  if (typeof topic !== "string") {
    throw new Error(`Relay request ${request.method} is missing topic.`);
  }
  return topic;
}

function readTopics(request: RelayRequest): string[] {
  const topics = request.params?.topics;
  if (!Array.isArray(topics) || !topics.every((topic) => typeof topic === "string")) {
    throw new Error(`Relay request ${request.method} is missing topics.`);
  }
  return topics;
}

function sendResult(
  socket: WebSocket,
  request: RelayRequest,
  result: unknown
): void {
  sendJsonRpcResult(socket, request.idRaw, request.id, result);
}

function sendJsonRpcResult(
  socket: WebSocket,
  idRaw: string | undefined,
  id: RelayRequest["id"],
  result: unknown
): void {
  if (socket.readyState !== WebSocket.OPEN) return;

  const safeId = idRaw ?? JSON.stringify(id ?? null);
  socket.send(
    `{"id":${safeId},"jsonrpc":"2.0","result":${JSON.stringify(result)}}`
  );
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function parseRelayRequest(raw: RawData): RelayRequest | null {
  const text = raw.toString();
  try {
    const payload = JSON.parse(text) as RelayRequest;
    return payload && typeof payload === "object"
      ? { ...payload, idRaw: readRawJsonRpcId(text) }
      : null;
  } catch {
    return null;
  }
}

function readRawJsonRpcId(text: string): string | undefined {
  return text.match(/"id"\s*:\s*("([^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|null)/)?.[1];
}
