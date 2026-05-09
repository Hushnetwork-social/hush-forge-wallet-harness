import { describe, expect, it, vi } from "vitest";
import {
  assertNeoNetworkMagic,
  fetchNeoNetworkMagic,
  type FetchLike,
} from "./chain-magic.js";

describe("forge wallet harness chain magic guard", () => {
  it("fetches the Neo network magic through getversion", async () => {
    const fetchImpl = mockFetch({
      result: {
        protocol: {
          network: 5_195_086,
        },
      },
    });

    await expect(
      fetchNeoNetworkMagic("http://localhost:10332", fetchImpl)
    ).resolves.toBe(5_195_086);

    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      jsonrpc: "2.0",
      method: "getversion",
      params: [],
    });
  });

  it("accepts string network magic from RPC implementations", async () => {
    const fetchImpl = mockFetch({
      result: {
        protocol: {
          network: "5195086",
        },
      },
    });

    await expect(
      fetchNeoNetworkMagic("http://localhost:10332", fetchImpl)
    ).resolves.toBe(5_195_086);
  });

  it("fails when the RPC endpoint is not the expected private network", async () => {
    const fetchImpl = mockFetch({
      result: {
        protocol: {
          network: 860_833_102,
        },
      },
    });

    await expect(
      assertNeoNetworkMagic({
        expectedMagic: 5_195_086,
        fetchImpl,
        rpcUrl: "http://localhost:10332",
      })
    ).rejects.toThrow(/expected 5195086/);
  });

  it("surfaces JSON-RPC getversion errors", async () => {
    const fetchImpl = mockFetch({
      error: {
        code: -32601,
        message: "Method not found",
      },
    });

    await expect(
      fetchNeoNetworkMagic("http://localhost:10332", fetchImpl)
    ).rejects.toThrow(/Method not found/);
  });

  it("rejects malformed getversion responses", async () => {
    const fetchImpl = mockFetch({
      result: {
        protocol: {},
      },
    });

    await expect(
      fetchNeoNetworkMagic("http://localhost:10332", fetchImpl)
    ).rejects.toThrow(/valid network magic/);
  });
});

function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(async () => {
    return new Response(JSON.stringify(body), {
      headers: {
        "Content-Type": "application/json",
      },
      status,
    });
  });
}
