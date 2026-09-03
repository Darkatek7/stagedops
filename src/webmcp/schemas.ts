export const toolNames = [
  'get_fleet_summary',
  'find_devices',
  'inspect_device',
  'explain_policy_conflicts',
  'simulate_policy_change',
  'stage_policy_change',
  'get_staged_change',
  'apply_staged_change',
  'rollback_last_change',
  'get_audit_log',
] as const

export type ToolName = (typeof toolNames)[number]

type JsonSchema = Readonly<Record<string, unknown>>

const schema = (properties: Record<string, unknown>, required: readonly string[] = []): JsonSchema => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const deviceId = { type: 'string', pattern: '^dev-(00[1-9]|0[1-5][0-9]|060)$' }
const revision = { type: 'integer', minimum: 0 }
const uniqueEnumArray = (values: readonly string[], maxItems: number, minItems?: number) => ({
  type: 'array',
  items: { type: 'string', enum: values },
  uniqueItems: true,
  maxItems,
  ...(minItems === undefined ? {} : { minItems }),
})

export const toolSchemas: Record<ToolName, JsonSchema> = {
  get_fleet_summary: schema({}),
  find_devices: schema({
    query: { type: 'string', minLength: 1, maxLength: 80 },
    departments: uniqueEnumArray(['Engineering', 'Finance', 'Operations', 'Sales', 'Support'], 5),
    rings: uniqueEnumArray(['Pilot', 'Staging', 'Production'], 3),
    statuses: uniqueEnumArray(['COMPLIANT', 'POLICY_CONFLICT', 'OS_VERSION_BLOCKED'], 3),
    limit: { type: 'integer', minimum: 1, maximum: 60, default: 20 },
    offset: { type: 'integer', minimum: 0, maximum: 59, default: 0 },
  }),
  inspect_device: schema({ deviceId }, ['deviceId']),
  explain_policy_conflicts: schema({ deviceIds: { type: 'array', items: deviceId, uniqueItems: true, minItems: 1, maxItems: 20 } }),
  simulate_policy_change: schema({
    policyId: { type: 'string', const: 'pol-rapid-update-enforcement' },
    field: { type: 'string', const: 'updates.restartDeadlineDays' },
    proposedValue: { type: 'integer', const: 7 },
    expectedConfigRevision: revision,
  }, ['policyId', 'field', 'proposedValue', 'expectedConfigRevision']),
  stage_policy_change: schema({
    simulationId: { type: 'string', pattern: '^sim-cfg(?:0|[1-9][0-9]*)-production-restart-7d$' },
    expectedConfigRevision: revision,
  }, ['simulationId', 'expectedConfigRevision']),
  get_staged_change: schema({}),
  apply_staged_change: schema({
    stageId: { type: 'string', pattern: '^change-[0-9]{6}$' },
    expectedConfigRevision: revision,
  }, ['stageId', 'expectedConfigRevision']),
  rollback_last_change: schema({
    changeId: { type: 'string', pattern: '^change-[0-9]{6}$' },
    expectedConfigRevision: revision,
  }, ['changeId', 'expectedConfigRevision']),
  get_audit_log: schema({
    actors: uniqueEnumArray(['Human', 'Agent'], 2),
    actions: uniqueEnumArray(['stage', 'authorize', 'apply', 'rollback', 'reset'], 5),
    beforeSequence: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  }),
}
