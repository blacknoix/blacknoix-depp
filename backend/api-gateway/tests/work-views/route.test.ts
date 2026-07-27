import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppOptions } from "../../src/app";
import type { WorkSharedViewsRepository } from "../../src/work-views/repository";
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

function stubSharedWorkViews(
  overrides: Partial<WorkSharedViewsRepository> = {},
): WorkSharedViewsRepository {
  return {
    list: async () => [],
    insert: async () => ({
      ok: true,
      view: {
        id: VIEW_ID,
        tenantId: TENANT_ID,
        name: "Intake",
        definition: { sections: ["unowned_open"] },
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        createdByUserId: null,
      },
    }),
    deleteById: async () => undefined,
    getDefaultViewId: async () => null,
    setDefaultViewId: async () => ({ ok: false, reason: "not_found" }),
    clearDefaultViewId: async () => null,
    ...overrides,
  };
}

describe("GET/POST/DELETE /v1/work/views", () => {
  it("rejects agent principals on list", async () => {
    await withServer(
      { sharedWorkViews: stubSharedWorkViews() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/work/views`, {
          headers: tenantHeaders({ "x-agent-id": AGENT_ID }),
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "WORK_REJECTED");
      },
    );
  });

  it("lists and creates for operators; rejects ownerScope", async () => {
    const created: Array<{ name: string; sections: string[] }> = [];
    await withServer(
      {
        sharedWorkViews: stubSharedWorkViews({
          list: async () => [
            {
              id: VIEW_ID,
              tenantId: TENANT_ID,
              name: "Intake",
              definition: { sections: ["unowned_open"] },
              createdAt: new Date("2026-03-01T12:00:00.000Z"),
              createdByUserId: null,
            },
          ],
          insert: async (_tenantId, input) => {
            created.push({
              name: input.name,
              sections: input.definition.sections,
            });
            return {
              ok: true,
              view: {
                id: VIEW_ID,
                tenantId: TENANT_ID,
                name: input.name,
                definition: input.definition,
                createdAt: new Date("2026-03-01T12:00:00.000Z"),
                createdByUserId: null,
              },
            };
          },
        }),
      },
      async (server) => {
        const list = await fetch(`${server.url}/v1/work/views`, {
          headers: tenantHeaders(),
        });
        assert.equal(list.status, 200);
        const listBody = await list.json();
        assert.equal(listBody.data.views.length, 1);
        assert.equal(listBody.data.defaultViewId, null);
        assert.deepEqual(listBody.data.views[0].definition.sections, [
          "unowned_open",
        ]);

        const bad = await fetch(`${server.url}/v1/work/views`, {
          method: "POST",
          headers: {
            ...tenantHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Bad",
            definition: { sections: ["mine"], ownerScope: "me" },
          }),
        });
        assert.equal(bad.status, 400);

        const createdRes = await fetch(`${server.url}/v1/work/views`, {
          method: "POST",
          headers: {
            ...tenantHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Mine focus",
            definition: { sections: ["mine", "action_needed"] },
          }),
        });
        assert.equal(createdRes.status, 201);
        assert.deepEqual(created, [
          { name: "Mine focus", sections: ["action_needed", "mine"] },
        ]);
      },
    );
  });

  it("deletes by id and 404s unknown", async () => {
    await withServer(
      {
        sharedWorkViews: stubSharedWorkViews({
          deleteById: async (_tenantId, id) => {
            if (id !== VIEW_ID) {
              return undefined;
            }
            return {
              id: VIEW_ID,
              tenantId: TENANT_ID,
              name: "Intake",
              definition: { sections: ["unowned_open"] },
              createdAt: new Date("2026-03-01T12:00:00.000Z"),
              createdByUserId: null,
            };
          },
        }),
      },
      async (server) => {
        const missing = await fetch(
          `${server.url}/v1/work/views/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
          {
            method: "DELETE",
            headers: tenantHeaders(),
          },
        );
        assert.equal(missing.status, 404);

        const deleted = await fetch(`${server.url}/v1/work/views/${VIEW_ID}`, {
          method: "DELETE",
          headers: tenantHeaders(),
        });
        assert.equal(deleted.status, 200);
        const body = await deleted.json();
        assert.equal(body.data.view.id, VIEW_ID);
      },
    );
  });
});

