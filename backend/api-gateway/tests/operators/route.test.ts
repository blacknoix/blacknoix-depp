import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type { UsersRepository } from "../../src/users/repository";
import { startTestServer, type TestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function withServer(
  options: AppOptions,
  run: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await startTestServer(options);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

function stubUsers(
  overrides: Partial<UsersRepository> = {},
): UsersRepository {
  return {
    findOrLinkByIdentity: async () => ({ id: USER_A }),
    existsInTenant: async () => false,
    listOperators: async () => [
      {
        id: USER_A,
        email: "alice@example.com",
        displayName: "Alice",
      },
      {
        id: USER_B,
        email: "bob@example.com",
        displayName: "Bob",
      },
    ],
    ...overrides,
  };
}

describe("GET /v1/operators", () => {
  it("lists tenant operators for an operator principal", async () => {
    await withServer({ users: stubUsers() }, async (server) => {
      const res = await fetch(`${server.url}/v1/operators`, {
        headers: { "x-tenant-id": TENANT_ID },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.data.operators.length, 2);
      assert.equal(body.data.operators[0].displayName, "Alice");
    });
  });

  it("rejects agent principals", async () => {
    await withServer({ users: stubUsers() }, async (server) => {
      const res = await fetch(`${server.url}/v1/operators`, {
        headers: {
          "x-tenant-id": TENANT_ID,
          "x-agent-id": AGENT_ID,
        },
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.error.code, "OPERATORS_REJECTED");
    });
  });

  it("fails closed when users repository is not wired", async () => {
    await withServer({}, async (server) => {
      const res = await fetch(`${server.url}/v1/operators`, {
        headers: { "x-tenant-id": TENANT_ID },
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error.code, "OPERATORS_UNAVAILABLE");
    });
  });

  it("rejects query parameters", async () => {
    await withServer({ users: stubUsers() }, async (server) => {
      const res = await fetch(`${server.url}/v1/operators?limit=10`, {
        headers: { "x-tenant-id": TENANT_ID },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, "OPERATORS_INVALID");
    });
  });
});
