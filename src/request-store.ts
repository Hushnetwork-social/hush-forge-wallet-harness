import type { Neo3WalletConnectMethod } from "./constants.js";

export type WalletConnectHarnessRequestStatus =
  | "captured"
  | "approved"
  | "failed"
  | "rejected";

export interface CaptureWalletConnectRequestInput<TParams = unknown> {
  method: Neo3WalletConnectMethod | string;
  params: TParams;
  receivedAt?: Date;
  requestId?: number | string;
  topic?: string;
}

export interface WalletConnectHarnessRequest<TParams = unknown> {
  error?: string;
  id: string;
  method: string;
  params: TParams;
  receivedAtIso: string;
  result?: unknown;
  status: WalletConnectHarnessRequestStatus;
  topic: string;
}

export class WalletConnectRequestStore {
  private nextGeneratedId = 1;
  private requests: WalletConnectHarnessRequest[] = [];

  capture<TParams>(
    input: CaptureWalletConnectRequestInput<TParams>
  ): WalletConnectHarnessRequest<TParams> {
    const request: WalletConnectHarnessRequest<TParams> = {
      id: input.requestId?.toString() ?? `local-${this.nextGeneratedId++}`,
      method: input.method,
      params: input.params,
      receivedAtIso: (input.receivedAt ?? new Date()).toISOString(),
      status: "captured",
      topic: input.topic ?? "local",
    };

    this.requests.push(request as WalletConnectHarnessRequest);

    return { ...request };
  }

  approve(id: string, result: unknown): WalletConnectHarnessRequest {
    return this.update(id, {
      result,
      status: "approved",
    });
  }

  fail(id: string, error: string): WalletConnectHarnessRequest {
    return this.update(id, {
      error,
      status: "failed",
    });
  }

  reject(id: string, error = "User rejected the request"): WalletConnectHarnessRequest {
    return this.update(id, {
      error,
      status: "rejected",
    });
  }

  list(): WalletConnectHarnessRequest[] {
    return this.requests.map((request) => ({ ...request }));
  }

  get(id: string): WalletConnectHarnessRequest | undefined {
    const request = this.requests.find((entry) => entry.id === id);
    return request ? { ...request } : undefined;
  }

  clear(): void {
    this.nextGeneratedId = 1;
    this.requests = [];
  }

  private update(
    id: string,
    patch: Pick<WalletConnectHarnessRequest, "status"> &
      Partial<Pick<WalletConnectHarnessRequest, "error" | "result">>
  ): WalletConnectHarnessRequest {
    const index = this.requests.findIndex((entry) => entry.id === id);

    if (index === -1) {
      throw new Error(`Unknown WalletConnect harness request: ${id}`);
    }

    const updated = {
      ...this.requests[index],
      ...patch,
    };

    this.requests[index] = updated;

    return { ...updated };
  }
}
