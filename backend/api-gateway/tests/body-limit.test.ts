import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApp } from "../src/app";
import { startTestServer, type TestServer } from "./helpers/test-server";

/**
 * Builds a JSON payload of approximately `bytes` total length.
 */
function jsonOfSize(bytes: number): string {
  const envelope = '{"a":""}';
  return `{"a":"${"x".repeat(Math.max(0, bytes - envelope.length))}"}`;
}

async function postJson(server: TestServer, body: string): Promise<Response> {
  return fetch(`${server.url}/v1/tenants/me`, {
    method: "POST",
    headers: {
      "x-tenant-id": "tenant-dev-001",
      "content-type": "application/json",
    },
    body,
  });
}

async function withServer(
  options: Parameters<typeof startTestServer>[0],
  run: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await startTestServer(options);

  try {
    await run(server);
  } finally {
    await server.close();
  }
}

describe("configurable JSON body limit", () => {
  it("rejects a body over an explicitly configured limit", async () => {
    await withServer({ jsonBodyLimit: "1kb" }, async (server) => {
      const res = await postJson(server, jsonOfSize(4096));
      const body = await res.json();

      assert.equal(res.status, 413);
      assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
      assert.equal(body.error.message, "Request body is too large");
    });
  });

  it("accepts a body under the configured limit", async () => {
    await withServer({ jsonBodyLimit: "1kb" }, async (server) => {
      const res = await postJson(server, jsonOfSize(512));
      const body = await res.json();

      // There is no POST route on /v1/tenants/me, so a 404 here is the proof
      // that the body was parsed successfully rather than rejected: a
      // limit-rejected request would have returned 413 before routing.
      assert.equal(res.status, 404);
      assert.equal(body.error.code, "NOT_FOUND");
    });
  });

  it("accepts a numeric byte-count limit", async () => {
    await withServer({ jsonBodyLimit: 1024 }, async (server) => {
      const over = await postJson(server, jsonOfSize(4096));
      assert.equal(over.status, 413);

      const under = await postJson(server, jsonOfSize(256));
      assert.equal(under.status, 404);
    });
  });
});

describe("default JSON body limit", () => {
  it("defaults to 100kb when no limit is configured", async () => {
    await withServer({}, async (server) => {
      const under = await postJson(server, jsonOfSize(99 * 1024));
      assert.equal(under.status, 404, "99kb should be under the default limit");

      const over = await postJson(server, jsonOfSize(150 * 1024));
      const overBody = await over.json();

      assert.equal(over.status, 413, "150kb should exceed the default limit");
      assert.equal(overBody.error.code, "PAYLOAD_TOO_LARGE");
    });
  });
});

describe("invalid limit configuration", () => {
  it("fails closed at startup rather than silently disabling the limit", () => {
    // body-parser validates the limit when the parser is constructed, so a
    // typo in BODY_LIMIT_DEFAULT crashes the service instead of leaving
    // request bodies unbounded.
    assert.throws(() => createApp({ jsonBodyLimit: "not-a-size" }), /limit/i);
  });
});
