import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type { FindingSharedViewsRepository } from "../../src/findings-views/repository";
import { startTestServer, type TestServer } from "../helpers/test-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIEW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function tenantHeaders(extra: Record<string, string> = {}) {
  return {
    "x-tenant-id": TENANT_ID,
    ...extra,
  };
}

function stubSharedViews(
  overrides: Partial<FindingSharedViewsRepository> = {},
): FindingSharedViewsRepository {
  return {
    list: async () => [],
    insert: async () => ({
      ok: true,
      view: {
        id: VIEW_ID,
        tenantId: TENANT_ID,
        name: "Open",
        filters: { status: "open" },
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        createdByUserId: null,
      },
    }),
    deleteById: async () => undefined,
    ...overrides,
  };
}

describe("GET/POST/DELETE /v1/findings/views", () => {
  it("rejects agent principals on list", async () => {
    await withServer(
      { sharedViews: stubSharedViews() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/findings/views`, {
          headers: tenantHeaders({ "x-agent-id": AGENT_ID }),
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "FINDINGS_REJECTED");
      },
    );
  });

  it("lists and creates for operators; rejects findingId", async () => {
    const created: Array<{ name: string }> = [];
    await withServer(
      {
        sharedViews: stubSharedViews({
          list: async () => [
            {
              id: VIEW_ID,
              tenantId: TENANT_ID,
              name: "Open",
              filters: { status: "open" },
              createdAt: new Date("2026-03-01T12:00:00.000Z"),
              createdByUserId: null,
            },
          ],
          insert: async (_tenantId, input) => {
            created.push({ name: input.name });
            return {
              ok: true,
              view: {
                id: VIEW_ID,
                tenantId: TENANT_ID,
                name: input.name,
                filters: input.filters,
                createdAt: new Date("2026-03-01T12:00:00.000Z"),
                createdByUserId: null,
              },
            };
          },
        }),
      },
      async (server) => {
        const list = await fetch(`${server.url}/v1/findings/views`, {
          headers: tenantHeaders(),
        });
        assert.equal(list.status, 200);
        const listBody = await list.json();
        assert.equal(listBody.data.views.length, 1);
        assert.equal(listBody.data.views[0].name, "Open");

        const bad = await fetch(`${server.url}/v1/findings/views`, {
          method: "POST",
          headers: {
            ...tenantHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Bad",
            filters: { findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
          }),
        });
        assert.equal(bad.status, 400);

        const ok = await fetch(`${server.url}/v1/findings/views`, {
          method: "POST",
          headers: {
            ...tenantHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Churn",
            filters: { ruleId: "agent.lifecycle_churn" },
          }),
        });
        assert.equal(ok.status, 201);
        assert.equal(created.length, 1);
        assert.equal(created[0].name, "Churn");

        const withOwner = await fetch(`${server.url}/v1/findings/views`, {
          method: "POST",
          headers: {
            ...tenantHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Mine",
            filters: { ownerScope: "me" },
          }),
        });
        assert.equal(withOwner.status, 201);
        assert.equal(created.length, 2);
        assert.equal(created[1].name, "Mine");
      },
    );
  });

  it("deletes a shared view and maps missing to 404", async () => {
    await withServer(
      {
        sharedViews: stubSharedViews({
          deleteById: async (_tenantId, id) =>
            id === VIEW_ID
              ? {
                  id: VIEW_ID,
                  tenantId: TENANT_ID,
                  name: "Open",
                  filters: { status: "open" },
                  createdAt: new Date("2026-03-01T12:00:00.000Z"),
                  createdByUserId: null,
                }
              : undefined,
        }),
      },
      async (server) => {
        const missing = await fetch(
          `${server.url}/v1/findings/views/ffffffff-ffff-4fff-8fff-ffffffffffff`,
          {
            method: "DELETE",
            headers: tenantHeaders(),
          },
        );
        assert.equal(missing.status, 404);

        const ok = await fetch(`${server.url}/v1/findings/views/${VIEW_ID}`, {
          method: "DELETE",
          headers: tenantHeaders(),
        });
        assert.equal(ok.status, 200);
        const body = await ok.json();
        assert.equal(body.data.view.id, VIEW_ID);
      },
    );
  });

  it("fails closed with 503 when shared views are not wired", async () => {
    await withServer({}, async (server) => {
      const res = await fetch(`${server.url}/v1/findings/views`, {
        headers: tenantHeaders(),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error.code, "FINDINGS_UNAVAILABLE");
    });
  });
});
