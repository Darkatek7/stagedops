import { createStagedOpsStore } from '../domain/stagedOps'

/** The single shared application state consumed by UI and WebMCP adapters. */
export const stagedOpsStore = createStagedOpsStore()
