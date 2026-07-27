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

export async function fetchSharedWorkViews(
  session: OperatorSession,
): Promise<SharedWorkView[]> {
  const data = await apiRequest<{ views: SharedWorkView[] }>(
    session,
    "/v1/work/views",
  );
  return data.views;
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
