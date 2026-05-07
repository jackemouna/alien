import { resolveApprovalOverGateway } from "alien/plugin-sdk/approval-gateway-runtime";
import type { ExecApprovalReplyDecision } from "alien/plugin-sdk/approval-runtime";
import type { AlienConfig } from "alien/plugin-sdk/config-types";
import { isApprovalNotFoundError } from "alien/plugin-sdk/error-runtime";

export { isApprovalNotFoundError };

export async function resolveMatrixApproval(params: {
  cfg: AlienConfig;
  approvalId: string;
  decision: ExecApprovalReplyDecision;
  senderId?: string | null;
  gatewayUrl?: string;
}): Promise<void> {
  await resolveApprovalOverGateway({
    cfg: params.cfg,
    approvalId: params.approvalId,
    decision: params.decision,
    senderId: params.senderId,
    gatewayUrl: params.gatewayUrl,
    clientDisplayName: `Matrix approval (${params.senderId?.trim() || "unknown"})`,
  });
}
