import { apiRequest } from "./client";
import type { OperatorSession } from "../auth/session";
import type { WorkQueueSectionId } from "../work/workQueue";

export interface SharedWorkViewDefinition {
  sections: WorkQueueSectionId[];
}

export interface SharedWorkView {
  id: string;
  name: string;
  definition: SharedWorkViewDefinition;
  createdAt: string;
  createdByUserId: string | null;
}

export interface SharedWorkViewsPayload {
  views: SharedWorkView[];
  /** Present when a valid tenant default shared view is configured. */
  defaultViewId: string | null;
}

export async function fetchSharedWorkViews(
  session: OperatorSession,
): Promise<SharedWorkViewsPayload> {
  const data = await apiRequest<SharedWorkViewsPayload>(
    session,
    "/v1/work/views",
  );
  return {
    views: data.views,
    defaultViewId: data.defaultViewId ?? null,
  };
}

export async function createSharedWorkView(
  session: OperatorSession,
  input: { name: string; definition: SharedWorkViewDefinition },
): Promise<SharedWorkView> {
  const data = await apiRequest<{ view: SharedWorkView }>(
    session,
    "/v1/work/views",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        definition: { sections: input.definition.sections },
      }),
    },
  );
  return data.view;
}

export async function deleteSharedWorkView(
  session: OperatorSession,
  id: string,
): Promise<SharedWorkView> {
  const data = await apiRequest<{ view: SharedWorkView }>(
    session,
    `/v1/work/views/${id}`,
    { method: "DELETE" },
  );
  return data.view;
}

export async function setTenantWorkDefault(
  session: OperatorSession,
  viewId: string,
): Promise<string> {
  const data = await apiRequest<{ defaultViewId: string }>(
    session,
    "/v1/work/default",
    {
      method: "PUT",
      body: JSON.stringify({ viewId }),
    },
  );
  return data.defaultViewId;
}

export async function clearTenantWorkDefault(
  session: OperatorSession,
): Promise<string | null> {
  const data = await apiRequest<{ defaultViewId: string | null }>(
    session,
    "/v1/work/default",
    { method: "DELETE" },
  );
  return data.defaultViewId ?? null;
}
