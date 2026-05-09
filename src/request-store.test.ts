import { describe, expect, it } from "vitest";
import { WalletConnectRequestStore } from "./request-store.js";

describe("forge wallet harness request store", () => {
  it("captures WalletConnect requests with stable ids and timestamps", () => {
    const store = new WalletConnectRequestStore();

    const request = store.capture({
      method: "invokeFunction",
      params: {
        invocations: [],
      },
      receivedAt: new Date("2026-05-08T12:00:00.000Z"),
      requestId: 42,
      topic: "wc-topic",
    });

    expect(request).toEqual({
      id: "42",
      method: "invokeFunction",
      params: {
        invocations: [],
      },
      receivedAtIso: "2026-05-08T12:00:00.000Z",
      status: "captured",
      topic: "wc-topic",
    });
    expect(store.get("42")).toEqual(request);
  });

  it("tracks approval, rejection, and failure state", () => {
    const store = new WalletConnectRequestStore();
    const first = store.capture({ method: "getWalletInfo", params: [] });
    const second = store.capture({ method: "invokeFunction", params: {} });
    const third = store.capture({ method: "calculateFee", params: {} });

    expect(store.approve(first.id, "ok")).toMatchObject({
      result: "ok",
      status: "approved",
    });
    expect(store.reject(second.id)).toMatchObject({
      error: "User rejected the request",
      status: "rejected",
    });
    expect(store.fail(third.id, "dry-run faulted")).toMatchObject({
      error: "dry-run faulted",
      status: "failed",
    });

    expect(store.list().map((request) => request.status)).toEqual([
      "approved",
      "rejected",
      "failed",
    ]);
  });

  it("does not leak mutable internal request records", () => {
    const store = new WalletConnectRequestStore();
    const request = store.capture({ method: "getWalletInfo", params: [] });

    request.status = "approved";

    expect(store.get(request.id)?.status).toBe("captured");
  });

  it("throws when updating an unknown request", () => {
    const store = new WalletConnectRequestStore();

    expect(() => store.approve("missing", "ok")).toThrow(
      /Unknown WalletConnect harness request/
    );
  });

  it("can clear captured state between tests", () => {
    const store = new WalletConnectRequestStore();
    store.capture({ method: "getWalletInfo", params: [] });

    store.clear();

    expect(store.list()).toEqual([]);
    expect(store.capture({ method: "getWalletInfo", params: [] }).id).toBe(
      "local-1"
    );
  });
});
