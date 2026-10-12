import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';
import { z } from 'zod';

import { buildWorkflowRunTriggerPayload } from 'src/modules/workflow/workflow-trigger/utils/build-workflow-run-trigger-payload.util';
import { RUN_WORKFLOW_VERSION_TOOL_NAME } from 'src/modules/workflow/workflow-tools/constants/run-workflow-version-tool-name.constant';
import {
  type WorkflowToolContext,
  type WorkflowToolDependencies,
} from 'src/modules/workflow/workflow-tools/types/workflow-tool-dependencies.type';

const runWorkflowVersionSchema = z.object({
  coreWorkflowVersionId: z
    .uuid()
    .describe('The core workflow version UUID to run'),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Trigger payload, shaped like the output of the version trigger. Steps read it through {{trigger.*}} variables, so a record-based trigger needs the record fields those steps reference. Omit for a manual trigger with no selected record.',
    ),
});

type RunWorkflowVersionInput = z.infer<typeof runWorkflowVersionSchema>;

const MISSING_USER_ERROR =
  'Running a workflow requires a workspace member: this session is not acting on behalf of a user';

export const createRunWorkflowVersionTool = (
  deps: Pick<WorkflowToolDependencies, 'coreWorkflowLifecycleService'>,
  context: WorkflowToolContext,
) => ({
  name: RUN_WORKFLOW_VERSION_TOOL_NAME,
  description:
    'Run a workflow version now, without waiting for its trigger. This executes every step for real (sends emails, writes records, calls webhooks) and cannot be undone, so confirm with the user before calling it. Works on draft and active versions. The run is queued: this returns a workflowRunId immediately, then use get_workflow_run to follow its status and step results.',
  inputSchema: runWorkflowVersionSchema,
  execute: async (parameters: RunWorkflowVersionInput) => {
    try {
      const actorContext = context.actorContext;
      const workspaceMemberId = actorContext?.workspaceMemberId;

      if (!isDefined(actorContext) || !isNonEmptyString(workspaceMemberId)) {
        return {
          success: false,
          error: MISSING_USER_ERROR,
          message: `Failed to run workflow version: ${MISSING_USER_ERROR}`,
        };
      }

      const { workflowRunId } =
        await deps.coreWorkflowLifecycleService.runCoreWorkflowVersion({
          workspaceId: context.workspaceId,
          userWorkspaceId: context.userWorkspaceId,
          coreWorkflowVersionId: parameters.coreWorkflowVersionId,
          payload: buildWorkflowRunTriggerPayload({
            workspaceMemberId,
            payload: parameters.payload,
          }),
          createdBy: actorContext,
        });

      return {
        success: true,
        workflowRunId,
        coreWorkflowVersionId: parameters.coreWorkflowVersionId,
        message: `Workflow run ${workflowRunId} was queued. Call get_workflow_run with this id to follow its status.`,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: `Failed to run workflow version: ${error.message}`,
      };
    }
  },
});
