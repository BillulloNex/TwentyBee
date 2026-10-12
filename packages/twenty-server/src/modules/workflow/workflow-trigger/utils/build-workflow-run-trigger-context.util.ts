import { isDefined } from 'twenty-shared/utils';

import { buildCreatedByFromFullNameMetadata } from 'src/engine/core-modules/actor/utils/build-created-by-from-full-name-metadata.util';
import { buildWorkflowRunTriggerPayload } from 'src/modules/workflow/workflow-trigger/utils/build-workflow-run-trigger-payload.util';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

export const buildWorkflowRunTriggerContext = ({
  workspaceMember,
  payload,
  startingApplicationId,
}: {
  workspaceMember: Pick<WorkspaceMemberWorkspaceEntity, 'id' | 'name'>;
  payload?: object | null;
  startingApplicationId?: string;
}) => ({
  payload: buildWorkflowRunTriggerPayload({
    workspaceMemberId: workspaceMember.id,
    payload,
  }),
  createdBy: {
    ...buildCreatedByFromFullNameMetadata({
      fullNameMetadata: {
        firstName: workspaceMember.name.firstName,
        lastName: workspaceMember.name.lastName,
      },
      workspaceMemberId: workspaceMember.id,
    }),
    ...(isDefined(startingApplicationId)
      ? { context: { applicationId: startingApplicationId } }
      : {}),
  },
});
