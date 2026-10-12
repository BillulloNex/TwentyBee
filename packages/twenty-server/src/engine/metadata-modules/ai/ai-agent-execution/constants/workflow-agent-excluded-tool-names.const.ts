import { type ActionToolId } from 'src/engine/core-modules/tool-provider/constants/action-tool-label.constant';
import { RUN_WORKFLOW_VERSION_TOOL_NAME } from 'src/modules/workflow/workflow-tools/constants/run-workflow-version-tool-name.constant';

export const WORKFLOW_AGENT_EXCLUDED_TOOL_NAMES = [
  'search_help_center',
  'create_file_upload',
  'complete_file_upload',
  // Sharing checks the triggering user's permissions, not the narrower agent role
  'share_record',
  // An agent step that starts runs could start its own workflow and loop forever
  RUN_WORKFLOW_VERSION_TOOL_NAME,
] as const satisfies readonly (
  | ActionToolId
  | typeof RUN_WORKFLOW_VERSION_TOOL_NAME
)[];
