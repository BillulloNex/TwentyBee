import { FieldActorSource } from 'twenty-shared/types';

import { createRunWorkflowVersionTool } from 'src/modules/workflow/workflow-tools/tools/run-workflow-version.tool';
import { type WorkflowToolContext } from 'src/modules/workflow/workflow-tools/types/workflow-tool-dependencies.type';

const CORE_WORKFLOW_VERSION_ID = 'b3b8a4f0-0000-4000-8000-000000000000';
const WORKFLOW_RUN_ID = 'c4c9b5a1-0000-4000-8000-000000000000';
const WORKSPACE_MEMBER_ID = 'd5dac6b2-0000-4000-8000-000000000000';

const USER_ACTOR = {
  source: FieldActorSource.AGENT,
  workspaceMemberId: WORKSPACE_MEMBER_ID,
  name: 'Jane Doe',
  context: {},
};

const buildTool = (contextOverride: Partial<WorkflowToolContext> = {}) => {
  const coreWorkflowLifecycleService = {
    runCoreWorkflowVersion: jest
      .fn()
      .mockResolvedValue({ workflowRunId: WORKFLOW_RUN_ID }),
  };

  const tool = createRunWorkflowVersionTool(
    { coreWorkflowLifecycleService } as never,
    {
      workspaceId: 'workspace-id',
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
      userWorkspaceId: 'user-workspace-id',
      actorContext: USER_ACTOR,
      ...contextOverride,
    },
  );

  return { tool, coreWorkflowLifecycleService };
};

const baseInput = { coreWorkflowVersionId: CORE_WORKFLOW_VERSION_ID };

describe('createRunWorkflowVersionTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should queue a run on behalf of the acting workspace member', async () => {
    const { tool, coreWorkflowLifecycleService } = buildTool();

    const result = (await tool.execute({
      ...baseInput,
      payload: { name: 'Acme' },
    })) as Record<string, unknown>;

    expect(
      coreWorkflowLifecycleService.runCoreWorkflowVersion,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      userWorkspaceId: 'user-workspace-id',
      coreWorkflowVersionId: CORE_WORKFLOW_VERSION_ID,
      payload: {
        name: 'Acme',
        payload: { name: 'Acme' },
        metadata: { workspaceMemberId: WORKSPACE_MEMBER_ID },
      },
      createdBy: USER_ACTOR,
    });
    expect(result.success).toBe(true);
    expect(result.workflowRunId).toBe(WORKFLOW_RUN_ID);
  });

  it('should run without a payload', async () => {
    const { tool, coreWorkflowLifecycleService } = buildTool();

    const result = (await tool.execute(baseInput)) as Record<string, unknown>;

    expect(
      coreWorkflowLifecycleService.runCoreWorkflowVersion,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          payload: {},
          metadata: { workspaceMemberId: WORKSPACE_MEMBER_ID },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('should refuse to run when there is no actor', async () => {
    const { tool, coreWorkflowLifecycleService } = buildTool({
      actorContext: undefined,
    });

    const result = (await tool.execute(baseInput)) as Record<string, unknown>;

    expect(
      coreWorkflowLifecycleService.runCoreWorkflowVersion,
    ).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires a workspace member');
  });

  it('should refuse to run when the actor is not a workspace member', async () => {
    const { tool, coreWorkflowLifecycleService } = buildTool({
      actorContext: { ...USER_ACTOR, workspaceMemberId: null },
    });

    const result = (await tool.execute(baseInput)) as Record<string, unknown>;

    expect(
      coreWorkflowLifecycleService.runCoreWorkflowVersion,
    ).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('should return a failure result when the run throws', async () => {
    const { tool, coreWorkflowLifecycleService } = buildTool();

    coreWorkflowLifecycleService.runCoreWorkflowVersion.mockRejectedValue(
      new Error('boom'),
    );

    const result = (await tool.execute(baseInput)) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.message).toContain('boom');
  });
});
