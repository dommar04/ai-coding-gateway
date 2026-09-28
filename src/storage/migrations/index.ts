import { initialSchema } from "./001-initial-schema";
import { defaultRules } from "./002-default-rules";
import { ruleGroups } from "./003-rule-groups";
import { dropApprovalRequests } from "./004-drop-approval-requests";
import { dropMeasureMode } from "./005-drop-measure-mode";
import type { Migration } from "./types";

/** All migrations, in order. Append new ones at the end; never reorder or edit released ones. */
export const MIGRATIONS: Migration[] = [initialSchema, defaultRules, ruleGroups, dropApprovalRequests, dropMeasureMode];
