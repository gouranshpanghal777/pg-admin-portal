import type { Role } from '../App'

export type AuditEvent = {
  id: string
  at: string
  userId: string
  userName: string
  userRole: Role
  branchId: string
  branchName: string
  module: string
  actionType: string
  description: string
  metadata?: Record<string, string | number | boolean | null>
  correlationId?: string
}

export const AUDIT_MODULES = {
  AUTH: 'Authentication',
  TENANT: 'Tenant',
  PAYMENT: 'Payment',
  SECURITY: 'Security',
  CASHBOOK: 'Cashbook',
  ROOM: 'Room',
  MAINTENANCE: 'Maintenance',
  INVENTORY: 'Inventory',
  FINANCE: 'Finance',
  BRANCH: 'Branch',
  STAFF: 'Staff',
  REPORT: 'Report',
  SETTINGS: 'Settings',
  SYSTEM: 'System',
} as const

export const ACTIONS = {
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  EXPORT: 'Export',
  RESOLVE: 'Resolve',
  REOPEN: 'Reopen',
  VACATE: 'Vacate',
  REJOIN: 'Rejoin',
  RESTORE: 'Restore',
  NOTICE: 'Notice',
} as const

let correlationCounter = 0

export function nextCorrelationId(): string {
  correlationCounter += 1
  return `evt-${Date.now().toString(36)}-${correlationCounter.toString(36)}`
}

export function createAuditEvent(input: {
  userId: string
  userName: string
  userRole: Role
  branchId: string
  branchName: string
  module: string
  actionType: string
  description: string
  metadata?: Record<string, string | number | boolean | null>
  correlationId?: string
}): AuditEvent {
  return {
    id: `log-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    userId: input.userId,
    userName: input.userName,
    userRole: input.userRole,
    branchId: input.branchId,
    branchName: input.branchName,
    module: input.module,
    actionType: input.actionType,
    description: input.description,
    metadata: input.metadata,
    correlationId: input.correlationId,
  }
}

export function auditDescription(pattern: string, ...args: (string | number)[]): string {
  let result = pattern
  for (const arg of args) {
    result = result.replace(/\{\}/, String(arg))
  }
  return result
}
