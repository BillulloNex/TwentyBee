import {
  WORKFLOW_TRIGGER_METADATA_KEY,
  WORKFLOW_TRIGGER_METADATA_WORKSPACE_MEMBER_ID_KEY,
  WORKFLOW_TRIGGER_PAYLOAD_KEY,
} from 'twenty-shared/workflow';

export const buildWorkflowRunTriggerPayload = ({
  workspaceMemberId,
  payload,
}: {
  workspaceMemberId: string;
  payload?: object | null;
}) => ({
  ...payload,
  [WORKFLOW_TRIGGER_PAYLOAD_KEY]: { ...payload },
  [WORKFLOW_TRIGGER_METADATA_KEY]: {
    [WORKFLOW_TRIGGER_METADATA_WORKSPACE_MEMBER_ID_KEY]: workspaceMemberId,
  },
});
