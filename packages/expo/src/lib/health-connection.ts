import { healthStatus } from "./api";
import { healthAgentSharingEnabled } from "./health";

export const HEALTH_CONNECTION_QUERY_KEY = ["health-connection"];

export async function loadHealthConnection() {
  const [sharingEnabled, status] = await Promise.all([
    healthAgentSharingEnabled(),
    healthStatus(),
  ]);
  return { sharingEnabled, status };
}