describe("PUT/DELETE /v1/work/default", () => {
  it("rejects agent principals", async () => {
    await withServer(
      { sharedWorkViews: stubSharedWorkViews() },
      async (server) => {
        const res = await fetch(`${server.url}/v1/work/default`, {
          method: "PUT",
          headers: {
            ...tenantHeaders({ "x-agent-id": AGENT_ID }),
            "content-type": "application/json",
          },
          body: JSON.stringify({ viewId: VIEW_ID }),
        });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, "WORK_REJECTED");
      },
    );
  });

  it("sets and clears a tenant default; fails closed on unknown view", async () => {
    let defaultId: string | null = null;
    await withServer(
      {
        sharedWorkViews: stubSharedWorkViews({
          list: async () => [
            {
              id: VIEW_ID,
              tenantId: TENANT_ID,
              name: "Intake",
              definition: { sections: ["unowned_open"] },
              createdAt: new Date("2026-03-01T12:00:00.000Z"),
              createdByUserId: null,
            },
          ],
          getDefaultViewId: async () => defaultId,
          setDefaultViewId: async (_tenantId, viewId) => {
            if (viewId !== VIEW_ID) {
              return { ok: false, reason: "not_found" };
            }
            defaultId = viewId;
            return { ok: true, defaultViewId: viewId };
          },
          clearDefaultViewId: async () => {
            const prior = defaultId;
            defaultId = null;
            return prior;
          },
        }),
      },
      async (server) => {
        const missing = await fetch(`${server.url}/v1/work/default`, {
          method: "PUT",
          headers: {
            ...tenantHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            viewId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          }),
        });
        assert.equal(missing.status, 404);

        const set = await fetch(`${server.url}/v1/work/default`, {
          method: "PUT",
          headers: {
            ...tenantHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({ viewId: VIEW_ID }),
        });
        assert.equal(set.status, 200);
        const setBody = await set.json();
        assert.equal(setBody.data.defaultViewId, VIEW_ID);

        const list = await fetch(`${server.url}/v1/work/views`, {
          headers: tenantHeaders(),
        });
        const listBody = await list.json();
        assert.equal(listBody.data.defaultViewId, VIEW_ID);

        const cleared = await fetch(`${server.url}/v1/work/default`, {
          method: "DELETE",
          headers: tenantHeaders(),
        });
        assert.equal(cleared.status, 200);
        const clearedBody = await cleared.json();
        assert.equal(clearedBody.data.defaultViewId, VIEW_ID);

        const listAfter = await fetch(`${server.url}/v1/work/views`, {
          headers: tenantHeaders(),
        });
        const listAfterBody = await listAfter.json();
        assert.equal(listAfterBody.data.defaultViewId, null);
      },
    );
  });

  it("ignores a stale default id not present in the shared views list", async () => {
    const STALE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await withServer(
      {
        sharedWorkViews: stubSharedWorkViews({
          list: async () => [
            {
              id: VIEW_ID,
              tenantId: TENANT_ID,
              name: "Intake",
              definition: { sections: ["unowned_open"] },
              createdAt: new Date("2026-03-01T12:00:00.000Z"),
              createdByUserId: null,
            },
          ],
          getDefaultViewId: async () => STALE,
        }),
      },
      async (server) => {
        const list = await fetch(`${server.url}/v1/work/views`, {
          headers: tenantHeaders(),
        });
        assert.equal(list.status, 200);
        const body = await list.json();
        assert.equal(body.data.defaultViewId, null);
      },
    );
  });
});
