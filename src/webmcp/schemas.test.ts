import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { toolSchemas, type ToolName } from './schemas'

const ajv = new Ajv2020({ allErrors: true })
const validInputs: Record<ToolName, unknown> = {
  get_fleet_summary: {},
  find_devices: {},
  inspect_device: { deviceId: 'dev-060' },
  explain_policy_conflicts: {},
  simulate_policy_change: { policyId: 'pol-rapid-update-enforcement', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1 },
  stage_policy_change: { simulationId: 'sim-cfg1-production-restart-7d', expectedConfigRevision: 1 },
  get_staged_change: {},
  apply_staged_change: { stageId: 'change-000001', expectedConfigRevision: 1 },
  rollback_last_change: { changeId: 'change-000001', expectedConfigRevision: 2 },
  get_audit_log: {},
}

describe('WebMCP input schemas', () => {
  it('defines valid JSON Schema 2020-12 contracts for all ten tools', () => {
    expect(Object.keys(toolSchemas)).toEqual(Object.keys(validInputs))
    for (const [name, schema] of Object.entries(toolSchemas)) {
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(false)
      expect(ajv.compile(schema)(validInputs[name as ToolName]), name).toBe(true)
    }
  })

  it.each(Object.keys(validInputs) as ToolName[])('rejects unknown properties for %s', (name) => {
    const validate = ajv.compile(toolSchemas[name])
    expect(validate({ ...(validInputs[name] as object), unexpected: true })).toBe(false)
  })

  it('enforces device filters, uniqueness, limits, and exact identifiers', () => {
    const find = ajv.compile(toolSchemas.find_devices)
    expect(find({ query: '', departments: ['Finance', 'Finance'], limit: 61, offset: -1 })).toBe(false)
    expect(find({ query: 'fin', departments: ['Finance'], rings: ['Production'], statuses: ['POLICY_CONFLICT'], limit: 20, offset: 0 })).toBe(true)

    const inspect = ajv.compile(toolSchemas.inspect_device)
    expect(inspect({ deviceId: 'dev-061' })).toBe(false)
    expect(inspect({})).toBe(false)
  })

  it('enforces exact simulation, stage, apply, and rollback contracts', () => {
    expect(ajv.compile(toolSchemas.simulate_policy_change)({ policyId: 'other', field: 'updates.restartDeadlineDays', proposedValue: 7, expectedConfigRevision: 1 })).toBe(false)
    expect(ajv.compile(toolSchemas.stage_policy_change)({ simulationId: 'sim-cfg01-production-restart-7d', expectedConfigRevision: 1 })).toBe(false)
    expect(ajv.compile(toolSchemas.apply_staged_change)({ stageId: 'stage-1', expectedConfigRevision: 1 })).toBe(false)
    expect(ajv.compile(toolSchemas.rollback_last_change)({ changeId: 'change-000001', expectedConfigRevision: -1 })).toBe(false)
  })

  it('enforces conflict and audit array constraints', () => {
    expect(ajv.compile(toolSchemas.explain_policy_conflicts)({ deviceIds: ['dev-001', 'dev-001'] })).toBe(false)
    expect(ajv.compile(toolSchemas.get_audit_log)({ actors: ['Robot'], actions: ['apply'], beforeSequence: 0, limit: 51 })).toBe(false)
    expect(ajv.compile(toolSchemas.get_audit_log)({ actors: ['Human'], actions: ['stage', 'apply'], beforeSequence: 2, limit: 20 })).toBe(true)
  })
})
