import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './lib/supabase'
import { admitTenant, cleanupOldActivityLogs, createStaffAccount, deactivateStaffAccount, deleteBranchCascade, deleteCashbookEntryCascade, deleteTenantWithPayments, editTenantWithRentAdjustment, getAffectedTables, getBranchRentCollectionSummary, loadAppData, loadActivityLogs, persistAppData, reactivateUserAccount, recordSplitPayment, refreshTables, resetUserPassword, swapTenantRooms, undoVacateTenant, vacateTenantErp } from './lib/database'
import type { RentCollectionSummary } from './lib/database'
import { importedRentPaidMonths } from './data/farukhnagarRentRegister'
import {
  AlertTriangle,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  Download,
  Edit3,
  Eye,
  FileBarChart,
  FileText,
  Home,
  History,
  IndianRupee,
  Key,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  PackagePlus,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable/es'
import QRCode from 'qrcode'

export type Role = 'Admin' | 'Staff'
type Page =
  | 'Dashboard'
  | 'Tenants'
  | 'Rooms'
  | 'Payments'
  | 'Finance'
  | 'Inventory'
  | 'Maintenance'
  | 'Reports'
  | 'Settings'
type RoomType = 'Single' | 'Double' | 'Triple' | 'Suite' | 'Custom'
type RoomStatus = 'Occupied' | 'Vacant' | 'Maintenance'
type PaymentStatus = 'Paid' | 'Pending' | 'Overdue'
type RentLedgerStatus = PaymentStatus | 'Upcoming' | 'Clear'
type TenantStatus = 'Active' | 'Notice' | 'Needs Verification' | 'Left'
type EntryType = 'Credit' | 'Debit'
type InventoryCategory = 'Furniture' | 'Linen' | 'Kitchen' | 'Electrical' | 'Housekeeping'
type ExpenseCategory =
  | 'Grocery'
  | 'Vegetables'
  | 'Gas Cylinder'
  | 'Staff Salary'
  | 'Miscellaneous'
  | 'Inventory'
  | 'Maintenance'
type TicketStatus = 'Open' | 'In Progress' | 'Resolved'

export type Branch = { id: string; name: string; address: string; active?: boolean; floors?: number; notes?: string; contact?: string; maintenanceToken?: string }
export type User = { id: string; name: string; role: Role; branchIds: string[]; permissions: string[]; phone?: string; email?: string; username?: string; password?: string; active?: boolean }
export type Room = {
  id: string
  branchId: string
  number: string
  floor: number
  type: RoomType
  beds: number
  rent: number
  electricity: 'Included' | 'Fixed'
  electricityAmount: number
  status: RoomStatus
  notes?: string
}
export type Tenant = {
  id: string
  branchId: string
  name: string
  phone: string
  email: string
  roomId: string
  bedNo: number
  monthlyRent: number
  security: number
  securityReceived: number
  securityBalance: number
  electricity: 'Included' | 'Fixed'
  electricityAmount: number
  joiningDate: string
  status: TenantStatus
  idProof: string
  paidThisMonth: number
  dueDate: string
  notice?: { noticeDate: string; expectedLeavingDate: string; reason: string }
  rejoins?: Array<{
    rejoinDate: string
    dueDate: string
    roomId: string
    monthlyRent: number
    initialRentReceived: number
    paymentDate?: string
    paymentMode?: string
    previousLeft?: Tenant['left']
  }>
  left?: {
    leftDate: string
    reason: string
    finalRentBalance: number
    electricityBalance: number
    maintenanceDeduction: number
    securityRefund: number
    finalSettlement: number
    extraDays?: number
    extraRentCharge?: number
    alreadyReceived?: number
    balanceBeforeSettlement?: number
    settlementReceived?: number
  }
}
export type Payment = {
  id: string
  branchId: string
  tenantId: string
  amount: number
  date: string
  month: string
  status: 'Received' | 'Partial'
  invoiceId: string
  paymentType: 'Rent' | 'Security Deposit' | 'Electricity' | 'Other'
  paymentMode: string
  description: string
}
export type Category = {
  id: string
  branchId: string
  name: string
}
export type CashbookEntry = {
  id: string
  branchId: string
  type: EntryType
  amount: number
  description: string
  date: string
  source: 'Manual' | 'Payment' | 'Expense' | 'Inventory' | 'Maintenance' | 'Cashbook Import'
  linkedId?: string
  category?: string
  categoryId?: string
  paymentMode?: string
  reference?: string
  remarks?: string
  createdAt?: string
}
type CashbookFormEntry = Omit<CashbookEntry, 'id' | 'branchId' | 'source' | 'linkedId'>
const parseInterBranchReference = (reference?: string) => {
  const match = reference?.match(/^(IBR|IBS)\|([^|]+)\|([0-9.]+)$/)
  return match ? { kind: match[1] as 'IBR' | 'IBS', counterpartyBranchId: match[2], amount: Number(match[3]) } : undefined
}
const parsePartnerReference = (reference?: string) => {
  const match = reference?.match(/^PTL\|(.+)$/)
  return match ? decodeURIComponent(match[1]) : undefined
}
export type PaymentObligation = { id: string; branchId: string; tenantId: string; period: string; paymentType: 'Rent' | 'Security Deposit' | 'Electricity' | 'Other'; agreed: number; received: number; advanceApplied: number; dueDate?: string; status: 'Paid' | 'Partial' | 'Pending' | 'Overdue' }
export type SecurityMovement = { id: string; branchId: string; tenantId: string; type: 'agreed' | 'received' | 'refunded' | 'deducted'; amount: number; date: string; reason?: string }
export type AdvanceMovement = { id: string; branchId: string; tenantId: string; type: 'credit' | 'used' | 'refund'; amount: number; date: string; period?: string; description?: string }
export type Expense = {
  id: string
  branchId: string
  category: ExpenseCategory
  categoryId?: string
  description: string
  amount: number
  date: string
  vendor?: string
  cashbookId?: string
  ticketId?: string
}
export type InventoryItem = {
  id: string
  branchId: string
  name: string
  category: InventoryCategory
  stock: number
  unit: string
  reorderAt: number
  lastPurchase: string
}
export type InventoryPurchase = {
  id: string
  branchId: string
  itemId: string
  quantity: number
  unitCost: number
  date: string
  note: string
  expenseId?: string
  cashbookId?: string
}
export type MaintenanceTicket = {
  id: string
  branchId: string
  title: string
  status: TicketStatus
  roomId: string
  tenantId?: string
  category: string
  priority: 'Low' | 'Medium' | 'High'
  raisedDate: string
  assignedTo: string
  description: string
  ticketNumber?: string
  resolution?: { date: string; note: string; cost: number; vendor: string }
}
export type Invoice = {
  id: string
  branchId: string
  tenantId: string
  number: string
  period: string
  createdAt: string
}
export type ActivityLog = {
  id: string
  branchId: string
  userId: string
  action: string
  entity: string
  at: string
  oldValue: string
  newValue: string
  role: Role
  branchName: string
  module: string
  actionType: string
  description: string
  metadata?: Record<string, string | number>
  userName: string
}
export type AppData = {
  branches: Branch[]
  users: User[]
  tenants: Tenant[]
  rooms: Room[]
  payments: Payment[]
  cashbook: CashbookEntry[]
  expenses: Expense[]
  inventory: InventoryItem[]
  purchases: InventoryPurchase[]
  tickets: MaintenanceTicket[]
  invoices: Invoice[]
  activityLogs: ActivityLog[]
  obligations: PaymentObligation[]
  securityLedger: SecurityMovement[]
  advances: AdvanceMovement[]
  categories: Category[]
}
const emptyAppData = (): AppData => ({ branches: [], users: [], tenants: [], rooms: [], payments: [], cashbook: [], expenses: [], inventory: [], purchases: [], tickets: [], invoices: [], activityLogs: [], obligations: [], securityLedger: [], advances: [], categories: [] })

const localDateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = localDateValue(new Date())
const currentMonth = today.slice(0, 7)
const money = (value: number) => `₹${value.toLocaleString('en-IN')}`
const formatDate = (value?: string) => value ? value.slice(0, 10).split('-').reverse().join('/') : '-'
const formatMonth = (value?: string) => {
  const match = value?.match(/^(\d{4})-(\d{2})$/)
  if (!match) return 'No entries'
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return 'No entries'
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}
const formatDateTime = (value: string) => {
  if (!value) return '...'
  const d = new Date(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
}
const uid = (_prefix: string) => crypto.randomUUID()
const daysUntil = (date: string) =>
  Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
const vacateDueDays = (expectedLeavingDate: string) =>
  Math.ceil((new Date(`${today}T00:00:00`).getTime() - new Date(`${expectedLeavingDate}T00:00:00`).getTime()) / 86400000)
const currentMonthRentDueDate = (dueDate: string, reference = today) => {
  const dueDay = new Date(`${dueDate}T00:00:00`).getDate()
  const current = new Date(`${reference}T00:00:00`)
  const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate()
  return localDateValue(new Date(current.getFullYear(), current.getMonth(), Math.min(dueDay, lastDay)))
}
const rentDueDateForPeriod = (dueDate: string, period: string) => {
  const dueDay = new Date(`${dueDate}T00:00:00`).getDate()
  const [year, month] = period.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return localDateValue(new Date(year, month - 1, Math.min(dueDay, lastDay)))
}
const nextPeriod = (period: string) => {
  const [year, month] = period.split('-').map(Number)
  const date = new Date(year, month, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
const periodsBetween = (start: string, end: string) => {
  const periods: string[] = []
  for (let period = start; period <= end; period = nextPeriod(period)) periods.push(period)
  return periods
}
function getRentLedgerState(tenant: Tenant, payments: Payment[], obligations: PaymentObligation[] = []) {
  const rentObligations = new Map<string, PaymentObligation>()
  for (const item of obligations) if (item.tenantId === tenant.id && item.paymentType === 'Rent') rentObligations.set(item.period, item)
  const rentPayments = new Map<string, number>()
  for (const payment of payments) {
    if (payment.tenantId !== tenant.id || payment.paymentType !== 'Rent') continue
    rentPayments.set(payment.month, (rentPayments.get(payment.month) || 0) + payment.amount)
  }
  const currentStay = tenant.rejoins?.at(-1)
  const cycleStartDate = currentStay?.rejoinDate || tenant.joiningDate
  const dueAnchor = tenant.dueDate || currentStay?.dueDate || cycleStartDate
  const joiningMonth = cycleStartDate.slice(0, 7)
  const importedPaidMonths = new Set(importedRentPaidMonths[tenant.name.trim().toUpperCase()] || [])
  for (const period of periodsBetween(joiningMonth, currentMonth)) {
    const obligation = rentObligations.get(period)
    const recordedPayments = rentPayments.get(period) || 0
    const agreed = obligation?.agreed ?? tenant.monthlyRent
    const received = Math.max(obligation?.received ?? 0, recordedPayments, importedPaidMonths.has(period) ? agreed : 0)
    const advanceApplied = obligation?.advanceApplied ?? 0
    const pending = Math.max(0, agreed - received - advanceApplied)
    if (pending > 0) {
      const originalDueDate = obligation?.dueDate || rentDueDateForPeriod(dueAnchor, period)
      const hasPartialPayment = received + advanceApplied > 0
      const dueDate = originalDueDate
      const status: RentLedgerStatus = hasPartialPayment ? 'Pending' : originalDueDate < today ? 'Overdue' : originalDueDate === today ? 'Pending' : daysUntil(originalDueDate) <= 3 ? 'Upcoming' : 'Clear'
      return { period, paidThroughMonth: period === joiningMonth ? '-' : periodsBetween(joiningMonth, period).slice(-2, -1)[0] || '-', dueDate, agreed, received, advanceApplied, pending, status }
    }
  }
  const period = nextPeriod(currentMonth)
  const dueDate = rentDueDateForPeriod(dueAnchor, period)
  return { period, paidThroughMonth: currentMonth, dueDate, agreed: tenant.monthlyRent, received: 0, advanceApplied: 0, pending: 0, status: (daysUntil(dueDate) <= 3 ? 'Upcoming' : 'Clear') as RentLedgerStatus }
}

function getCalculatedRentDueDate(tenant: Tenant, payments: Payment[], obligations: PaymentObligation[] = []) {
  return getRentLedgerState(tenant, payments, obligations).dueDate
}

const rentLedgerState = (tenant: Tenant, obligations: PaymentObligation[], payments: Payment[]) =>
  getRentLedgerState(tenant, payments, obligations)

function logActivity(data: AppData, input: { userName: string; userId: string; userRole: Role; branchId: string; branchName: string; module: string; actionType: string; description: string; metadata?: Record<string, string | number> }): AppData {
  const log: ActivityLog = {
    id: uid('log'), branchId: input.branchId, branchName: input.branchName, userId: input.userId, role: input.userRole,
    action: input.actionType, entity: input.module, module: input.module, actionType: input.actionType, userName: input.userName,
    description: input.description, metadata: input.metadata, at: new Date().toISOString(), oldValue: '', newValue: '',
  }
  return { ...data, activityLogs: [log, ...data.activityLogs].slice(0, 1000) }
}


function getTenantDue(tenant: Tenant) {
  return tenant.monthlyRent
}

function paymentTotal(payments: Payment[], type?: Payment['paymentType'], tenantId?: string, month: string | null = currentMonth) {
  return payments.filter((payment) => (!month || payment.date.slice(0, 7) === month) && (!type || payment.paymentType === type) && (!tenantId || payment.tenantId === tenantId)).reduce((sum, payment) => sum + payment.amount, 0)
}

function getPaymentStatus(tenant: Tenant): PaymentStatus {
  const balance = Math.max(0, getTenantDue(tenant) - tenant.paidThisMonth)
  if (balance === 0) return 'Paid'
  return daysUntil(currentMonthRentDueDate(tenant.dueDate)) < 0 ? 'Overdue' : 'Pending'
}

function branchData(data: AppData, branchId: string) {
  const activeTenants = data.tenants.filter((tenant) => tenant.branchId === branchId && tenant.status !== 'Left')
  const leftTenants = data.tenants.filter((tenant) => tenant.branchId === branchId && tenant.status === 'Left')
  const rooms = data.rooms.filter((room) => room.branchId === branchId)
  const payments = data.payments.filter((payment) => payment.branchId === branchId)
  const obligations = data.obligations.filter((item) => item.branchId === branchId)
  const securityLedger = data.securityLedger.filter((item) => item.branchId === branchId)
  const advances = data.advances.filter((item) => item.branchId === branchId)
  const cashbook = data.cashbook.filter((entry) => entry.branchId === branchId).sort((a, b) => a.date.localeCompare(b.date))
  const expenses = data.expenses.filter((expense) => expense.branchId === branchId).sort((a, b) => b.date.localeCompare(a.date))
  const inventory = data.inventory.filter((item) => item.branchId === branchId)
  const purchases = data.purchases.filter((purchase) => purchase.branchId === branchId)
  const tickets = data.tickets.filter((ticket) => ticket.branchId === branchId)
  const activityLogs = data.activityLogs.filter((log) => log.branchId === branchId)
  const occupiedBeds = activeTenants.length
  const totalBeds = rooms.reduce((sum, room) => sum + room.beds, 0)
  const availableMonths = [...new Set(cashbook.map((entry) => entry.date.slice(0, 7)))].sort()
  const reportingMonth = availableMonths.includes(currentMonth) ? currentMonth : availableMonths.at(-1) || currentMonth
  const monthEntries = cashbook.filter((entry) => entry.date.startsWith(reportingMonth))
  const openingBalance = cashbook.filter((entry) => entry.date < `${reportingMonth}-01`).reduce((sum, entry) => sum + (entry.type === 'Credit' ? entry.amount : -entry.amount), 0)
  const revenue = monthEntries.filter((entry) => entry.type === 'Credit').reduce((sum, entry) => sum + entry.amount, 0)
  const expensesTotal = monthEntries.filter((entry) => entry.type === 'Debit').reduce((sum, entry) => sum + entry.amount, 0)
  const netMovement = revenue - expensesTotal
  const closingBalance = openingBalance + netMovement
  const cashBalance = cashbook.reduce((sum, entry) => sum + (entry.type === 'Credit' ? entry.amount : -entry.amount), 0)
  const expected = activeTenants.reduce((sum, tenant) => sum + getTenantDue(tenant), 0)
  const paymentsByTenant = new Map<string, Payment[]>()
  for (const payment of payments) {
    const tenantPayments = paymentsByTenant.get(payment.tenantId)
    if (tenantPayments) tenantPayments.push(payment)
    else paymentsByTenant.set(payment.tenantId, [payment])
  }
  const obligationsByTenant = new Map<string, PaymentObligation[]>()
  for (const obligation of obligations) {
    const tenantObligations = obligationsByTenant.get(obligation.tenantId)
    if (tenantObligations) tenantObligations.push(obligation)
    else obligationsByTenant.set(obligation.tenantId, [obligation])
  }
  const rentStates = new Map(activeTenants.map((tenant) => [tenant.id, getRentLedgerState(tenant, paymentsByTenant.get(tenant.id) || [], obligationsByTenant.get(tenant.id) || [])]))
  const overdue = activeTenants.reduce((sum, tenant) => rentStates.get(tenant.id)?.status === 'Overdue' ? sum + (rentStates.get(tenant.id)?.pending || 0) : sum, 0)
  const pending = activeTenants.reduce((sum, tenant) => {
    const state = rentStates.get(tenant.id)
    if (!state || (state.status !== 'Pending' && state.status !== 'Overdue')) return sum
    return sum + state.pending
  }, 0)
  const openTickets = tickets.filter((ticket) => ticket.status !== 'Resolved')
  const obligationPending = (type: PaymentObligation['paymentType']) => obligations.filter((item) => item.paymentType === type && item.period === (type === 'Security Deposit' ? 'one-time' : currentMonth)).reduce((sum, item) => sum + Math.max(0, item.agreed - item.received - item.advanceApplied), 0)
  const advanceBalance = advances.reduce((sum, item) => sum + (item.type === 'credit' ? item.amount : -item.amount), 0)

  return {
    activeTenants,
    leftTenants,
    rooms,
    payments,
    obligations,
    securityLedger,
    advances,
    rentStates,
    cashbook,
    expenses,
    inventory,
    purchases,
    tickets,
    activityLogs,
    occupiedBeds,
    totalBeds,
    occupancyRate: totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
    revenue,
    expensesTotal,
    net: netMovement,
    reportingMonth,
    openingBalance,
    netMovement,
    closingBalance,
    cashBalance,
    expected,
    overdue,
    pending,
    openTickets,
    pendingRent: pending,
    pendingSecurity: obligationPending('Security Deposit'),
    advanceBalance,
  }
}

function Button({ children, onClick, tone = 'blue', type = 'button', disabled = false }: { children: ReactNode; onClick?: () => void; tone?: 'blue' | 'green' | 'dark' | 'red' | 'soft'; type?: 'button' | 'submit'; disabled?: boolean }) {
  const tones = {
    blue: 'bg-blue-600 text-white hover:bg-blue-700',
    green: 'bg-emerald-600 text-white hover:bg-emerald-700',
    dark: 'bg-slate-900 text-white hover:bg-slate-800',
    red: 'bg-rose-600 text-white hover:bg-rose-700',
    soft: 'bg-white text-slate-700 border border-slate-400 hover:bg-slate-50',
  }
  return <button disabled={disabled} type={type} onClick={onClick} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}>{children}</button>
}

function CompactAction({ children, title, onClick, disabled = false, danger = false }: { children: ReactNode; title: string; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className={`grid h-8 w-8 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-35 ${danger ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{children}</button>
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-slate-400 bg-white p-4 shadow-sm ${className}`}>{children}</section>
}

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'green' | 'red' | 'orange' | 'blue' | 'slate' }) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-rose-100 text-rose-700',
    orange: 'bg-orange-100 text-orange-700',
    blue: 'bg-blue-100 text-blue-700',
    slate: 'bg-slate-100 text-slate-700',
  }
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className={`max-h-[92vh] w-full ${wide ? 'max-w-6xl' : 'max-w-2xl'} overflow-auto rounded-lg bg-white p-5 shadow-2xl`}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button aria-label="Go back" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"><ChevronLeft size={20} /></button>
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          </div>
          <button aria-label="Close modal" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm font-semibold text-slate-700">{label}{children}</label>
}

const inputClass = 'min-h-10 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

function LoadingScreen({ label }: { label: string }) {
  return <main className="grid min-h-screen place-items-center bg-[#f7f3ec]"><div className="text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" /><p className="mt-4 font-semibold text-slate-600">{label}</p></div></main>
}

function SetupScreen({ message }: { message: string }) {
  return <main className="grid min-h-screen place-items-center bg-[#f7f3ec] p-4"><Card className="max-w-lg"><h1 className="text-xl font-black">Supabase setup required</h1><p className="mt-2 text-sm text-slate-600">{message}</p><p className="mt-3 text-sm">Run the migration in <b>supabase/migrations</b>, create the owner Auth user, and promote it with <b>supabase/seed-admin.sql</b>.</p><Button tone="soft" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign Out</Button></Card></main>
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <main className="grid min-h-screen place-items-center bg-[#f7f3ec] p-4"><Card className="w-full max-w-md"><div className="mb-6 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-md bg-blue-600 text-lg font-black text-white">95</div><div><h1 className="text-2xl font-black">PG Admin Portal</h1><p className="text-sm text-slate-500">Admin and staff sign in</p></div></div><form className="grid gap-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); const loginEmail = email.includes('@') ? email : `${email}@staff.pg95.local`; const result = await supabase.auth.signInWithPassword({ email: loginEmail, password }); if (result.error) setError(result.error.message); setBusy(false) }}><Field label="Email or username"><input className={inputClass} required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></Field><Field label="Password"><input className={inputClass} type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>{error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign In'}</Button></form></Card></main>
}

function App() {
  const [data, setData] = useState<AppData>(emptyAppData)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [backendError, setBackendError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [branchId, setBranchId] = useState<string>('')
  const [page, setPage] = useState<Page>('Dashboard')
  const [role, setRole] = useState<Role>('Admin')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<string>('')
  const [mobileNav, setMobileNav] = useState(false)
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [selectedCashbookId, setSelectedCashbookId] = useState('')
  const [selectedInventoryId, setSelectedInventoryId] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedTicketId, setSelectedTicketId] = useState('')
  const [financeTab, setFinanceTab] = useState('Cashbook')
  const [tenantTab, setTenantTab] = useState<'Active' | 'Left PG'>('Active')
  const [tenantFilter, setTenantFilter] = useState('All')
  const [roomFloor, setRoomFloor] = useState('All Floors')
  const [paymentFilter, setPaymentFilter] = useState('All')
  const [inventoryFilter, setInventoryFilter] = useState('All')
  const [ticketFilter, setTicketFilter] = useState('All')
  const [reportRange, setReportRange] = useState('Monthly Summary')
  const [rentSummary, setRentSummary] = useState<RentCollectionSummary | null>(null)
  const persistenceQueue = useRef(Promise.resolve())
  const dataRef = useRef(data)
  const isPopStateRef = useRef(false)
  const initializedRef = useRef(false)
  const currentModalRef = useRef('')
  const historyDepthRef = useRef(0)
  currentModalRef.current = modal

  const openModal = (name: string) => {
    setModal(name)
    window.history.pushState({ __app: true, page, modal: name }, '')
  }

  const closeModal = () => {
    const hadModal = currentModalRef.current
    currentModalRef.current = ''
    setModal('')
    if (hadModal) {
      window.history.back()
    }
  }
  const currentUser: User = data.users.find((user) => user.id === session?.user.id) || { id: session?.user.id || '', name: session?.user.user_metadata?.name || 'User', role, branchIds: [], permissions: [] }
  const isAdmin = role === 'Admin'
  const can = (permission: string) => isAdmin || currentUser.permissions.includes(permission)
  const branch = data.branches.find((item) => item.id === branchId && (isAdmin || currentUser.branchIds.includes(item.id)))
  const scoped = useMemo(() => branch ? branchData(data, branch.id) : undefined, [data, branch])
  const visibleBranches = data.branches.filter((item) => item.active !== false && (isAdmin || currentUser.branchIds.includes(item.id)))

  useEffect(() => {
    supabase.auth.getSession().then(({ data: result }) => { setSession(result.session); setAuthLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') Object.keys(sessionStorage).filter((key) => key.startsWith('pg95-login:')).forEach((key) => sessionStorage.removeItem(key))
      setSession(next); setAuthLoading(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setData(emptyAppData()); return }
    setDataLoading(true); setBackendError('')
    loadAppData().then(async (next) => { const profile = next.users.find((user) => user.id === session.user.id); if (profile) setRole(profile.role); const loginBranch = next.branches.find((item) => profile?.role === 'Admin' || profile?.branchIds.includes(item.id)); const loginKey = `pg95-login:${session.user.id}`; const shouldLogLogin = sessionStorage.getItem(loginKey) !== '1'; const logged = profile && loginBranch && shouldLogLogin ? logActivity(next, { userName: profile.name, userId: profile.id, userRole: profile.role, branchId: loginBranch.id, branchName: loginBranch.name, module: 'Authentication', actionType: 'Login', description: `${profile.role} ${profile.name} logged in.` }) : next; dataRef.current = logged; setData(logged); if (logged !== next) { await persistAppData(next, logged, session.user.id); sessionStorage.setItem(loginKey, '1') }; const cleanupKey = 'pg95-last-cleanup'; const lastCleanup = localStorage.getItem(cleanupKey); const todayStr = new Date().toISOString().slice(0, 10); if (lastCleanup !== todayStr) { cleanupOldActivityLogs().catch(() => {}); localStorage.setItem(cleanupKey, todayStr) } }).catch((error) => setBackendError(error instanceof Error ? error.message : 'Unable to load Supabase data')).finally(() => setDataLoading(false))
  }, [session])

  useEffect(() => {
    if (branchId && !isAdmin && !currentUser.branchIds.includes(branchId)) setBranchId('')
  }, [branchId, currentUser.branchIds, isAdmin])

  useEffect(() => { dataRef.current = data }, [data])

  const refreshRentSummary = useCallback(() => {
    if (!branchId) { setRentSummary(null); return }
    getBranchRentCollectionSummary(branchId).then(setRentSummary).catch(() => setRentSummary(null))
  }, [branchId])

  useEffect(() => { refreshRentSummary() }, [refreshRentSummary])

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      window.history.replaceState({ __app: true, page, modal: '' }, '')
      return
    }
    if (!isPopStateRef.current) {
      window.history.pushState({ __app: true, page, modal: '' }, '')
      historyDepthRef.current++
    } else {
      isPopStateRef.current = false
    }
  }, [page])

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state?.__app) return
      if (currentModalRef.current) {
        currentModalRef.current = ''
        setModal('')
        return
      }
      historyDepthRef.current = Math.max(0, historyDepthRef.current - 1)
      isPopStateRef.current = true
      setPage(e.state.page || 'Dashboard')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const refreshRoomStatuses = (next: AppData): AppData => {
    const occupiedByRoom = new Map<string, number>()
    for (const tenant of next.tenants) {
      if (tenant.status === 'Left') continue
      occupiedByRoom.set(tenant.roomId, (occupiedByRoom.get(tenant.roomId) || 0) + 1)
    }
    return {
      ...next,
      rooms: next.rooms.map((room) => room.status === 'Maintenance'
        ? room
        : { ...room, status: (occupiedByRoom.get(room.id) || 0) >= room.beds ? 'Occupied' : 'Vacant' }),
    }
  }

  const updateData = (updater: (previous: AppData) => AppData, action: string, entity: string, description?: string, metadata?: Record<string, string | number>) => {
    if (!isAdmin && /^(edit|delete)/i.test(action)) return
    const previous = dataRef.current
    const next = refreshRoomStatuses(updater(previous))
    const logged = logActivity(next, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch?.name || '', module: entity, actionType: action, description: description || `${currentUser.role} ${currentUser.name} performed ${action.toLowerCase()} in ${entity}.`, metadata })
    dataRef.current = logged
    setData(logged)
    persistenceQueue.current = persistenceQueue.current
      .then(() => persistAppData(previous, logged, currentUser.id))
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Unable to save. Please try again.'
        console.error('updateData persistence failed:', error)
        setBackendError(message)
        try { const refreshed = await loadAppData(); dataRef.current = refreshed; setData(refreshed) } catch { /* Keep the optimistic state when reconciliation is unavailable. */ }
      })
  }

  const addBranchData = (nextBranch: Omit<Branch, 'id' | 'active'>) => {
    const id = uid('b')
    const previous = dataRef.current
    const next = logActivity({ ...previous, branches: [...previous.branches, { id, active: true, ...nextBranch }] }, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId: id, branchName: nextBranch.name, module: 'Branches', actionType: 'Add Branch', description: `${role} ${currentUser.name} added new branch ${nextBranch.name}.` })
    dataRef.current = next
    setData(next)
    persistenceQueue.current = persistenceQueue.current
      .then(() => persistAppData(previous, next, currentUser.id))
      .catch(async (error) => {
        setBackendError(error instanceof Error ? error.message : 'Unable to add branch. Please try again.')
        try { const refreshed = await loadAppData(); dataRef.current = refreshed; setData(refreshed) } catch { /* Keep the optimistic state when reconciliation is unavailable. */ }
      })
    closeModal()
  }

  if (authLoading) return <LoadingScreen label="Checking your session..." />
  if (!supabaseConfigured) return <SetupScreen message="Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to continue." />
  if (!session) return <LoginPage />
  if (dataLoading) return <LoadingScreen label="Loading PG data..." />
  if (backendError && !data.branches.length) return <SetupScreen message={backendError} />

  if (!branchId) {
    return (
      <main className="min-h-screen bg-[#f7f3ec] px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 text-center">
            <h1 className="text-4xl font-black text-slate-950">PG Admin Portal</h1>
            <p className="mt-2 text-lg text-slate-600">Select a branch to continue</p>
            <div className="mt-4 flex justify-center gap-2"><Button tone="soft" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign Out</Button>{isAdmin && <Button tone="blue" onClick={() => openModal('addBranch')}><Plus size={16} /> Add Branch</Button>}</div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {visibleBranches.map((item) => {
              const stats = branchData(data, item.id)
              return (
                <button key={item.id} onClick={() => { setBranchId(item.id); setPage('Dashboard') }} className="rounded-lg border border-slate-400 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md">
                  <Building2 className="mb-4 text-blue-600" size={30} />
                  <h2 className="text-xl font-bold text-slate-950">{item.name}</h2>
                  <p className="mt-1 min-h-12 text-sm text-slate-500">{item.address}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">Total tenants</p><p className="text-2xl font-bold">{stats.activeTenants.length}</p></div>
                    <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">Total rooms</p><p className="text-2xl font-bold">{stats.rooms.length}</p></div>
                  </div>
                </button>
              )
            })}
          </div>
          {!visibleBranches.length && <Card className="mt-4 text-center"><Building2 className="mx-auto text-slate-400" /><p className="mt-2 font-semibold">{isAdmin ? 'No active branches yet. Add your first branch to begin.' : 'No branches are assigned to your staff account.'}</p></Card>}
          {isAdmin && data.branches.some((item) => item.active === false) && <p className="mt-6 text-center text-sm text-slate-500">Deactivated branches can be restored from Settings.</p>}
        </div>
        {modal === 'addBranch' && <CreateBranchModal onClose={closeModal} onSubmit={addBranchData} />}
      </main>
    )
  }

  if (!branch || !scoped) return null

  const searchPool = [
    `${branch.name} ${branch.address}`,
    ...[...scoped.activeTenants, ...scoped.leftTenants].map((tenant) => `${tenant.name} ${tenant.phone} ${tenant.email} Room ${data.rooms.find((room) => room.id === tenant.roomId)?.number} Bed ${tenant.bedNo} ${tenant.status}`),
    ...scoped.payments.map((payment) => `${payment.paymentType} ${payment.amount} ${payment.paymentMode} ${payment.description}`),
    ...scoped.cashbook.map((entry) => `${entry.description} ${entry.category} ${entry.reference} ${entry.amount}`),
    ...scoped.inventory.map((item) => `${item.name} ${item.category}`),
    ...scoped.tickets.map((ticket) => `${ticket.title} ${ticket.category}`),
    ...data.invoices.filter((invoice) => invoice.branchId === branchId).map((invoice) => invoice.number),
    ...scoped.activityLogs.map((log) => `${log.userName} ${log.module} ${log.actionType} ${log.description}`),
  ]
  const searchHits = query ? searchPool.filter((item) => item.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : []
  const notifications = [
    ...scoped.activeTenants.filter((tenant) => { const state = scoped.rentStates.get(tenant.id); return state && state.pending > 0 && daysUntil(state.dueDate) <= 3 }).map((tenant) => `${tenant.name}: rent ${scoped.rentStates.get(tenant.id)?.status === 'Overdue' ? 'overdue' : 'due soon'}`),
    ...scoped.openTickets.map((ticket) => `Open maintenance: ${ticket.title}`),
    ...scoped.activeTenants.filter((tenant) => tenant.notice?.expectedLeavingDate && today >= tenant.notice.expectedLeavingDate).map((tenant) => { const days = vacateDueDays(tenant.notice!.expectedLeavingDate); return `${tenant.name}: VACATE ${days === 0 ? 'DUE TODAY' : `OVERDUE ${days} DAY${days !== 1 ? 'S' : ''}`}` }),
    ...scoped.activeTenants.filter((tenant) => tenant.status === 'Notice' && (!tenant.notice?.expectedLeavingDate || today < tenant.notice.expectedLeavingDate)).map((tenant) => `Vacating notice: ${tenant.name}`),
  ]

  const nav = ([
    { label: 'Switch Branch', icon: <ChevronLeft size={18} /> },
    { label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { label: 'Tenants', icon: <Users size={18} /> },
    { label: 'Rooms', icon: <Home size={18} /> },
    { label: 'Payments', icon: <ReceiptText size={18} /> },
    { label: 'Finance', icon: <CircleDollarSign size={18} /> },
    { label: 'Inventory', icon: <Boxes size={18} /> },
    { label: 'Maintenance', icon: <Wrench size={18} /> },
    { label: 'Reports', icon: <FileBarChart size={18} /> },
    { label: 'Settings', icon: <Settings size={18} /> },
    { label: 'Sign Out', icon: <LogOut size={18} /> },
  ] as { label: Page | 'Switch Branch' | 'Sign Out'; icon: ReactNode }[]).filter((item) => (isAdmin || item.label !== 'Settings') && (item.label !== 'Reports' || can('view_reports')))
  const handleNav = (label: Page | 'Switch Branch' | 'Sign Out') => {
    setMobileNav(false)
    if (label === 'Sign Out') {
      const previous = dataRef.current
      const logged = logActivity(previous, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch?.name || '', module: 'Authentication', actionType: 'Logout', description: `${role} ${currentUser.name} signed out from ${branch?.name || 'PG Admin Portal'}.` })
      dataRef.current = logged
      setData(logged)
      persistenceQueue.current = persistenceQueue.current
        .then(async () => { await persistAppData(previous, logged, currentUser.id); try { const refreshedLogs = await loadActivityLogs(); const refreshed = { ...logged, activityLogs: refreshedLogs }; dataRef.current = refreshed; setData(refreshed) } catch {} })
        .catch(() => {})
      void supabase.auth.signOut()
      setBranchId('')
      return
    }
    if (label === 'Switch Branch') {
      setBranchId('')
      return
    }
    setPage(label)
  }

  return (
    <div className="min-h-screen bg-[#f7f3ec] text-slate-900">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 bg-slate-950 p-4 text-white lg:block">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-blue-600 font-black">95</div>
          <div><p className="font-bold">PG 95 Admin</p><p className="text-xs text-slate-400">{branch.name}</p></div>
        </div>
        <nav className="grid gap-1">
          {nav.map((item) => (
            <button key={item.label} onClick={() => handleNav(item.label)} className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${page === item.label ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>
      </aside>
      {mobileNav && (
        <div className="no-print fixed inset-0 z-40 bg-slate-950/40 lg:hidden">
          <aside className="flex h-full w-72 flex-col bg-slate-950 text-white shadow-2xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex shrink-0 items-center justify-between gap-3 p-4">
              <div><p className="font-bold">PG 95 Admin</p><p className="text-xs text-slate-400">{branch.name}</p></div>
              <button aria-label="Close navigation" onClick={() => setMobileNav(false)} className="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-slate-800"><X size={20} /></button>
            </div>
            <nav className="grid gap-1 overflow-y-auto p-4 pt-0">
              {nav.map((item) => (
                <button key={item.label} onClick={() => handleNav(item.label)} className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${page === item.label ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                  {item.icon}{item.label}
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))', paddingBottom: '0.75rem' }}>
          <div className="flex flex-wrap items-center gap-2">
            <button aria-label="Open navigation" onClick={() => setMobileNav(true)} className="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-slate-100 lg:hidden"><Menu size={22} /></button>
            <div className="min-w-36 flex-1">
              <h1 className="text-xl font-black leading-tight sm:text-2xl">{page}</h1>
              <p className="truncate text-xs text-slate-500 sm:text-sm">{branch.name}</p>
            </div>
            <div className="order-last flex w-full flex-wrap items-center gap-2 sm:order-none sm:w-auto">
              {can('add_cashbook') && <Button tone="green" onClick={() => openModal('cashbook')}><Plus size={18} /> <span className="hidden sm:inline">Add Entry</span></Button>}
              {can('admit_tenant') && <Button tone="blue" onClick={() => openModal('admit')}><UserPlus size={18} /> <span className="hidden sm:inline">Admit Tenant</span></Button>}
              <div className="relative min-w-0 flex-1 sm:min-w-56 md:max-w-sm">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} w-full pl-10`} placeholder="Search..." />
                {searchHits.length > 0 && <div className="absolute mt-2 w-full rounded-md border border-slate-400 bg-white p-2 shadow-lg">{searchHits.map((hit) => <p key={hit} className="truncate rounded px-2 py-1 text-sm hover:bg-slate-50">{hit}</p>)}</div>}
              </div>
              <div className="relative">
                <button onClick={() => openModal('notifications')} className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-400 bg-white"><Bell size={20} />{notifications.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-xs font-bold text-white">{notifications.length}</span>}</button>
              </div>
              <button className="flex shrink-0 items-center gap-1 rounded-md border border-slate-400 bg-white px-2 py-2 text-xs font-bold sm:px-3 sm:text-sm"><ShieldCheck className="shrink-0" size={16} /> <span className="hidden sm:inline">{currentUser.name} · {role}</span></button>
            </div>
          </div>
        </header>

        <main className="p-3 lg:p-6" style={{ minHeight: 'calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))' }}>
          {successMessage && <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><span>{successMessage}</span><button aria-label="Dismiss" onClick={() => setSuccessMessage('')}><X size={16} /></button></div>}
          {backendError && <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{backendError}</span><button aria-label="Dismiss error" onClick={() => setBackendError('')}><X size={16} /></button></div>}
          {page === 'Dashboard' && <Dashboard scoped={scoped} rentSummary={rentSummary} refreshRentSummary={refreshRentSummary} setModal={openModal} setPage={setPage} setTenantTab={setTenantTab} setTenantFilter={setTenantFilter} setRoomFloor={setRoomFloor} setFinanceTab={setFinanceTab} setPaymentFilter={setPaymentFilter} setTicketFilter={setTicketFilter} />}
          {page === 'Tenants' && <TenantsPage key={branch?.id} data={data} scoped={scoped} tenantTab={tenantTab} setTenantTab={setTenantTab} filter={tenantFilter} setFilter={setTenantFilter} setModal={openModal} setSelectedTenantId={setSelectedTenantId} isAdmin={isAdmin} canAction={can} />}
          {page === 'Rooms' && <RoomsPage scoped={scoped} roomFloor={roomFloor} setRoomFloor={setRoomFloor} setSelectedRoomId={setSelectedRoomId} setModal={openModal} isAdmin={isAdmin} />}
          {page === 'Payments' && <PaymentsPage data={data} scoped={scoped} filter={paymentFilter} setFilter={setPaymentFilter} setModal={openModal} setSelectedTenantId={setSelectedTenantId} canAdd={can('add_payment')} />}
          {page === 'Finance' && <FinancePage scoped={scoped} financeTab={financeTab} setFinanceTab={setFinanceTab} data={data} branch={branch} setModal={openModal} setSelectedTenantId={setSelectedTenantId} setSelectedCashbookId={setSelectedCashbookId} updateData={updateData} role={role} currentUser={currentUser} isAdmin={isAdmin} />}
          {page === 'Inventory' && <InventoryPage scoped={scoped} filter={inventoryFilter} setFilter={setInventoryFilter} setModal={openModal} setSelectedInventoryId={setSelectedInventoryId} canAdd={can('add_inventory')} />}
          {page === 'Maintenance' && <MaintenancePage data={data} scoped={scoped} filter={ticketFilter} setFilter={setTicketFilter} setModal={openModal} setSelectedTicketId={setSelectedTicketId} canResolve={can('resolve_maintenance')} canCreate={can('create_maintenance')} branch={branch} />}
          {page === 'Reports' && <ReportsPage scoped={scoped} data={data} branch={branch} reportRange={reportRange} setReportRange={setReportRange} onExport={(type, format) => { const previous = dataRef.current; const logged = logActivity(previous, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch?.name || '', module: 'Report', actionType: 'Export', description: `${role} ${currentUser.name} exported ${type} as ${format} for ${branch?.name}.` }); dataRef.current = logged; setData(logged); persistenceQueue.current = persistenceQueue.current.then(() => persistAppData(previous, logged, currentUser.id)).catch(() => {}) }} />}
          {page === 'Settings' && isAdmin && <SettingsPage data={data} branch={branch} role={role} isAdmin={isAdmin} setModal={openModal} setSelectedUserId={setSelectedUserId} onDeactivateUser={async (user) => { try { await deactivateStaffAccount(user.id); const refreshed = await loadAppData(); const next = logActivity(refreshed, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch.name, module: 'Staff', actionType: 'Deactivate Staff', description: `${role} ${currentUser.name} deactivated staff ${user.name}.` }); await persistAppData(refreshed, next, currentUser.id); const refreshedLogs = await loadActivityLogs(); setData({ ...next, activityLogs: refreshedLogs }) } catch (error) { setBackendError(error instanceof Error ? error.message : 'Unable to deactivate staff') } }} onReactivateUser={async (user) => { try { await reactivateUserAccount(user.id); const refreshed = await loadAppData(); const next = logActivity(refreshed, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch.name, module: 'Staff', actionType: 'Reactivate Staff', description: `${role} ${currentUser.name} reactivated ${user.name}.` }); await persistAppData(refreshed, next, currentUser.id); const refreshedLogs = await loadActivityLogs(); setData({ ...next, activityLogs: refreshedLogs }) } catch (error) { setBackendError(error instanceof Error ? error.message : 'Unable to reactivate user') } }} onResetPassword={async (userId) => { setSelectedUserId(userId); openModal('resetPassword') }} onToggleBranch={(item, active) => updateData((previous) => ({ ...previous, branches: previous.branches.map((candidate) => candidate.id === item.id ? { ...candidate, active } : candidate) }), active ? 'Reactivate Branch' : 'Deactivate Branch', 'Branches', `${role} ${currentUser.name} ${active ? 'reactivated' : 'deactivated'} branch ${item.name}.`)} />}
        </main>
      </div>

      {modal === 'cashbook' && <CashbookModal branches={data.branches.filter((item) => item.active !== false)} branchId={branchId} categories={Array.from(new Set(scoped.cashbook.map((entry) => entry.category).filter((value): value is string => Boolean(value))))} onClose={closeModal} onSubmit={(entry) => { const interBranch = parseInterBranchReference(entry.reference); updateData((previous) => { const now = new Date().toISOString(); const cat = data.categories.find((c) => c.branchId === branchId && c.name === (entry.category || 'Uncategorized')); const primary = { id: uid('c'), branchId, source: 'Manual' as const, createdAt: now, categoryId: cat?.id, ...entry }; const mirror = interBranch?.kind === 'IBS' ? { id: uid('c'), branchId: interBranch.counterpartyBranchId, source: 'Manual' as const, type: 'Debit' as const, amount: interBranch.amount, description: `Inter-branch settlement paid to ${branch.name}`, date: entry.date, category: 'Inter-branch Settlement', paymentMode: entry.paymentMode, reference: `IBS|${branchId}|${interBranch.amount}`, remarks: entry.remarks, createdAt: now } : undefined; return { ...previous, cashbook: [primary, ...(mirror ? [mirror] : []), ...previous.cashbook] } }, entry.type === 'Credit' ? 'credit created' : 'debit created', 'Cashbook', `${role} ${currentUser.name} added cashbook ${entry.type.toLowerCase()} of ${money(entry.amount)}. Description: ${entry.description}.`, { amount: entry.amount, type: entry.type }) }} />}
      {modal === 'editCashbook' && <CashbookModal entry={data.cashbook.find((entry) => entry.id === selectedCashbookId)} branches={data.branches.filter((item) => item.active !== false)} branchId={branchId} categories={Array.from(new Set(scoped.cashbook.map((entry) => entry.category).filter((value): value is string => Boolean(value))))} onClose={closeModal} onSubmit={(entry) => { const old = data.cashbook.find((item) => item.id === selectedCashbookId)!; updateData((previous) => ({ ...previous, cashbook: previous.cashbook.map((item) => item.id === selectedCashbookId ? { ...item, ...entry } : item) }), 'Edit Entry', 'Cashbook', `${role} ${currentUser.name} edited cashbook entry ${old.description}. Amount changed from ${money(old.amount)} to ${money(entry.amount)}; type ${old.type} to ${entry.type}.`) }} />}
      {modal === 'admit' && <AdmitTenantModal rooms={scoped.rooms} tenants={scoped.activeTenants} canReceivePayment={can('add_payment')} onClose={closeModal} onSubmit={async (requestId, paymentRequestId, tenant, initialPayment) => {
        setBackendError('')
        try {
          const tenantId = await admitTenant({ requestId, branchId, ...tenant })
          if (initialPayment.rentAmount + initialPayment.securityAmount > 0) {
            await recordSplitPayment({
              requestId: paymentRequestId,
              tenantId,
              branchId,
              rentAmount: initialPayment.rentAmount,
              securityAmount: initialPayment.securityAmount,
              electricityAmount: 0,
              otherAmount: 0,
              paymentDate: initialPayment.paymentDate,
              rentPeriod: tenant.joiningDate.slice(0, 7),
              paymentMode: initialPayment.paymentMode,
              description: `Admission payment - ${tenant.name}`,
            })
          }
          setSuccessMessage('Tenant admitted successfully.')
          refreshRentSummary()
          try {
            const refreshedTenants = await refreshTables(getAffectedTables('admit'), dataRef.current)
            dataRef.current = refreshedTenants; setData(refreshedTenants)
          } catch {
            try { const full = await loadAppData(); dataRef.current = full; setData(full) } catch {}
          }
        }
        catch (error) { const message = error instanceof Error ? error.message : 'Tenant admission failed'; setBackendError(message); throw error }
      }} />}
      {modal === 'tenantLedger' && <TenantLedgerModal tenant={data.tenants.find((tenant) => tenant.id === selectedTenantId)!} data={data} onClose={closeModal} />}
      {modal === 'rejoinTenant' && <RejoinTenantModal tenant={data.tenants.find((tenant) => tenant.id === selectedTenantId)!} rooms={scoped.rooms} activeTenants={scoped.activeTenants} onClose={closeModal} onSubmit={async (payload) => {
        const tenant = data.tenants.find((item) => item.id === selectedTenantId)!
        const room = data.rooms.find((item) => item.id === payload.roomId)!
        const bedNo = data.tenants.filter((item) => item.roomId === payload.roomId && item.status !== 'Left').length + 1
        const rejoin = { rejoinDate: payload.rejoinDate, dueDate: payload.dueDate, roomId: payload.roomId, monthlyRent: payload.monthlyRent, initialRentReceived: payload.rentReceived, paymentDate: payload.paymentDate, paymentMode: payload.paymentMode, previousLeft: tenant.left }
        updateData((previous) => ({ ...previous, tenants: previous.tenants.map((item) => item.id === tenant.id ? { ...item, roomId: payload.roomId, bedNo, monthlyRent: payload.monthlyRent, dueDate: payload.dueDate, status: 'Active', left: undefined, notice: undefined, paidThisMonth: 0, rejoins: [...(item.rejoins || []), rejoin] } : item) }), 'Rejoin Tenant', 'Tenants', `${role} ${currentUser.name} rejoined tenant ${tenant.name} in Room ${room.number} on ${formatDate(payload.rejoinDate)} at rent ${money(payload.monthlyRent)}. Payment received at rejoin: ${money(payload.rentReceived)}.`)
        const saveRejoin = persistenceQueue.current.then(async () => {
          if (payload.rentReceived > 0) await recordSplitPayment({ requestId: payload.paymentRequestId, tenantId: tenant.id, branchId, rentAmount: payload.rentReceived, securityAmount: 0, electricityAmount: 0, otherAmount: 0, paymentDate: payload.paymentDate, rentPeriod: payload.rejoinDate.slice(0, 7), paymentMode: payload.paymentMode, description: `Rejoin rent payment - ${tenant.name}` })
          const refreshed = await loadAppData()
          dataRef.current = refreshed
          setData(refreshed)
        })
        persistenceQueue.current = saveRejoin.catch((error) => setBackendError(error instanceof Error ? error.message : 'Unable to rejoin tenant'))
        await saveRejoin
      }} />}
      {modal === 'payment' && <PaymentModal tenants={scoped.activeTenants} payments={scoped.payments} obligations={scoped.obligations} selectedTenantId={selectedTenantId} onClose={closeModal} onSubmit={async (payment) => {
        setBackendError('')
        try {
          await recordSplitPayment({ ...payment, branchId })
          const refreshedPayments = await refreshTables(getAffectedTables('payment'), dataRef.current)
          dataRef.current = refreshedPayments; setData(refreshedPayments)
          refreshRentSummary()
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Payment could not be saved.'
          console.error('Payment save failed:', error)
          setBackendError(message)
          throw error
        }
      }} />}
      {modal === 'notice' && <NoticeModal onClose={closeModal} onSubmit={(notice) => { const tenant = data.tenants.find((item) => item.id === selectedTenantId)!; updateData((previous) => ({ ...previous, tenants: previous.tenants.map((item) => item.id === selectedTenantId ? { ...item, status: 'Notice', notice } : item) }), 'Issue Tenant Notice', 'Tenants', `${role} ${currentUser.name} issued vacating notice to ${tenant.name} in Room ${data.rooms.find((room) => room.id === tenant.roomId)?.number}. Notice details: ${notice}.`) }} />}
      {modal === 'vacate' && (() => { const tenant = data.tenants.find((item) => item.id === selectedTenantId)!; const rentState = scoped.rentStates.get(tenant.id) || rentLedgerState(tenant, scoped.obligations, scoped.payments); return <VacateModal tenant={tenant} dueDate={rentState.dueDate} alreadyReceived={rentState.received} onClose={closeModal} onSubmit={async (left, settlementRequestId) => { setBackendError(''); try { if ((left.settlementReceived || 0) > 0) await recordSplitPayment({ requestId: settlementRequestId, tenantId: tenant.id, branchId, rentAmount: left.settlementReceived || 0, securityAmount: 0, electricityAmount: 0, otherAmount: 0, paymentDate: left.leftDate, rentPeriod: rentState.period, paymentMode: 'Cash', description: `Vacate settlement - ${tenant.name}` }); await vacateTenantErp(selectedTenantId, left); const refreshedVacate = await refreshTables(getAffectedTables('vacate'), dataRef.current); dataRef.current = refreshedVacate; setData(refreshedVacate); refreshRentSummary() } catch (error) { setBackendError(error instanceof Error ? error.message : 'Unable to vacate tenant'); throw error } }} /> })()}
      {modal === 'confirmUndoVacate' && <ConfirmModal title="Undo tenant vacate" message="Restore this tenant to the original room and reverse any security refund or deduction created during vacating? Payment history will remain unchanged." confirmLabel="Undo Vacate" onClose={closeModal} onConfirm={async () => { setBackendError(''); try { await undoVacateTenant(selectedTenantId); const refreshedUndo = await refreshTables(getAffectedTables('vacate'), dataRef.current); dataRef.current = refreshedUndo; setData(refreshedUndo); refreshRentSummary() } catch (error) { const message = error instanceof Error ? error.message : 'Unable to undo tenant vacate'; setBackendError(message); throw error } }} />}
      {modal === 'editTenant' && (() => {
        const tenant = data.tenants.find((item) => item.id === selectedTenantId)!
        const rentState = scoped.rentStates.get(tenant.id) || rentLedgerState(tenant, scoped.obligations, scoped.payments)
        return <EditTenantModal tenant={tenant} rentState={rentState} rooms={scoped.rooms} tenants={scoped.activeTenants} onClose={closeModal} onSubmit={async (changes) => {
          setBackendError('')
          try {
            await editTenantWithRentAdjustment({ tenantId: tenant.id, ...changes })
            const refreshed = await refreshTables(getAffectedTables('edit_tenant'), dataRef.current)
            dataRef.current = refreshed
            setData(refreshed)
            refreshRentSummary()
            setSuccessMessage(`${changes.name} updated successfully. Payment and transaction history was preserved.`)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to edit tenant.'
            setBackendError(message)
            throw error
          }
        }} />
      })()}
      {modal === 'moveTenant' && <MoveTenantModal tenant={data.tenants.find((tenant) => tenant.id === selectedTenantId)!} rooms={scoped.rooms} tenants={scoped.activeTenants} onClose={closeModal} onSubmit={(roomId, bedNo, note) => { const tenant = data.tenants.find((item) => item.id === selectedTenantId)!; updateData((previous) => ({ ...previous, tenants: previous.tenants.map((item) => item.id === selectedTenantId ? { ...item, roomId, bedNo } : item) }), 'Move Tenant', 'Tenants', `${role} ${currentUser.name} moved tenant ${tenant.name} from Room ${data.rooms.find((room) => room.id === tenant.roomId)?.number} to Room ${data.rooms.find((room) => room.id === roomId)?.number} Bed ${bedNo} on ${formatDate(today)}.${note ? ` Reason: ${note}.` : ''}`) }} onSwap={async (tenantAId, tenantBId, tenantARoomId, tenantABedNo, tenantBRoomId, tenantBBedNo, _note) => { setBackendError(''); try { const result = await swapTenantRooms(tenantAId, tenantBId, tenantARoomId, tenantABedNo, tenantBRoomId, tenantBBedNo); if (!result.success) throw new Error(result.error || 'Swap failed'); const previous = dataRef.current; const tA = previous.tenants.find((t) => t.id === tenantAId); const tB = previous.tenants.find((t) => t.id === tenantBId); const roomA = previous.rooms.find((r) => r.id === tA?.roomId); const roomB = previous.rooms.find((r) => r.id === tB?.roomId); const logged = logActivity(previous, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch?.name || '', module: 'Tenants', actionType: 'Swap Tenants', description: `${role} ${currentUser.name} swapped ${tA?.name || 'Tenant A'} and ${tB?.name || 'Tenant B'} between Room ${roomA?.number} Bed ${tA?.bedNo} and Room ${roomB?.number} Bed ${tB?.bedNo}.` }); dataRef.current = logged; setData(logged); await persistAppData(previous, logged, currentUser.id); const refreshedSwap = await refreshTables(getAffectedTables('swap'), dataRef.current); dataRef.current = refreshedSwap; setData(refreshedSwap); setSuccessMessage(`${tA?.name || 'Tenant'} and ${tB?.name || 'Tenant'} swapped successfully.`) } catch (error) { const message = error instanceof Error ? error.message : 'Swap failed'; setBackendError(message); throw error } }} />}
      {modal === 'editBranch' && <BranchModal branch={branch} onClose={closeModal} onDelete={() => openModal('deleteBranch')} onSubmit={(changes) => updateData((previous) => ({ ...previous, branches: previous.branches.map((item) => item.id === branchId ? { ...item, ...changes } : item) }), 'Edit Branch', 'Branches', `${role} ${currentUser.name} changed branch name from ${branch.name} to ${changes.name}. Address changed from ${branch.address} to ${changes.address}.`)} />}
      {modal === 'deleteBranch' && <DeleteBranchConfirmModal branch={branch} onClose={closeModal} onConfirm={async () => { setBackendError(''); await deleteBranchCascade(branchId, currentUser.id, currentUser.name, role, branch?.name); const refreshed = await loadAppData(); setData(refreshed); const remaining = refreshed.branches.filter((item) => item.active !== false && (isAdmin || currentUser.branchIds.includes(item.id))); if (remaining.length) setBranchId(remaining[0].id); else setBranchId(''); closeModal(); }} />}
      {modal === 'addStaff' && <StaffModal branches={data.branches.filter((item) => item.active !== false)} onClose={closeModal} onSubmit={async (staff) => { try { await createStaffAccount(staff); const refreshed = await loadAppData(); const next = logActivity(refreshed, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch.name, module: 'Staff', actionType: 'Add Staff', description: `${role} ${currentUser.name} added staff ${staff.name} and assigned ${staff.branchIds.map((id) => data.branches.find((item) => item.id === id)?.name).join(' and ')}.` }); await persistAppData(refreshed, next, currentUser.id); setData(next) } catch (error) { setBackendError(error instanceof Error ? error.message : 'Unable to create staff') } }} />}
      {modal === 'editStaff' && <StaffModal user={data.users.find((user) => user.id === selectedUserId)} branches={data.branches.filter((item) => item.active !== false)} onClose={closeModal} onSubmit={async (staff) => { try { await createStaffAccount({ id: selectedUserId, ...staff }); const refreshed = await loadAppData(); const next = logActivity(refreshed, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch.name, module: 'Staff', actionType: 'Change Staff Access', description: `${role} ${currentUser.name} assigned staff ${staff.name} to ${staff.branchIds.map((id) => data.branches.find((item) => item.id === id)?.name).join(' and ')}.` }); await persistAppData(refreshed, next, currentUser.id); setData(next) } catch (error) { setBackendError(error instanceof Error ? error.message : 'Unable to update staff') } }} />}
      {modal === 'addAdmin' && <AdminModal onClose={closeModal} onSubmit={async (staff) => { try { await createStaffAccount({ ...staff, branchIds: [], permissions: [], role: 'Admin' }); const refreshed = await loadAppData(); const next = logActivity(refreshed, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch.name, module: 'Staff', actionType: 'Add Admin', description: `${role} ${currentUser.name} added admin ${staff.name}.` }); await persistAppData(refreshed, next, currentUser.id); setData(next) } catch (error) { setBackendError(error instanceof Error ? error.message : 'Unable to create admin') } }} />}
      {modal === 'resetPassword' && <ResetPasswordModal onClose={closeModal} onSubmit={async (newPassword) => { try { await resetUserPassword(selectedUserId, newPassword); const refreshed = await loadAppData(); const user = data.users.find((u) => u.id === selectedUserId); const next = logActivity(refreshed, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch.name, module: 'Staff', actionType: 'Reset Password', description: `${role} ${currentUser.name} reset password for ${user?.name || selectedUserId}.` }); await persistAppData(refreshed, next, currentUser.id); setData(next) } catch (error) { setBackendError(error instanceof Error ? error.message : 'Unable to reset password') } }} />}
      {modal === 'expense' && <ExpenseModal onClose={closeModal} onSubmit={(expense) => { const expenseId = uid('e'); const cashbookId = uid('c'); const now = new Date().toISOString(); const cat = data.categories.find((c) => c.branchId === branchId && c.name === expense.category); updateData((previous) => ({ ...previous, expenses: [{ id: expenseId, branchId, cashbookId, categoryId: cat?.id, ...expense }, ...previous.expenses], cashbook: [{ id: cashbookId, branchId, type: 'Debit', amount: expense.amount, description: expense.description, date: expense.date, source: 'Expense', linkedId: expenseId, category: expense.category, categoryId: cat?.id, createdAt: now }, ...previous.cashbook] }), 'debit created', 'Finance', `${role} ${currentUser.name} added expense of ${money(expense.amount)} under ${expense.category}. Vendor/Note: ${expense.vendor || '-'}.`) }} />}

      {modal === 'purchase' && <PurchaseModal items={scoped.inventory} onClose={closeModal} onSubmit={(payload) => { const itemName = payload.mode === 'New Item' ? payload.name : data.inventory.find((item) => item.id === payload.itemId)?.name; updateData((previous) => addPurchase(previous, branchId, payload), 'Add Purchase', 'Inventory', `${role} ${currentUser.name} added inventory purchase: ${itemName}, Qty ${payload.quantity}, Unit cost ${money(payload.unitCost)}, Total ${money(payload.quantity * payload.unitCost)}.`) }} />}
      {modal === 'inventoryHistory' && <InventoryHistoryModal item={data.inventory.find((item) => item.id === selectedInventoryId)!} purchases={scoped.purchases.filter((purchase) => purchase.itemId === selectedInventoryId)} isAdmin={isAdmin} onClose={closeModal} onEdit={(purchase) => { setSelectedCashbookId(purchase.id); openModal('editPurchase') }} onDelete={(purchase) => { const item = data.inventory.find((i) => i.id === purchase.itemId); updateData((previous) => deletePurchase(previous, purchase), 'Delete Inventory Purchase', 'Inventory', `${role} ${currentUser.name} deleted inventory purchase: ${item?.name || 'Unknown item'}, Qty ${purchase.quantity}, Cost ${money(purchase.quantity * purchase.unitCost)}.`) }} />}
      {modal === 'editPurchase' && <EditPurchaseModal purchase={data.purchases.find((purchase) => purchase.id === selectedCashbookId)!} onClose={closeModal} onSubmit={(changes) => { const old = data.purchases.find((p) => p.id === selectedCashbookId)!; const item = data.inventory.find((i) => i.id === old.itemId); updateData((previous) => editPurchase(previous, selectedCashbookId, changes), 'Edit Inventory Purchase', 'Inventory', `${role} ${currentUser.name} edited inventory purchase: ${item?.name || 'Unknown item'}. Qty changed from ${old.quantity} to ${changes.quantity}, unit cost from ${money(old.unitCost)} to ${money(changes.unitCost)}.`) }} />}
      {modal === 'ticket' && <TicketModal rooms={scoped.rooms} tenants={scoped.activeTenants} onClose={closeModal} onSubmit={(ticket) => updateData((previous) => ({ ...previous, tickets: [{ id: uid('m'), branchId, status: 'Open', ...ticket }, ...previous.tickets] }), 'Create Ticket', 'Maintenance', `${role} ${currentUser.name} created maintenance ticket: ${ticket.title} for Room ${data.rooms.find((room) => room.id === ticket.roomId)?.number}. Category: ${ticket.category}.`)} />}
      {modal === 'maintenanceQR' && <MaintenanceQRModal branch={branch} onClose={closeModal} />}
      {modal === 'resolveTicket' && <ResolveTicketModal ticket={data.tickets.find((ticket) => ticket.id === selectedTicketId)!} room={data.rooms.find((room) => room.id === data.tickets.find((ticket) => ticket.id === selectedTicketId)?.roomId)} onClose={closeModal} onSubmit={(resolution, markAvailable) => { const ticket = data.tickets.find((item) => item.id === selectedTicketId)!; const room = data.rooms.find((item) => item.id === ticket.roomId)!; const expenseId = uid('e'); const cashbookId = uid('c'); const maintCatId = data.categories.find((c) => c.branchId === branchId && c.name === 'Maintenance')?.id; updateData((previous) => ({ ...previous, tickets: previous.tickets.map((item) => item.id === selectedTicketId ? { ...item, status: 'Resolved', resolution } : item), rooms: markAvailable ? previous.rooms.map((item) => item.id === room.id ? { ...item, status: previous.tenants.filter((tenant) => tenant.roomId === item.id && tenant.status !== 'Left').length >= item.beds ? 'Occupied' : 'Vacant' } : item) : previous.rooms, expenses: resolution.cost > 0 ? [{ id: expenseId, branchId, category: 'Maintenance', categoryId: maintCatId, description: `Repair - ${ticket.title}`, amount: resolution.cost, date: resolution.date, vendor: resolution.vendor, cashbookId, ticketId: ticket.id }, ...previous.expenses] : previous.expenses, cashbook: resolution.cost > 0 ? [{ id: cashbookId, branchId, type: 'Debit', amount: resolution.cost, description: `Maintenance repair - ${ticket.title}`, date: resolution.date, source: 'Maintenance', linkedId: expenseId, category: 'Maintenance', categoryId: maintCatId }, ...previous.cashbook] : previous.cashbook }), 'Resolve Ticket', 'Maintenance', `${role} ${currentUser.name} resolved maintenance ticket '${ticket.title}' for Room ${room.number}. Cost: ${money(resolution.cost)}. Note: ${resolution.note}.`) }} />}
      {modal === 'reopenTicket' && <ConfirmModal title="Reopen ticket" message="Move this ticket back to Open status?" onClose={closeModal} onConfirm={() => { const ticket = data.tickets.find((item) => item.id === selectedTicketId)!; updateData((previous) => ({ ...previous, tickets: previous.tickets.map((item) => item.id === selectedTicketId ? { ...item, status: 'Open', resolution: undefined } : item) }), 'Reopen Ticket', 'Maintenance', `${role} ${currentUser.name} reopened maintenance ticket '${ticket.title}'.`) }} />}
      {modal === 'room' && <RoomDetailsModal room={data.rooms.find((room) => room.id === selectedRoomId)!} tenants={scoped.activeTenants.filter((tenant) => tenant.roomId === selectedRoomId)} tickets={scoped.tickets.filter((ticket) => ticket.roomId === selectedRoomId)} onClose={closeModal} onAdmit={() => { openModal('admit') }} onMaintenance={() => { const room = data.rooms.find((item) => item.id === selectedRoomId)!; updateData((previous) => ({ ...previous, rooms: previous.rooms.map((item) => item.id === selectedRoomId ? { ...item, status: 'Maintenance' } : item) }), 'Mark Room Maintenance', 'Rooms', `${role} ${currentUser.name} marked Room ${room.number} as under maintenance.`) }} />}
      {modal === 'addRoom' && <RoomModal onClose={closeModal} onSubmit={(room) => updateData((previous) => ({ ...previous, rooms: [{ id: uid('r'), branchId, ...room }, ...previous.rooms] }), 'Add Room', 'Rooms', `${role} ${currentUser.name} added Room ${room.number}, Type ${room.type}, Floor ${room.floor}, Capacity ${room.beds}, Rent ${money(room.rent)}.`)} />}
      {modal === 'editRoom' && <RoomModal room={data.rooms.find((room) => room.id === selectedRoomId)} onClose={closeModal} onSubmit={(changes) => { const old = data.rooms.find((room) => room.id === selectedRoomId)!; updateData((previous) => ({ ...previous, rooms: previous.rooms.map((room) => room.id === selectedRoomId ? { ...room, ...changes } : room) }), 'Edit Room', 'Rooms', `${role} ${currentUser.name} edited Room ${old.number}. Room number: ${old.number} to ${changes.number}; rent: ${money(old.rent)} to ${money(changes.rent)}.`) }} />}
      {modal === 'confirmDeleteTenant' && <ConfirmModal title="Permanently delete tenant" message="This action will delete all linked records including payments, ledger entries and logs." confirmLabel="Delete Permanently" onClose={closeModal} onConfirm={async () => {
        setBackendError('')
        try { await deleteTenantWithPayments(selectedTenantId); const refreshedDelTenant = await refreshTables(getAffectedTables('delete_tenant'), dataRef.current); dataRef.current = refreshedDelTenant; setData(refreshedDelTenant) }
        catch (error) { const message = error instanceof Error ? error.message : 'Tenant deletion failed'; setBackendError(message); throw error }
      }} />}
      {modal === 'confirmDeleteRoom' && <ConfirmModal title="Remove room" message="This permanently removes the vacant room." onClose={closeModal} onConfirm={() => { const room = data.rooms.find((item) => item.id === selectedRoomId)!; updateData((previous) => ({ ...previous, rooms: previous.rooms.filter((item) => item.id !== selectedRoomId) }), 'Delete Room', 'Rooms', `${role} ${currentUser.name} deleted vacant Room ${room.number}.`) }} />}
      {modal === 'confirmDeleteCashbook' && <ConfirmModal title="Delete cashbook entry" message="This also deletes the linked payment, expense, maintenance cost, or inventory purchase and recalculates affected balances." onClose={closeModal} onConfirm={async () => {
        setBackendError('')
        try { await deleteCashbookEntryCascade(selectedCashbookId); const refreshedCashbook = await refreshTables(getAffectedTables('delete_cashbook'), dataRef.current); dataRef.current = refreshedCashbook; setData(refreshedCashbook) }
        catch (error) { const message = error instanceof Error ? error.message : 'Cashbook deletion failed'; setBackendError(message); throw error }
      }} />}
      {modal === 'fiveMonthRegister' && <FiveMonthRegisterModal data={data} scoped={scoped} branch={branch} visibleBranches={visibleBranches} onClose={closeModal} onExport={(type, format) => { const previous = dataRef.current; const logged = logActivity(previous, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch?.name || '', module: 'Report', actionType: 'Export', description: `${role} ${currentUser.name} exported ${type} as ${format} for ${branch?.name}.` }); dataRef.current = logged; setData(logged); persistenceQueue.current = persistenceQueue.current.then(() => persistAppData(previous, logged, currentUser.id)).catch(() => {}) }} />}
      {modal === 'notifications' && <Modal title="Notifications" onClose={closeModal}>{notifications.length ? <div className="grid gap-2">{notifications.map((note) => <div key={note} className="rounded-md bg-orange-50 p-3 text-sm font-semibold text-orange-800">{note}</div>)}</div> : <p>No active alerts.</p>}</Modal>}
    </div>
  )
}

function Dashboard({ scoped, rentSummary, refreshRentSummary, setModal, setPage, setTenantTab, setTenantFilter, setRoomFloor, setFinanceTab, setPaymentFilter, setTicketFilter }: { scoped: ReturnType<typeof branchData>; rentSummary: RentCollectionSummary | null; refreshRentSummary: () => void; setModal: (value: string) => void; setPage: (page: Page) => void; setTenantTab: (value: 'Active' | 'Left PG') => void; setTenantFilter: (value: string) => void; setRoomFloor: (value: string) => void; setFinanceTab: (value: string) => void; setPaymentFilter: (value: string) => void; setTicketFilter: (value: string) => void }) {
  const todayCollection = scoped.payments.filter((payment) => payment.date === today).reduce((sum, payment) => sum + payment.amount, 0)
  const monthlyCollection = scoped.payments.filter((payment) => payment.month === currentMonth).reduce((sum, payment) => sum + payment.amount, 0)
  const monthlyExpenses = scoped.cashbook.filter((entry) => entry.date.startsWith(currentMonth) && entry.type === 'Debit').reduce((sum, entry) => sum + entry.amount, 0)
  const newAdmissions = scoped.activeTenants.filter((tenant) => tenant.joiningDate.startsWith(currentMonth)).length
  const vacatedThisMonth = scoped.leftTenants.filter((tenant) => tenant.left?.leftDate.startsWith(currentMonth)).length
  const upcomingDue = scoped.activeTenants.filter((tenant) => { const state = scoped.rentStates.get(tenant.id); const days = state ? daysUntil(state.dueDate) : -1; return state?.status === 'Upcoming' && days >= 0 && days <= 3 }).length
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((month, index) => ({
    month,
    collected: Math.round(scoped.revenue * (0.65 + index * 0.07)),
    expected: scoped.expected || 1,
  }))
  const roomDistribution = ['Single', 'Double', 'Triple', 'Suite'].map((type) => ({ name: type, value: scoped.rooms.filter((room) => room.type === type).length }))
  const vacating = scoped.activeTenants.filter((tenant) => tenant.notice?.expectedLeavingDate.startsWith(currentMonth))
  const vacateDueTenants = scoped.activeTenants.filter((tenant) => tenant.notice?.expectedLeavingDate && today >= tenant.notice.expectedLeavingDate)
  const alerts = [
    ...vacateDueTenants.map((tenant) => {
      const days = vacateDueDays(tenant.notice!.expectedLeavingDate)
      return { type: 'vacateDue', text: `${tenant.name} vacate overdue by ${days} day${days !== 1 ? 's' : ''} (was due ${formatDate(tenant.notice!.expectedLeavingDate)})` }
    }),
    ...scoped.activeTenants.filter((tenant) => ['Pending', 'Overdue'].includes(scoped.rentStates.get(tenant.id)?.status || '')).map((tenant) => { const state = scoped.rentStates.get(tenant.id)!; return { type: 'payment', text: `${tenant.name} has ${money(state.pending)} ${state.status.toLowerCase()} for ${state.period}` } }),
    ...scoped.openTickets.map((ticket) => ({ type: 'maintenance', text: `Maintenance: ${ticket.title}` })),
    ...vacating.filter((tenant) => !vacateDueTenants.includes(tenant)).map((tenant) => ({ type: 'vacating', text: `${tenant.name} is leaving ${formatDate(tenant.notice?.expectedLeavingDate)}` })),
  ]
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-lg border-2 border-blue-200 bg-blue-50 p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-700">Expected Rent Till Month End</p>
              <p className="mt-1 text-3xl font-black text-blue-900">{money(rentSummary?.expectedTillMonthEnd || 0)}</p>
              <p className="mt-1 text-xs text-blue-600">Previous pending + {formatMonth(currentMonth)} outstanding</p>
            </div>
            <button onClick={refreshRentSummary} className="rounded p-1 text-blue-400 hover:bg-blue-100 hover:text-blue-600" title="Refresh summary"><RefreshCw size={14} /></button>
          </div>
          <p className="mt-2 text-xs text-blue-500" title="Total outstanding rent for all periods up to and including the current month. Includes unpaid balances from previous months and full current month rent regardless of due date.">{rentSummary?.tenantCountWithPending || 0} tenant{(rentSummary?.tenantCountWithPending || 0) !== 1 ? 's' : ''} with pending balance</p>
        </div>
        <div className="relative overflow-hidden rounded-lg border-2 border-rose-200 bg-rose-50 p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-rose-700">Pending Till Today</p>
              <p className="mt-1 text-3xl font-black text-rose-900">{money(rentSummary?.pendingTillToday || 0)}</p>
              <p className="mt-1 text-xs text-rose-600">Overdue through {formatDate(today)}</p>
            </div>
            <button onClick={refreshRentSummary} className="rounded p-1 text-rose-400 hover:bg-rose-100 hover:text-rose-600" title="Refresh summary"><RefreshCw size={14} /></button>
          </div>
          <p className="mt-2 text-xs text-rose-500" title="Rent that has actually become due up to today. Includes all previous unpaid months and current month obligations whose due date has arrived.">{rentSummary?.previousMonthsPending ? `Previous: ${money(rentSummary.previousMonthsPending)}` : 'No previous pending'}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Metric icon={<IndianRupee />} label="Today's Collection" value={money(todayCollection)} onClick={() => setPage('Payments')} />
        <Metric icon={<IndianRupee />} label="Monthly Collection" value={money(monthlyCollection)} onClick={() => setPage('Payments')} />
        <Metric icon={<Users />} label="Current Tenants" value={scoped.activeTenants.length} onClick={() => { setTenantTab('Active'); setTenantFilter('All'); setPage('Tenants') }} />
        <Metric icon={<Home />} label="Occupancy Rate" value={`${scoped.occupancyRate}%`} onClick={() => { setRoomFloor('All Floors'); setPage('Rooms') }} />
        <Metric icon={<Home />} label="Vacant Beds" value={Math.max(0, scoped.totalBeds - scoped.occupiedBeds)} onClick={() => setPage('Rooms')} />
        <Metric icon={<AlertTriangle />} label="Pending Rent" value={money(scoped.pendingRent)} tone="orange" onClick={() => setPage('Payments')} />
        <Metric icon={<ShieldCheck />} label="Pending Security" value={money(scoped.pendingSecurity)} tone="orange" onClick={() => setPage('Payments')} />
        <Metric icon={<CircleDollarSign />} label="Cash Balance" value={money(scoped.cashBalance)} onClick={() => { setFinanceTab('Cashbook'); setPage('Finance') }} />
        <Metric icon={<ReceiptText />} label="Monthly Expenses" value={money(monthlyExpenses)} tone="red" onClick={() => setPage('Finance')} />
        <Metric icon={<Wrench />} label="Open Maintenance Tickets" value={scoped.openTickets.length} tone="orange" onClick={() => { setTicketFilter('Active'); setPage('Maintenance') }} />
        <Metric icon={<UserPlus />} label="New Admissions" value={newAdmissions} onClick={() => setPage('Tenants')} />
        <Metric icon={<LogOut />} label="Vacated This Month" value={vacatedThisMonth} onClick={() => { setTenantTab('Left PG'); setPage('Tenants') }} />
        {vacateDueTenants.length > 0 && <Metric icon={<CalendarClock />} label="Vacate Due" value={`${vacateDueTenants.length} TENANT${vacateDueTenants.length !== 1 ? 'S' : ''}`} tone="red" onClick={() => { setTenantTab('Active'); setTenantFilter('Vacate Due'); setPage('Tenants') }} />}
        <Metric icon={<CalendarClock />} label="Upcoming Due Rent" value={upcomingDue} tone="orange" onClick={() => setPage('Payments')} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card><h2 className="mb-4 text-lg font-bold">Revenue Overview</h2><div className="h-72"><ResponsiveContainer><BarChart data={months}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Bar dataKey="collected" fill="#16a34a" radius={[4, 4, 0, 0]} /><Bar dataKey="expected" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card><h2 className="mb-4 text-lg font-bold">Room Distribution</h2><div className="h-72"><ResponsiveContainer><PieChart><Pie data={roomDistribution} innerRadius={58} outerRadius={92} dataKey="value" label>{roomDistribution.map((_, index) => <Cell key={index} fill={['#2563eb', '#16a34a', '#f97316', '#8b5cf6'][index]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div></Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card><h2 className="mb-4 text-lg font-bold">Occupancy Trend</h2><div className="h-48"><ResponsiveContainer><AreaChart data={months.map((item, index) => ({ month: item.month, occupancy: Math.min(100, scoped.occupancyRate - 12 + index * 3) }))}><XAxis dataKey="month" /><YAxis /><Tooltip /><Area dataKey="occupancy" fill="#bfdbfe" stroke="#2563eb" /></AreaChart></ResponsiveContainer></div></Card>
        <Card><button className="w-full text-left" onClick={() => { setTenantTab('Active'); setTenantFilter('Vacating Notice'); setPage('Tenants') }}><h2 className="mb-4 text-lg font-bold">Vacating This Month</h2><div className="grid gap-2">{vacating.length ? vacating.map((tenant) => { const overdue = tenant.notice?.expectedLeavingDate && today >= tenant.notice.expectedLeavingDate; return <div key={tenant.id} className={`rounded-md p-3 text-sm ${overdue ? 'bg-rose-100 text-rose-800' : 'bg-orange-50'}`}><b>{tenant.name}</b><br />Leaving {formatDate(tenant.notice?.expectedLeavingDate)}{overdue && <span className="ml-2 font-bold">(OVERDUE)</span>}</div> }) : <p className="text-sm text-slate-500">No vacating notices for this month.</p>}</div></button></Card>
        <Card><h2 className="mb-4 text-lg font-bold">Alerts</h2><div className="grid gap-2">{alerts.slice(0, 5).map((alert) => <button key={`${alert.type}-${alert.text}`} onClick={() => { if (alert.type === 'maintenance') { setTicketFilter('Active'); setPage('Maintenance') } else if (alert.type === 'vacating') { setTenantTab('Active'); setTenantFilter('Vacating Notice'); setPage('Tenants') } else if (alert.type === 'vacateDue') { setTenantTab('Active'); setTenantFilter('Vacate Due'); setPage('Tenants') } else { setPaymentFilter(alert.text.includes('overdue') ? 'Overdue' : 'All'); setPage('Payments') } }} className="rounded-md bg-rose-50 p-3 text-left text-sm text-rose-800">{alert.text}</button>)}<Button tone="soft" onClick={() => setModal('notifications')}><Bell size={16} /> View all alerts</Button></div></Card>
      </div>
      <Card><h2 className="mb-4 text-lg font-bold">Recent Activities</h2><div className="grid gap-2 md:grid-cols-2">{scoped.activityLogs.slice(0, 6).map((log) => <div key={log.id} className="rounded-md bg-slate-50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{log.actionType}</b><span className="text-xs text-slate-400">{formatDateTime(log.at)}</span></div><p className="mt-1 text-slate-600">{log.description}</p></div>)}{!scoped.activityLogs.length && <p className="text-sm text-slate-500">No recent activity.</p>}</div></Card>
    </div>
  )
}

function Metric({ icon, label, value, tone = 'blue', onClick }: { icon: ReactNode; label: string; value: ReactNode; tone?: 'blue' | 'red' | 'orange'; onClick?: () => void }) {
  const color = tone === 'red' ? 'text-rose-600 bg-rose-50' : tone === 'orange' ? 'text-orange-600 bg-orange-50' : 'text-blue-600 bg-blue-50'
  const content = <><div className={`mb-4 grid h-11 w-11 place-items-center rounded-md ${color}`}>{icon}</div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></>
  return <Card>{onClick ? <button className="w-full text-left" onClick={onClick}>{content}</button> : content}</Card>
}

function TenantsPage({ data, scoped, tenantTab, setTenantTab, filter, setFilter, setModal, setSelectedTenantId, isAdmin, canAction }: { data: AppData; scoped: ReturnType<typeof branchData>; tenantTab: 'Active' | 'Left PG'; setTenantTab: (value: 'Active' | 'Left PG') => void; filter: string; setFilter: (value: string) => void; setModal: (value: string) => void; setSelectedTenantId: (id: string) => void; isAdmin: boolean; canAction: (permission: string) => boolean }) {
  const [tenantSearch, setTenantSearch] = useState('')
  const filtered = scoped.activeTenants.filter((tenant) => {
    if (filter === 'All') return true
    if (filter === 'Vacating Notice') return tenant.status === 'Notice'
    if (filter === 'Vacate Due') return !!tenant.notice?.expectedLeavingDate && today >= tenant.notice.expectedLeavingDate
    return scoped.rentStates.get(tenant.id)?.status === filter
  })
  const totalSecurityHeld = scoped.activeTenants.reduce((sum, tenant) => sum + tenant.security, 0)
  const searched = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase()
    if (!q) return
    const source = tenantTab === 'Active' ? filtered : scoped.leftTenants
    return source.filter((tenant) => {
      const room = data.rooms.find((r) => r.id === tenant.roomId)
      return tenant.name.toLowerCase().includes(q) || tenant.phone.includes(q) || (room?.number || '').toLowerCase().includes(q)
    })
  }, [tenantSearch, filtered, scoped.leftTenants, data.rooms, tenantTab])
  const displayList = searched ?? (tenantTab === 'Active' ? filtered : scoped.leftTenants)
  const noResults = searched !== undefined && searched.length === 0
  return (
    <div className="grid gap-4">
      <Tabs values={['Active', 'Left PG']} value={tenantTab} onChange={(value) => setTenantTab(value as 'Active' | 'Left PG')} />
      <div className="flex items-center justify-end"><Button tone="soft" onClick={() => setModal('fiveMonthRegister')}><FileBarChart size={16} /> 5 Month Register</Button></div>
      {tenantTab === 'Active' ? <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={<ShieldCheck />} label="Total Security Held" value={money(totalSecurityHeld)} /></div>
        <Tabs values={['All', 'Paid', 'Pending', 'Overdue', 'Vacating Notice', 'Vacate Due']} value={filter} onChange={setFilter} />
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} className={`${inputClass} w-full pl-10 pr-10`} placeholder="Search tenant, mobile or room..." />
          {tenantSearch && <button onClick={() => setTenantSearch('')} className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={14} /></button>}
        </div>
        {noResults ? <div className="rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">No tenant found for &quot;{tenantSearch.trim()}&quot;</div> : <DataTable headers={['Tenant name', 'Email/phone', 'Room', 'Room type', 'Monthly rent', 'Rent paid', 'Rent balance', 'Security', 'Security received', 'Security balance', 'Electricity', 'Since', 'Rent Due Date', 'Status', 'Actions']}>
          {displayList.map((tenant) => {
            const room = data.rooms.find((item) => item.id === tenant.roomId)!
            const rentState = scoped.rentStates.get(tenant.id)!
            const calculatedRentDueDate = getCalculatedRentDueDate(tenant, scoped.payments, scoped.obligations)
            const balance = rentState.pending
            const securityReceived = tenant.securityReceived
            const securityBalance = Math.max(0, tenant.security - tenant.securityReceived)
            const status = rentState.status
            const whatsapp = `https://wa.me/91${tenant.phone}?text=${encodeURIComponent(`Hi ${tenant.name}, rent ${money(rentState.agreed)} for ${room.number} at ${data.branches.find((branch) => branch.id === tenant.branchId)?.name} is due on ${calculatedRentDueDate}. Balance: ${money(balance)}.`)}`
            const vacateDueDayCount = tenant.notice?.expectedLeavingDate ? vacateDueDays(tenant.notice.expectedLeavingDate) : null
            const isVacateDue = vacateDueDayCount !== null && vacateDueDayCount >= 0
            return <tr key={tenant.id} className="border-t border-slate-100">
              <td className="p-3 font-semibold">{tenant.name}</td><td className="p-3 text-sm">{tenant.email}<br />{tenant.phone}</td><td className="p-3">{room.number}</td><td className="p-3">{room.type}</td><td className="p-3">{money(tenant.monthlyRent)}</td><td className="p-3 text-emerald-700">{money(rentState.received + rentState.advanceApplied)}</td><td className="p-3 text-rose-700">{money(balance)}</td><td className="p-3">{money(tenant.security)}</td><td className="p-3 text-emerald-700">{money(securityReceived)}</td><td className="p-3">{securityBalance === 0 ? <Badge tone="green">Cleared</Badge> : money(securityBalance)}</td><td className="p-3">{tenant.electricity === 'Fixed' ? money(tenant.electricityAmount) : 'Included'}</td><td className="p-3">{formatDate(tenant.joiningDate)}</td><td className="p-3 font-semibold">{formatDate(calculatedRentDueDate)}</td><td className="p-3"><Badge tone={tenant.status === 'Notice' || tenant.status === 'Needs Verification' ? 'orange' : status === 'Clear' || status === 'Paid' ? 'green' : status === 'Overdue' ? 'red' : 'orange'}>{tenant.status === 'Notice' || tenant.status === 'Needs Verification' ? tenant.status : status}</Badge>{isVacateDue && <div className="mt-1"><span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">VACATE {vacateDueDayCount === 0 ? 'DUE TODAY' : `OVERDUE ${vacateDueDayCount}D`}</span><div className="mt-0.5 text-[10px] text-rose-700">Notice: {formatDate(tenant.notice!.expectedLeavingDate)}</div></div>}</td>
              <td className="p-3"><div className="flex min-w-max items-center gap-1"><CompactAction title="View Tenant Ledger" onClick={() => { setSelectedTenantId(tenant.id); setModal('tenantLedger') }}><Eye size={14} /></CompactAction>{isAdmin && <CompactAction title="Edit" onClick={() => { setSelectedTenantId(tenant.id); setModal('editTenant') }}><Edit3 size={14} /></CompactAction>}{canAction('move_tenant') && <CompactAction title="Move" onClick={() => { setSelectedTenantId(tenant.id); setModal('moveTenant') }}><Home size={14} /></CompactAction>}{canAction('add_payment') && <CompactAction title="Add Payment" onClick={() => { setSelectedTenantId(tenant.id); setModal('payment') }}><IndianRupee size={14} /></CompactAction>}<a title="WhatsApp Reminder" aria-label="WhatsApp Reminder" className="grid h-8 w-8 place-items-center rounded-md border border-slate-400 text-emerald-700 hover:bg-emerald-50" href={whatsapp} target="_blank"><MessageCircle size={14} /></a><CompactAction title="Notice" onClick={() => { setSelectedTenantId(tenant.id); setModal('notice') }}><CalendarClock size={14} /></CompactAction>{canAction('vacate_tenant') && <CompactAction title="Vacate" onClick={() => { setSelectedTenantId(tenant.id); setModal('vacate') }}><LogOut size={14} /></CompactAction>}{isAdmin && <CompactAction title="Delete" danger onClick={() => { setSelectedTenantId(tenant.id); setModal('confirmDeleteTenant') }}><Trash2 size={14} /></CompactAction>}</div></td>
            </tr>
          })}
        </DataTable>}
      </> : <><div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} className={`${inputClass} w-full pl-10 pr-10`} placeholder="Search tenant, mobile or room..." />
          {tenantSearch && <button onClick={() => setTenantSearch('')} className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={14} /></button>}
        </div>{noResults ? <div className="rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">No tenant found for &quot;{tenantSearch.trim()}&quot;</div> : <DataTable headers={['Tenant', 'Room', 'Type', 'Joined', 'Left date', 'Reason', 'Security', 'Extra days', 'Extra rent charge', 'Settlement received', 'Balance at exit', 'Contact', 'Actions']}>{displayList.map((tenant) => { const room = data.rooms.find((item) => item.id === tenant.roomId)!; return <tr key={tenant.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{tenant.name}</td><td className="p-3">{room.number}</td><td className="p-3">{room.type}</td><td className="p-3">{tenant.joiningDate}</td><td className="p-3">{tenant.left?.leftDate}</td><td className="p-3">{tenant.left?.reason}</td><td className="p-3">{money(tenant.security)}</td><td className="p-3">{tenant.left?.extraDays || 0}</td><td className="p-3">{money(tenant.left?.extraRentCharge || 0)}</td><td className="p-3 text-emerald-700">{money(tenant.left?.settlementReceived || 0)}</td><td className="p-3">{money(tenant.left?.finalRentBalance || 0)}</td><td className="p-3">{tenant.phone}</td><td className="p-3"><div className="flex gap-2"><Button tone="soft" onClick={() => { setSelectedTenantId(tenant.id); setModal('tenantLedger') }}><Eye size={15} /> Ledger</Button>{canAction('admit_tenant') && <Button tone="green" onClick={() => { setSelectedTenantId(tenant.id); setModal('rejoinTenant') }}><UserPlus size={15} /> Rejoin</Button>}{isAdmin && <Button tone="soft" onClick={() => { setSelectedTenantId(tenant.id); setModal('confirmUndoVacate') }}>Undo Vacate</Button>}</div></td></tr> })}</DataTable>}</>}
    </div>
  )
}

function RoomsPage({ scoped, roomFloor, setRoomFloor, setSelectedRoomId, setModal, isAdmin }: { scoped: ReturnType<typeof branchData>; roomFloor: string; setRoomFloor: (value: string) => void; setSelectedRoomId: (id: string) => void; setModal: (value: string) => void; isAdmin: boolean }) {
  const rooms = scoped.rooms.filter((room) => roomFloor === 'All Floors' || room.floor === Number(roomFloor.replace('Floor ', '')))
  return <div className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><Tabs values={['All Floors', 'Floor 1', 'Floor 2', 'Floor 3']} value={roomFloor} onChange={setRoomFloor} />{isAdmin && <Button tone="blue" onClick={() => setModal('addRoom')}><Plus size={16} /> Add Room</Button>}</div><div className="flex flex-wrap gap-3 text-sm"><Badge tone="green">Occupied</Badge><Badge>Vacant</Badge><Badge tone="orange">Maintenance</Badge></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rooms.map((room) => { const tenants = scoped.activeTenants.filter((tenant) => tenant.roomId === room.id); return <Card key={room.id}><button onClick={() => { setSelectedRoomId(room.id); setModal('room') }} className="w-full text-left"><div className="flex items-start justify-between"><h2 className="text-2xl font-black">Room {room.number}</h2><Badge tone={room.status === 'Occupied' ? 'green' : room.status === 'Maintenance' ? 'orange' : 'slate'}>{room.status}</Badge></div><p className="mt-2 text-sm text-slate-500">{room.type} · Floor {room.floor} · {room.beds} beds</p><div className="mt-4 min-h-16 rounded-md bg-slate-50 p-3 text-sm">{tenants.length ? tenants.map((tenant) => <p key={tenant.id} className="font-semibold">{tenant.name}</p>) : 'No tenant assigned'}</div><p className="mt-4 font-bold">{money(room.rent)} / month</p></button>{isAdmin && <div className="mt-3 flex justify-end gap-1 border-t border-slate-100 pt-3"><CompactAction title="Edit room" onClick={() => { setSelectedRoomId(room.id); setModal('editRoom') }}><Edit3 size={14} /></CompactAction><CompactAction title="Remove room" danger onClick={() => { setSelectedRoomId(room.id); if (tenants.length) alert('Cannot remove room with active tenants. Vacate or move tenants first.'); else setModal('confirmDeleteRoom') }}><Trash2 size={14} /></CompactAction></div>}</Card> })}</div></div>
}

function PaymentsPage({ data, scoped, filter, setFilter, setModal, setSelectedTenantId, canAdd }: { data: AppData; scoped: ReturnType<typeof branchData>; filter: string; setFilter: (value: string) => void; setModal: (value: string) => void; setSelectedTenantId: (id: string) => void; canAdd: boolean }) {
  const tenants = filter === 'Left PG' ? scoped.leftTenants : scoped.activeTenants.filter((tenant) => filter === 'All' || scoped.rentStates.get(tenant.id)?.status === filter)
  const collected = paymentTotal(scoped.payments)
  const rentCollected = paymentTotal(scoped.payments, 'Rent')
  const securityCollected = paymentTotal(scoped.payments, 'Security Deposit')
  const electricityCollected = paymentTotal(scoped.payments, 'Electricity')
  const otherCollected = paymentTotal(scoped.payments, 'Other')
  const overdueRent = scoped.overdue
  return <div className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"><Metric icon={<IndianRupee />} label="Total Collected" value={money(collected)} /><Metric icon={<ReceiptText />} label="Rent Collected" value={money(rentCollected)} /><Metric icon={<ShieldCheck />} label="Security Collected" value={money(securityCollected)} /><Metric icon={<ReceiptText />} label="Electricity Collected" value={money(electricityCollected)} /><Metric icon={<CircleDollarSign />} label="Other Income" value={money(otherCollected)} /><Metric icon={<AlertTriangle />} label="Pending Rent" value={money(scoped.pendingRent)} tone="orange" /><Metric icon={<ShieldCheck />} label="Pending Security" value={money(scoped.pendingSecurity)} tone="orange" /><Metric icon={<CircleDollarSign />} label="Advance Balance" value={money(scoped.advanceBalance)} /><Metric icon={<AlertTriangle />} label="Overdue Rent" value={money(overdueRent)} tone="red" /></div><Tabs values={['All', 'Paid', 'Pending', 'Overdue', 'Left PG']} value={filter} onChange={setFilter} /><DataTable headers={['Tenant', 'Room', 'Rent Due Date', 'Monthly rent', 'Rent paid', 'Rent balance', 'Security', 'Security received', 'Security balance', 'Electricity', 'Status', 'Actions']}>{tenants.map((tenant) => { const room = data.rooms.find((item) => item.id === tenant.roomId); const rentState = scoped.rentStates.get(tenant.id) || rentLedgerState(tenant, scoped.obligations, scoped.payments); const rentPaid = rentState.received + rentState.advanceApplied; const rentBalance = rentState.pending; const securityReceived = tenant.securityReceived; const securityBalance = Math.max(0, tenant.security - tenant.securityReceived); const status = tenant.status === 'Left' ? 'Left PG' : rentState.status; return <tr key={tenant.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{tenant.name}</td><td className="p-3">{room?.number || 'Archived room'}</td><td className="p-3 font-semibold">{formatDate(rentState.dueDate)}</td><td className="p-3">{money(tenant.monthlyRent)}</td><td className="p-3 text-emerald-700">{money(rentPaid)}</td><td className="p-3 text-rose-700">{money(rentBalance)}</td><td className="p-3">{money(tenant.security)}</td><td className="p-3 text-emerald-700">{money(securityReceived)}</td><td className="p-3">{securityBalance === 0 ? <Badge tone="green">Cleared</Badge> : money(securityBalance)}</td><td className="p-3">{tenant.electricity === 'Fixed' ? money(tenant.electricityAmount) : 'Included'}</td><td className="p-3"><Badge tone={status === 'Paid' || status === 'Clear' ? 'green' : status === 'Overdue' ? 'red' : status === 'Left PG' ? 'slate' : 'orange'}>{status}</Badge></td><td className="p-3">{canAdd && tenant.status !== 'Left' && <Button tone="green" onClick={() => { setSelectedTenantId(tenant.id); setModal('payment') }}><Plus size={15} /> Add received payment</Button>}</td></tr> })}</DataTable><h2 className="text-lg font-bold">Payment History</h2><DataTable headers={["Date", "Tenant", "Head", "Amount", "Mode", "Description"]}>{[...scoped.payments].sort((a, b) => b.date.localeCompare(a.date)).map((payment) => <tr key={payment.id} className="border-t border-slate-100"><td className="p-3">{formatDate(payment.date)}</td><td className="p-3 font-semibold">{data.tenants.find((tenant) => tenant.id === payment.tenantId)?.name || "Archived tenant"}</td><td className="p-3">{payment.paymentType}</td><td className="p-3 text-emerald-700">{money(payment.amount)}</td><td className="p-3">{payment.paymentMode}</td><td className="p-3">{payment.description}</td></tr>)}</DataTable><h2 className="text-lg font-bold">Security Ledger</h2><DataTable headers={["Date", "Tenant", "Movement", "Amount", "Reason"]}>{[...scoped.securityLedger].sort((a, b) => b.date.localeCompare(a.date)).map((movement) => <tr key={movement.id} className="border-t border-slate-100"><td className="p-3">{formatDate(movement.date)}</td><td className="p-3 font-semibold">{data.tenants.find((tenant) => tenant.id === movement.tenantId)?.name || "Archived tenant"}</td><td className="p-3">{movement.type}</td><td className="p-3">{money(movement.amount)}</td><td className="p-3">{movement.reason || "-"}</td></tr>)}</DataTable></div>
}

function SearchableSelect({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open])
  const filtered = search ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase())) : options
  const select = (opt: string) => { onChange(opt); setOpen(false); setSearch('') }
  return <div ref={ref} className="relative"><div className="relative"><input className={inputClass + ' w-full'} value={open ? search : value} onChange={(e) => { setSearch(e.target.value); setOpen(true) }} onFocus={() => { setOpen(true); setSearch('') }} onClick={() => { if (!open) setOpen(true) }} placeholder={placeholder || 'Select...'} /><button type="button" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></button>{open && <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-400 bg-white shadow-lg">{filtered.map((opt) => <button key={opt} type="button" className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-blue-50 ${opt === value ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-900'}`} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); select(opt) }} onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); select(opt) }}>{opt}</button>)}{filtered.length === 0 && <p className="p-3 text-sm text-slate-500">No matches</p>}</div>}</div></div>
}

function FinancePage({ scoped, financeTab, setFinanceTab, data, branch, setModal, setSelectedTenantId, setSelectedCashbookId, updateData, role, currentUser, isAdmin }: { scoped: ReturnType<typeof branchData>; financeTab: string; setFinanceTab: (value: string) => void; data: AppData; branch: Branch; setModal: (value: string) => void; setSelectedTenantId: (value: string) => void; setSelectedCashbookId: (value: string) => void; updateData: (updater: (previous: AppData) => AppData, action: string, entity: string, description?: string, metadata?: Record<string, string | number>) => void; role: Role; currentUser: User; isAdmin: boolean }) {
  const months = [...new Set(scoped.cashbook.map((entry) => entry.date.slice(0, 7)))].sort().reverse()
  const [expenseCategory, setExpenseCategory] = useState('All Categories')
  const branchCategories = data.categories.filter((c) => c.branchId === branch.id)
  const categoryLedger = useMemo(() => {
    const branchCashbook = data.cashbook.filter((e) => e.branchId === branch.id && e.type === 'Debit')
    return branchCategories.map((cat) => {
      const entries = branchCashbook.filter((e) => e.categoryId === cat.id || e.category === cat.name)
      const total = entries.reduce((s, e) => s + e.amount, 0)
      const count = entries.length
      return { ...cat, total, count, entries: entries.sort((a, b) => ((b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id))) }
    }).sort((a, b) => b.total - a.total)
  }, [data.cashbook, branchCategories, branch.id])
  const [showManageCategories, setShowManageCategories] = useState(false)
  const allBranchDebits = useMemo(() => {
    return data.cashbook.filter((e) => e.branchId === branch.id && e.type === 'Debit').sort((a, b) => ((b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id)))
  }, [data.cashbook, branch.id])
  const selectedLedgerData = useMemo(() => {
    if (expenseCategory === 'All Categories') return null
    return categoryLedger.find((c) => c.name === expenseCategory) || null
  }, [expenseCategory, categoryLedger])
  const [showPdfForm, setShowPdfForm] = useState(false)
  const [pdfFromDate, setPdfFromDate] = useState('')
  const [pdfToDate, setPdfToDate] = useState('')
  const downloadCashbookPdf = () => {
    const from = pdfFromDate || '2000-01-01'
    const to = pdfToDate || '2099-12-31'
    const entries = scoped.cashbook.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''))
    if (!entries.length) { alert('No transactions found in the selected date range.'); return }
    const totalCredit = entries.filter((e) => e.type === 'Credit').reduce((s, e) => s + e.amount, 0)
    const totalDebit = entries.filter((e) => e.type === 'Debit').reduce((s, e) => s + e.amount, 0)
    const doc = new jsPDF('landscape', 'mm', 'a4')
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 10
    doc.setFontSize(10)
    doc.text(`Cashbook - ${branch.name}`, margin, 12)
    doc.setFontSize(8)
    doc.text(`Period: ${pdfFromDate || 'Earliest'} to ${pdfToDate || 'Latest'}`, margin, 17)
    doc.text(`Generated: ${formatDate(today)}`, margin, 21)
    const head = ['Date', 'Entry Type', 'Category', 'Description/Notes', 'Credit Amount', 'Debit Amount', 'Payment Method', 'Reference']
    const body = entries.map((e) => [e.date, e.type === 'Credit' ? 'Credit' : 'Debit', e.category || '-', e.description, e.type === 'Credit' ? `Rs.${e.amount.toFixed(2)}` : '', e.type === 'Debit' ? `Rs.${e.amount.toFixed(2)}` : '', e.paymentMode || '-', e.reference || e.linkedId || '-'].map((cell) => String(cell).replace(/₹/g, 'Rs.')))
    body.push(['', '', '', '', '', '', '', ''])
    body.push(['TOTAL', '', '', '', `Rs.${totalCredit.toFixed(2)}`, `Rs.${totalDebit.toFixed(2)}`, '', ''])
    body.push(['NET MOVEMENT', '', '', '', `Rs.${Math.abs(totalCredit - totalDebit).toFixed(2)} ${totalCredit - totalDebit >= 0 ? 'Cr' : 'Dr'}`, '', '', ''])
    autoTable(doc, {
      head: [head], body, startY: 24, margin: { left: margin, right: margin },
      styles: { fontSize: 6.5, cellPadding: 1.2, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fontSize: 6, fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
      bodyStyles: { fontSize: 6.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      pageBreak: 'auto', showHead: 'everyPage',
      didDrawPage: (data: any) => { doc.setFontSize(7); doc.text(`Page ${data.pageNumber}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 4, { align: 'right' }) },
    })
    const blob = doc.output('blob')
    if (!blob || blob.size === 0) { alert('PDF generation failed: empty output'); return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `cashbook-${branch.name.replace(/\s+/g, '-')}-${pdfFromDate || 'start'}-${pdfToDate || 'end'}.pdf`; a.rel = 'noopener'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setShowPdfForm(false)
  }
  const [selectedMonth, setSelectedMonth] = useState(scoped.reportingMonth)
  const monthEntries = scoped.cashbook.filter((entry) => entry.date.startsWith(selectedMonth))
  const opening = scoped.cashbook.filter((entry) => entry.date < `${selectedMonth}-01`).reduce((sum, entry) => sum + (entry.type === 'Credit' ? entry.amount : -entry.amount), 0)
  const totalIn = monthEntries.filter((entry) => entry.type === 'Credit').reduce((sum, entry) => sum + entry.amount, 0)
  const totalOut = monthEntries.filter((entry) => entry.type === 'Debit').reduce((sum, entry) => sum + entry.amount, 0)
  const dateSorted = [...monthEntries].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''))
  let running = opening
  const runningById = new Map<string, number>()
  for (const entry of dateSorted) { running += entry.type === 'Credit' ? entry.amount : -entry.amount; runningById.set(entry.id, running) }
  const rows = [...monthEntries].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id)).map((entry) => ({ ...entry, running: runningById.get(entry.id) || 0 }))
  const interBranchNet = new Map<string, number>()
  for (const entry of data.cashbook) {
    const reference = parseInterBranchReference(entry.reference)
    if (!reference) continue
    if (entry.branchId === branch.id && reference.kind === 'IBR') interBranchNet.set(reference.counterpartyBranchId, (interBranchNet.get(reference.counterpartyBranchId) || 0) + reference.amount)
    if (entry.branchId === branch.id && reference.kind === 'IBS' && entry.type === 'Credit') interBranchNet.set(reference.counterpartyBranchId, (interBranchNet.get(reference.counterpartyBranchId) || 0) - reference.amount)
    if (entry.branchId !== branch.id && reference.kind === 'IBR' && reference.counterpartyBranchId === branch.id) interBranchNet.set(entry.branchId, (interBranchNet.get(entry.branchId) || 0) - reference.amount)
    if (entry.branchId === branch.id && reference.kind === 'IBS' && entry.type === 'Debit') interBranchNet.set(reference.counterpartyBranchId, (interBranchNet.get(reference.counterpartyBranchId) || 0) + reference.amount)
  }
  const interBranchRows = Array.from(interBranchNet.entries()).filter(([, amount]) => Math.abs(amount) > 0.001)
  const totalReceivable = interBranchRows.filter(([, amount]) => amount > 0).reduce((sum, [, amount]) => sum + amount, 0)
  const totalPayable = interBranchRows.filter(([, amount]) => amount < 0).reduce((sum, [, amount]) => sum + Math.abs(amount), 0)
  const partnerNet = new Map<string, number>()
  for (const entry of scoped.cashbook) {
    const partner = parsePartnerReference(entry.reference)
    if (partner && entry.type === 'Debit') partnerNet.set(partner, (partnerNet.get(partner) || 0) + entry.amount)
  }
  const partnerRows = Array.from(partnerNet.entries()).sort(([left], [right]) => left.localeCompare(right))
  const totalPartnerWithdrawals = partnerRows.reduce((sum, [, amount]) => sum + amount, 0)
  return <div className="grid gap-4"><Tabs values={['Cashbook', 'Expenses', 'Bill Creator']} value={financeTab} onChange={setFinanceTab} />{financeTab === 'Cashbook' && <><div className="no-print flex flex-wrap items-end gap-3"><div className="max-w-xs"><Field label="Month"><select className={inputClass} value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>{months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></Field></div>{!showPdfForm ? <Button tone="blue" onClick={() => setShowPdfForm(true)}><Download size={16} /> Download Cashbook</Button> : <div className="flex flex-wrap items-end gap-2"><Field label="From Date"><input className={inputClass} type="date" value={pdfFromDate} onChange={(e) => setPdfFromDate(e.target.value)} /></Field><Field label="To Date"><input className={inputClass} type="date" value={pdfToDate} onChange={(e) => setPdfToDate(e.target.value)} /></Field><Button tone="green" onClick={downloadCashbookPdf}><Download size={16} /> Download</Button><Button tone="soft" onClick={() => setShowPdfForm(false)}>Cancel</Button></div>}</div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={<CircleDollarSign />} label="Opening Balance" value={money(opening)} /><Metric icon={<IndianRupee />} label="Total IN" value={money(totalIn)} /><Metric icon={<ReceiptText />} label="Total OUT" value={money(totalOut)} tone="red" /><Metric icon={<ReceiptText />} label="Net Movement" value={`${money(Math.abs(totalIn - totalOut))} ${totalIn - totalOut >= 0 ? 'Cr' : 'Dr'}`} /><Metric icon={<CircleDollarSign />} label="Closing Balance" value={money(opening + totalIn - totalOut)} /></div><Card><h2 className="text-lg font-bold">Inter-branch Account</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-emerald-50 p-3"><p className="text-sm text-emerald-700">Total lena hai</p><p className="text-xl font-black text-emerald-800">{money(totalReceivable)}</p></div><div className="rounded-md bg-rose-50 p-3"><p className="text-sm text-rose-700">Total dena hai</p><p className="text-xl font-black text-rose-800">{money(totalPayable)}</p></div></div><div className="mt-3 grid gap-2">{interBranchRows.map(([otherBranchId, amount]) => <div key={otherBranchId} className="flex items-center justify-between rounded-md bg-slate-50 p-3 text-sm"><span>{data.branches.find((item) => item.id === otherBranchId)?.name || 'Other branch'}</span><b className={amount > 0 ? 'text-emerald-700' : 'text-rose-700'}>{amount > 0 ? `Lena ${money(amount)}` : `Dena ${money(Math.abs(amount))}`}</b></div>)}{!interBranchRows.length && <p className="text-sm text-slate-500">No inter-branch dues.</p>}</div></Card><Card><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Partner Ledger</h2><div className="text-right"><p className="text-xs text-slate-500">Total partner withdrawals</p><p className="text-xl font-black text-slate-900">{money(totalPartnerWithdrawals)}</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{partnerRows.map(([partner, amount]) => <div key={partner} className="rounded-md bg-slate-50 p-3"><p className="font-bold">{partner}</p><p className={`mt-1 text-sm font-semibold text-slate-700`}>{`Total liya ${money(amount)}`}</p></div>)}{!partnerRows.length && <p className="text-sm text-slate-500">No partner transactions yet.</p>}</div></Card><p className="text-sm font-semibold text-slate-500">Cashbook summary for {formatMonth(selectedMonth)}</p><DataTable headers={['Date', 'Description', 'Category', 'Mode', 'Reference', 'Remarks', 'Credit', 'Debit', 'Running balance', 'Actions']}>{rows.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="p-3">{entry.date}</td><td className="p-3">{entry.description}{entry.source !== 'Manual' && <span className="ml-2 text-xs text-slate-400">Source: {entry.source}</span>}</td><td className="p-3">{entry.category || '-'}</td><td className="p-3">{entry.paymentMode || 'Cash'}</td><td className="p-3">{entry.reference || '-'}</td><td className="p-3">{entry.remarks || '-'}</td><td className="p-3 text-emerald-700">{entry.type === 'Credit' ? money(entry.amount) : '-'}</td><td className="p-3 text-rose-700">{entry.type === 'Debit' ? money(entry.amount) : '-'}</td><td className="p-3 font-bold">{money(entry.running)}</td><td className="p-3">{isAdmin && <div className="flex gap-1"><CompactAction title="Edit entry" disabled={!isAdmin} onClick={() => { setSelectedCashbookId(entry.id); setModal('editCashbook') }}><Edit3 size={14} /></CompactAction><CompactAction title="Delete entry and linked record" danger onClick={() => { setSelectedCashbookId(entry.id); setModal('confirmDeleteCashbook') }}><Trash2 size={14} /></CompactAction></div>}</td></tr>)}</DataTable><p className="text-xs text-slate-500">Deleting an entry also removes its linked source record and recalculates affected balances.</p></>}{financeTab === 'Expenses' && <><div className="no-print flex flex-wrap items-end gap-3"><div className="w-full sm:w-72"><Field label="Category"><SearchableSelect value={expenseCategory} onChange={(v) => setExpenseCategory(v)} options={['All Categories', ...branchCategories.map((c) => c.name).sort()]} placeholder="Search / select category..." /></Field></div><Button tone="soft" onClick={() => setShowManageCategories(true)}><Settings size={16} /> Manage Categories</Button><Button tone="red" onClick={() => setModal('expense')}><Plus size={16} /> Add Expense</Button></div>{selectedLedgerData ? <><div className="rounded-lg border border-slate-400 bg-white p-4"><h2 className="text-lg font-bold text-slate-900">{selectedLedgerData.name}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-slate-50 p-3"><p className="text-sm text-slate-500">Total Paid</p><p className="text-xl font-black text-rose-700">{money(selectedLedgerData.total)}</p></div><div className="rounded-md bg-slate-50 p-3"><p className="text-sm text-slate-500">Transactions</p><p className="text-xl font-black text-slate-900">{selectedLedgerData.count}</p></div></div></div><DataTable headers={['Date', 'Description', 'Amount', 'Payment Method', 'Reference']}>{selectedLedgerData.entries.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="p-3">{entry.date}</td><td className="p-3">{entry.description}</td><td className="p-3 text-rose-700 font-semibold">{money(entry.amount)}</td><td className="p-3">{entry.paymentMode || '-'}</td><td className="p-3 text-xs text-slate-500">{entry.reference || entry.linkedId || '-'}</td></tr>)}</DataTable></> : <><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-lg border border-slate-400 bg-white p-4"><p className="text-sm text-slate-500">Total Categories</p><p className="text-2xl font-black text-slate-900">{categoryLedger.filter((c) => c.count > 0).length}</p></div><div className="rounded-lg border border-slate-400 bg-white p-4"><p className="text-sm text-slate-500">Total Entries</p><p className="text-2xl font-black text-slate-900">{categoryLedger.reduce((s, c) => s + c.count, 0)}</p></div><div className="rounded-lg border border-slate-400 bg-white p-4"><p className="text-sm text-slate-500">Total Paid</p><p className="text-2xl font-black text-rose-700">{money(categoryLedger.reduce((s, c) => s + c.total, 0))}</p></div></div><DataTable headers={['Date', 'Category', 'Description', 'Amount', 'Payment Method']}>{allBranchDebits.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="p-3">{entry.date}</td><td className="p-3">{entry.category || '-'}</td><td className="p-3">{entry.description}</td><td className="p-3 text-rose-700">{money(entry.amount)}</td><td className="p-3">{entry.paymentMode || '-'}</td></tr>)}</DataTable></>}{showManageCategories && <ManageCategoriesModal branchCategories={branchCategories} data={data} branch={branch} updateData={updateData} role={role} currentUser={currentUser} onClose={() => setShowManageCategories(false)} />}</>}{financeTab === 'Bill Creator' && <BillCreator scoped={scoped} data={data} branch={branch} setSelectedTenantId={setSelectedTenantId} />}</div>
}

function BillCreator({ scoped, data, branch, setSelectedTenantId }: { scoped: ReturnType<typeof branchData>; data: AppData; branch: Branch; setSelectedTenantId: (value: string) => void }) {
  const [tenantId, setTenantId] = useState(scoped.activeTenants[0]?.id || '')
  const tenant = scoped.activeTenants.find((item) => item.id === tenantId)
  const room = tenant ? data.rooms.find((item) => item.id === tenant.roomId) : undefined
  if (!tenant || !room) return <Card>No tenant available for invoice generation.</Card>
  const rentState = scoped.rentStates.get(tenant.id) || getRentLedgerState(tenant, scoped.payments, scoped.obligations)
  const balance = rentState.pending
  const electricity = tenant.electricity === 'Fixed' ? tenant.electricityAmount : 0
  const status = rentState.status
  const invoice = data.invoices.find((item) => item.tenantId === tenant.id) ?? { number: `PG95-${tenant.id.toUpperCase()}`, period: 'June 1 - June 30, 2026' }
  return <div className="invoice-layout grid gap-4 lg:grid-cols-[320px_1fr]"><Card className="no-print"><Field label="Select tenant"><select value={tenantId} onChange={(event) => { setTenantId(event.target.value); setSelectedTenantId(event.target.value) }} className={inputClass}>{scoped.activeTenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></Card><article className="invoice-sheet print-surface rounded-lg border border-slate-400 bg-white p-8 shadow-sm"><header className="flex items-start justify-between border-b-2 border-slate-900 pb-5"><div><p className="text-xs font-bold uppercase text-blue-600">PG 95 Admin Portal</p><h2 className="mt-1 text-3xl font-black">{branch.name}</h2><p className="mt-1 text-sm text-slate-500">{branch.address}</p></div><div className="text-right"><h3 className="text-2xl font-black">INVOICE</h3><p className="mt-1 text-sm">{invoice.number}</p></div></header><section className="grid grid-cols-2 gap-6 border-b border-slate-200 py-5 text-sm"><div><p className="text-xs font-bold uppercase text-slate-400">Bill to</p><p className="mt-2 text-lg font-bold">{tenant.name}</p><p><b>Phone:</b> {tenant.phone}</p><p>Room {room.number} · {room.type}</p></div><div className="text-right"><p><b>Billing period:</b> {invoice.period}</p><p className="mt-2"><b>Invoice date:</b> {formatDate(today)}</p><p className="mt-2"><b>Due date:</b> {formatDate(rentState.dueDate)}</p></div></section><table className="my-5 w-full text-sm"><thead><tr className="border-b bg-slate-50 text-left"><th className="p-3">Description</th><th className="p-3 text-right">Amount</th></tr></thead><tbody><tr className="border-b"><td className="p-3">Monthly rent</td><td className="p-3 text-right">{money(tenant.monthlyRent)}</td></tr><tr className="border-b"><td className="p-3">Electricity charge</td><td className="p-3 text-right">{electricity ? money(electricity) : 'Included'}</td></tr><tr className="border-b"><td className="p-3">Security deposit on record</td><td className="p-3 text-right">{money(tenant.security)}</td></tr></tbody></table><section className="ml-auto grid max-w-sm gap-2 text-sm"><p className="flex justify-between"><span>Total payable</span><b>{money(getTenantDue(tenant))}</b></p><p className="flex justify-between text-emerald-700"><span>Amount paid</span><b>- {money(rentState.received + rentState.advanceApplied)}</b></p><p className="flex justify-between border-t-2 border-slate-900 pt-3 text-lg"><span>Balance due</span><b>{money(balance)}</b></p><p className="mt-2 flex justify-between"><span>Payment status</span><Badge tone={status === 'Paid' ? 'green' : status === 'Overdue' ? 'red' : 'orange'}>{status}</Badge></p></section><footer className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-500">Computer-generated invoice · Thank you</footer><div className="no-print mt-6 flex justify-end gap-2"><Button tone="soft" onClick={() => window.print()}><Printer size={16} /> Print</Button><Button tone="blue" onClick={() => window.print()}><Download size={16} /> Download / Save PDF</Button></div></article></div>
}

function InventoryPage({ scoped, filter, setFilter, setModal, setSelectedInventoryId, canAdd }: { scoped: ReturnType<typeof branchData>; filter: string; setFilter: (value: string) => void; setModal: (value: string) => void; setSelectedInventoryId: (value: string) => void; canAdd: boolean }) {
  const items = scoped.inventory.filter((item) => filter === 'All' || item.category === filter)
  return <div className="grid gap-4"><div className="grid gap-4 md:grid-cols-2"><Metric icon={<Boxes />} label="Total items quantity" value={scoped.inventory.reduce((sum, item) => sum + item.stock, 0)} /><Metric icon={<ClipboardList />} label="Item types" value={scoped.inventory.length} /></div><Tabs values={['All', 'Furniture', 'Linen', 'Kitchen', 'Electrical', 'Housekeeping']} value={filter} onChange={setFilter} />{canAdd && <Button tone="green" onClick={() => setModal('purchase')}><PackagePlus size={16} /> Add Purchase</Button>}<DataTable headers={['Item', 'Category', 'Current stock', 'Unit', 'Last purchase', 'History']}>{items.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{item.name}</td><td className="p-3">{item.category}</td><td className="p-3">{item.stock}</td><td className="p-3">{item.unit}</td><td className="p-3">{item.lastPurchase}</td><td className="p-3"><Button tone="soft" onClick={() => { setSelectedInventoryId(item.id); setModal('inventoryHistory') }}><History size={15} /> Purchase history</Button></td></tr>)}</DataTable></div>
}

function MaintenancePage({ data, scoped, filter, setFilter, setModal, setSelectedTicketId, canResolve, canCreate, branch }: { data: AppData; scoped: ReturnType<typeof branchData>; filter: string; setFilter: (value: string) => void; setModal: (value: string) => void; setSelectedTicketId: (value: string) => void; canResolve: boolean; canCreate: boolean; branch: Branch }) {
  const tickets = scoped.tickets.filter((ticket) => filter === 'All' || (filter === 'Active' ? ticket.status !== 'Resolved' : ticket.status === filter))
  return <div className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><Tabs values={['All', 'Active', 'Open', 'In Progress', 'Resolved']} value={filter} onChange={setFilter} /><div className="flex flex-wrap gap-2">{branch.maintenanceToken && <Button tone="soft" onClick={() => setModal('maintenanceQR')}><QrCode size={16} /> Branch Maintenance QR</Button>}{canCreate && <Button tone="blue" onClick={() => setModal('ticket')}><Plus size={16} /> New Request</Button>}</div></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tickets.map((ticket) => { const room = data.rooms.find((item) => item.id === ticket.roomId); const tenant = data.tenants.find((item) => item.id === ticket.tenantId); const isPublicRequest = ticket.category === 'Tenant Request'; const tenantName = isPublicRequest ? (ticket.description.match(/^Tenant Name:\s*(.+)$/m)?.[1] || '') : ''; const mobile = isPublicRequest ? (ticket.description.match(/^Mobile:\s*(.+)$/m)?.[1] || '') : ''; return <Card key={ticket.id}><div className="flex items-start justify-between gap-2"><h2 className="font-bold">{ticket.title}</h2><Badge tone={ticket.status === 'Resolved' ? 'green' : ticket.status === 'Open' ? 'red' : 'orange'}>{ticket.status}</Badge></div><p className="mt-3 text-sm text-slate-500">Room {room?.number} {tenant ? `· ${tenant.name}` : ''}</p>{ticket.ticketNumber && <p className="mt-1 text-xs text-slate-400">Ticket: {ticket.ticketNumber}</p>}{isPublicRequest && <div className="mt-2 rounded-md bg-blue-50 p-2 text-sm"><p><b>Tenant:</b> {tenantName}</p><p><b>Mobile:</b> {mobile}</p></div>}<p className="mt-2 text-sm">{ticket.category} · {ticket.priority}</p><p className="mt-2 text-sm">Raised {formatDate(ticket.raisedDate)}</p><p className="mt-2 text-sm font-semibold">Assigned: {ticket.assignedTo}</p>{canResolve && <div className="mt-4 flex gap-2">{ticket.status === 'Resolved' ? <Button tone="soft" onClick={() => { setSelectedTicketId(ticket.id); setModal('reopenTicket') }}>Reopen</Button> : <Button tone="green" onClick={() => { setSelectedTicketId(ticket.id); setModal('resolveTicket') }}>Resolve</Button>}</div>}</Card> })}</div></div>
}

function ReportsPage({ scoped, data, branch, reportRange, setReportRange, onExport }: { scoped: ReturnType<typeof branchData>; data: AppData; branch: Branch; reportRange: string; setReportRange: (value: string) => void; onExport?: (type: string, format: string) => void }) {
  const rentReceived = paymentTotal(scoped.payments, 'Rent')
  const securityReceived = paymentTotal(scoped.payments, 'Security Deposit')
  const electricityReceived = paymentTotal(scoped.payments, 'Electricity')
  const otherReceived = paymentTotal(scoped.payments, 'Other')
  const paidTenants = scoped.activeTenants.filter((tenant) => ['Paid', 'Clear'].includes(scoped.rentStates.get(tenant.id)?.status || '')).length
  const pendingTenants = scoped.activeTenants.filter((tenant) => scoped.rentStates.get(tenant.id)?.status === 'Pending').length
  const overdueTenants = scoped.activeTenants.filter((tenant) => scoped.rentStates.get(tenant.id)?.status === 'Overdue').length
  const categoryExpenses = Object.entries(scoped.expenses.reduce<Record<string, number>>((acc, expense) => ({ ...acc, [expense.category]: (acc[expense.category] || 0) + expense.amount }), {}))
  const csv = `Metric,Value\nRent received,${rentReceived}\nSecurity received,${securityReceived}\nElectricity received,${electricityReceived}\nOther received,${otherReceived}\nTotal income,${scoped.revenue}\nTotal expenses,${scoped.expensesTotal}\nPending rent,${scoped.pendingRent}\nPending security,${scoped.pendingSecurity}\nAdvance balance,${scoped.advanceBalance}\nCash balance,${scoped.cashBalance}\nNet profit,${scoped.net}\nTotal tenants,${scoped.activeTenants.length}\nOccupancy rate,${scoped.occupancyRate}%`
  return <div className="grid gap-4"><div className="no-print flex flex-wrap items-center justify-between gap-3"><Tabs values={['Monthly Summary', 'Quarterly Summary', 'Yearly Summary', 'Custom date range']} value={reportRange} onChange={setReportRange} /><div className="flex gap-2"><Button tone="soft" onClick={() => { window.print(); onExport?.('Report', 'Print') }}><Printer size={16} /> Print report</Button><Button tone="blue" onClick={() => { downloadText('pg95-report.csv', csv); onExport?.('Report', 'CSV') }}><Download size={16} /> Export Excel/CSV</Button><Button tone="soft" onClick={() => { window.print(); onExport?.('Report', 'PDF') }}><FileText size={16} /> Download PDF</Button></div></div><Card className="print-surface"><h2 className="text-2xl font-black">{branch.name} - {reportRange}</h2><p className="text-sm text-slate-500">{branch.address}</p><div className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-4">{[['Rent received', money(rentReceived)], ['Security received', money(securityReceived)], ['Electricity received', money(electricityReceived)], ['Other received', money(otherReceived)], ['Pending rent', money(scoped.pendingRent)], ['Pending security', money(scoped.pendingSecurity)], ['Advance balance', money(scoped.advanceBalance)], ['Security held', money(scoped.securityLedger.filter((item) => item.type === 'received').reduce((sum, item) => sum + item.amount, 0) - scoped.securityLedger.filter((item) => item.type === 'refunded').reduce((sum, item) => sum + item.amount, 0))], ['Total income', money(scoped.revenue)], ['Total expenses', money(scoped.expensesTotal)], ['Net profit', money(scoped.net)], ['Total tenants', scoped.activeTenants.length], ['New admissions', scoped.activeTenants.filter((tenant) => tenant.joiningDate.startsWith(currentMonth)).length], ['Vacated tenants', scoped.leftTenants.length], ['Occupancy rate', `${scoped.occupancyRate}%`], ['Paid tenants', paidTenants], ['Pending tenants', pendingTenants], ['Overdue tenants', overdueTenants], ['Maintenance tickets', scoped.tickets.length], ['Inventory purchases', scoped.purchases.length]].map(([label, value]) => <div key={label} className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-black">{value}</p></div>)}</div><div className="mt-5 grid gap-4 lg:grid-cols-3"><Card><h3 className="font-bold">Category-wise expenses</h3>{categoryExpenses.map(([category, amount]) => <p key={category} className="mt-2 flex justify-between text-sm"><span>{category}</span><b>{money(amount)}</b></p>)}</Card><Card><h3 className="font-bold">Room-wise occupancy</h3>{scoped.rooms.map((room) => <p key={room.id} className="mt-2 flex justify-between text-sm"><span>Room {room.number}</span><b>{scoped.activeTenants.filter((tenant) => tenant.roomId === room.id).length}/{room.beds}</b></p>)}</Card><Card><h3 className="font-bold">Branch performance</h3>{data.branches.map((item) => { const stats = branchData(data, item.id); return <p key={item.id} className="mt-2 flex justify-between text-sm"><span>{item.name}</span><b>{money(stats.net)}</b></p> })}</Card></div></Card></div>
}

function SettingsPage({ data, branch, role, isAdmin, setModal, setSelectedUserId, onDeactivateUser, onReactivateUser, onResetPassword, onToggleBranch }: { data: AppData; branch: Branch; role: Role; isAdmin: boolean; setModal: (value: string) => void; setSelectedUserId: (value: string) => void; onDeactivateUser: (user: User) => void; onReactivateUser: (user: User) => void; onResetPassword: (userId: string) => void; onToggleBranch: (branch: Branch, active: boolean) => void }) {
  const [userFilter, setUserFilter] = useState('All')
  const [moduleFilter, setModuleFilter] = useState('All')
  const [actionFilter, setActionFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState('')
  const [search, setSearch] = useState('')
  const logs = data.activityLogs.filter((log) => log.branchId === branch.id && (userFilter === 'All' || log.userId === userFilter) && (moduleFilter === 'All' || log.module === moduleFilter) && (actionFilter === 'All' || log.actionType === actionFilter) && (!dateFilter || log.at.startsWith(dateFilter)) && (!search || `${log.description} ${log.actionType} ${log.module}`.toLowerCase().includes(search.toLowerCase())))
  return <div className="grid gap-4"><Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Branch & Access</h2><p className="mt-1 text-sm text-slate-500">{branch.name} · {branch.address}</p></div>{isAdmin && <Button tone="soft" onClick={() => setModal('editBranch')}><Edit3 size={16} /> Edit Branch</Button>}</div><div className="mt-4 grid gap-2 text-sm"><p>Current role: <b>{role}</b></p><p><b>Admin:</b> Full branch, master-data, finance, inventory and audit access.</p><p><b>Staff:</b> View and add operational entries; existing records and admin settings remain protected.</p></div></Card>{isAdmin && <><Card><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Staff Management</h2><Button onClick={() => setModal('addStaff')}><UserPlus size={16} /> Add Staff</Button></div><div className="mt-4 grid gap-2">{data.users.filter((user) => user.role === 'Staff').map((user) => <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3"><div><b>{user.name}</b><p className="text-xs text-slate-500">{user.username} · {user.active === false ? 'Deactivated' : user.branchIds.map((id) => data.branches.find((item) => item.id === id)?.name).join(', ')}</p></div><div className="flex gap-2">{user.active !== false && <><Button tone="soft" onClick={() => { setSelectedUserId(user.id); setModal('editStaff') }}><Edit3 size={15} /> Edit</Button><Button tone="red" onClick={() => onDeactivateUser(user)}>Deactivate</Button></>}</div></div>)}</div></Card><Card><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Admin Users</h2><Button onClick={() => setModal('addAdmin')}><UserPlus size={16} /> Add Admin</Button></div><div className="mt-4 grid gap-2">{data.users.filter((user) => user.role === 'Admin').map((user) => <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3"><div><b>{user.name}</b><p className="text-xs text-slate-500">{user.username} · {user.active === false ? 'Deactivated' : 'Active'}</p></div><div className="flex gap-2">{user.active !== false ? <><Button tone="soft" onClick={() => onResetPassword(user.id)}><Key size={15} /> Reset Password</Button><Button tone="red" onClick={() => onDeactivateUser(user)}>Deactivate</Button></> : <Button tone="green" onClick={() => onReactivateUser(user)}>Reactivate</Button>}</div></div>)}</div></Card><Card><h2 className="text-xl font-bold">Branch Lifecycle</h2><div className="mt-4 grid gap-2">{data.branches.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3"><span><b>{item.name}</b><br /><small>{item.active === false ? 'Deactivated' : 'Active'}</small></span>{item.id !== branch.id && <Button tone={item.active === false ? 'green' : 'red'} onClick={() => onToggleBranch(item, item.active === false)}>{item.active === false ? 'Reactivate' : 'Deactivate'}</Button>}</div>)}</div></Card></>}{isAdmin && <Card><h2 className="text-xl font-bold">Activity Log</h2><div className="mt-4 grid gap-3 md:grid-cols-5"><select className={inputClass} value={userFilter} onChange={(event) => setUserFilter(event.target.value)}><option>All</option>{data.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><select className={inputClass} value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}><option>All</option>{Array.from(new Set(data.activityLogs.map((log) => log.module))).map((entity) => <option key={entity}>{entity}</option>)}</select><select aria-label="Filter action type" className={inputClass} value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}><option>All</option>{Array.from(new Set(data.activityLogs.map((log) => log.actionType))).map((action) => <option key={action}>{action}</option>)}</select><input aria-label="Filter activity date" className={inputClass} type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /><input aria-label="Search activity" className={inputClass} placeholder="Search activity..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="mt-4 grid max-h-[520px] gap-2 overflow-auto">{logs.map((log) => { const user = data.users.find((item) => item.id === log.userId); return <div key={log.id} className="rounded-md bg-slate-50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{log.actionType}</b><span>{formatDateTime(log.at)}</span></div><p className="mt-1 text-slate-600">{user?.name} · {log.role} · {log.branchName} · Module: {log.module}</p><p className="mt-2 font-medium text-slate-800">{log.description}</p></div> })}{!logs.length && <p className="text-sm text-slate-500">No matching activity.</p>}</div></Card>}</div>
}

function Tabs({ values, value, onChange }: { values: string[]; value: string; onChange: (value: string) => void }) {
  return <div className="no-print flex flex-wrap gap-2">{values.map((item) => <button type="button" key={item} onClick={() => onChange(item)} className={`rounded-md px-3 py-2 text-sm font-bold ${value === item ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-400'}`}>{item}</button>)}</div>
}

function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{headers.map((header) => <th key={header} className="whitespace-nowrap p-3">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div></Card>
}

type RejoinPayload = { paymentRequestId: string; roomId: string; rejoinDate: string; dueDate: string; monthlyRent: number; rentReceived: number; paymentDate: string; paymentMode: string }

function RejoinTenantModal({ tenant, rooms, activeTenants, onClose, onSubmit }: { tenant: Tenant; rooms: Room[]; activeTenants: Tenant[]; onClose: () => void; onSubmit: (payload: RejoinPayload) => Promise<void> }) {
  const availableRooms = rooms.filter((room) => room.status !== 'Maintenance' && activeTenants.filter((item) => item.roomId === room.id).length < room.beds)
  const [roomId, setRoomId] = useState(availableRooms[0]?.id || '')
  const [rejoinDate, setRejoinDate] = useState(today)
  const [dueDate, setDueDate] = useState(today)
  const [monthlyRent, setMonthlyRent] = useState(tenant.monthlyRent)
  const [rentReceived, setRentReceived] = useState(0)
  const [paymentDate, setPaymentDate] = useState(today)
  const [paymentMode, setPaymentMode] = useState('Cash')
  const [paymentRequestId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return <Modal title={`Rejoin ${tenant.name}`} onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); if (saving) return; setSaving(true); setError(''); try { await onSubmit({ paymentRequestId, roomId, rejoinDate, dueDate, monthlyRent, rentReceived, paymentDate, paymentMode }); onClose() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Tenant could not be rejoined.') } finally { setSaving(false) } }}>
    <div className="md:col-span-2 rounded-md bg-blue-50 p-3 text-sm"><b>{tenant.name}</b><p className="mt-1 text-slate-600">{tenant.phone} · Previous stay: {formatDate(tenant.joiningDate)} to {formatDate(tenant.left?.leftDate)}</p><p className="mt-1 text-slate-600">Existing profile, security and complete ledger will continue.</p></div>
    <Field label="New room"><select className={inputClass} value={roomId} onChange={(event) => setRoomId(event.target.value)} required>{availableRooms.map((room) => <option key={room.id} value={room.id}>Room {room.number} · {activeTenants.filter((item) => item.roomId === room.id).length}/{room.beds} occupied</option>)}</select></Field>
    <Field label="Rejoin date"><input className={inputClass} type="date" value={rejoinDate} onChange={(event) => { const next = event.target.value; setRejoinDate(next); setDueDate(next); if (rentReceived === 0) setPaymentDate(next) }} required /></Field>
    <Field label="Monthly rent"><input className={inputClass} type="number" min="0" step="0.01" value={monthlyRent || ''} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setMonthlyRent(Number(event.target.value))} required /></Field>
    <Field label="Rent due date"><input className={inputClass} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></Field>
    <Field label="Rent received at rejoin"><input className={inputClass} type="number" min="0" step="0.01" value={rentReceived || ''} placeholder="0" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setRentReceived(Number(event.target.value))} /></Field>
    <Field label="Payment date"><input className={inputClass} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required={rentReceived > 0} disabled={rentReceived <= 0} /></Field>
    <Field label="Payment mode"><select className={inputClass} value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)} disabled={rentReceived <= 0}><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option></select></Field>
    {!availableRooms.length && <p className="md:col-span-2 rounded-md bg-orange-50 p-3 text-sm text-orange-800">No vacant bed is currently available.</p>}
    {error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button tone="green" type="submit" disabled={saving || !roomId}>{saving ? 'Rejoining...' : 'Rejoin Tenant'}</Button></div>
  </form></Modal>
}

function TenantLedgerModal({ tenant, data, onClose }: { tenant: Tenant; data: AppData; onClose: () => void }) {
  const ledgerStartPeriod = '2026-03'
  const ledgerStartDate = '2026-03-01'
  const room = data.rooms.find((item) => item.id === tenant.roomId)
  const payments = data.payments.filter((item) => item.tenantId === tenant.id && item.date >= ledgerStartDate).sort((a, b) => b.date.localeCompare(a.date))
  const obligations = data.obligations.filter((item) => item.tenantId === tenant.id && (item.period === 'one-time' || item.period >= ledgerStartPeriod)).sort((a, b) => b.period.localeCompare(a.period))
  const security = data.securityLedger.filter((item) => item.tenantId === tenant.id && item.date >= ledgerStartDate).sort((a, b) => b.date.localeCompare(a.date))
  const advances = data.advances.filter((item) => item.tenantId === tenant.id && item.date >= ledgerStartDate).sort((a, b) => b.date.localeCompare(a.date))
  const activity = data.activityLogs.filter((item) => item.branchId === tenant.branchId && item.description.toLowerCase().includes(tenant.name.toLowerCase())).sort((a, b) => b.at.localeCompare(a.at))
  const admissionRent = [...obligations].reverse().find((item) => item.paymentType === 'Rent')?.agreed ?? tenant.monthlyRent
  const knownRentPeriods = new Set([
    ...obligations.filter((item) => item.paymentType === 'Rent').map((item) => item.period),
    ...payments.filter((item) => item.paymentType === 'Rent' && item.month >= ledgerStartPeriod).map((item) => item.month),
    ...(importedRentPaidMonths[tenant.name.trim().toUpperCase()] || []).filter((period) => period >= ledgerStartPeriod),
  ])
  if (!knownRentPeriods.size) knownRentPeriods.add(currentMonth)
  const rentHistory = Array.from(knownRentPeriods).sort().reverse().map((period) => {
    const obligation = obligations.find((item) => item.paymentType === 'Rent' && item.period === period)
    const agreed = obligation?.agreed ?? tenant.monthlyRent
    const recorded = payments.filter((item) => item.paymentType === 'Rent' && item.month === period).reduce((sum, item) => sum + item.amount, 0)
    const imported = (importedRentPaidMonths[tenant.name.trim().toUpperCase()] || []).includes(period) ? agreed : 0
    const advanceApplied = obligation?.advanceApplied ?? advances.filter((item) => item.type === 'used' && item.period === period).reduce((sum, item) => sum + item.amount, 0)
    const received = Math.max(obligation?.received ?? 0, recorded, imported)
    return { id: obligation?.id || `derived-${tenant.id}-${period}`, period, agreed, received, advanceApplied, dueDate: obligation?.dueDate || rentDueDateForPeriod(tenant.dueDate, period), status: obligation?.status || (received + advanceApplied >= agreed ? 'Paid' : received + advanceApplied > 0 ? 'Partial' : 'Pending') }
  })
  const advanceRemaining = advances.reduce((sum, item) => sum + (item.type === 'credit' ? item.amount : -item.amount), 0)
  const totalPaid = payments.reduce((sum, item) => sum + item.amount, 0)
  const paymentTotalFor = (type: Payment['paymentType']) => payments.filter((item) => item.paymentType === type).reduce((sum, item) => sum + item.amount, 0)
  return <Modal title={`${tenant.name} - Tenant Ledger`} onClose={onClose}>
    <div className="grid gap-4">
      <p className="rounded-md bg-blue-50 p-3 text-sm font-semibold text-blue-800">Financial ledger history starts from March 2026, matching the supplied register.</p>
      <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-slate-50 p-3 text-sm"><p><b>Room:</b> {room?.number || 'Archived room'}{tenant.bedNo ? ` · Bed ${tenant.bedNo}` : ''}</p><p className="mt-1"><b>Joined:</b> {formatDate(tenant.joiningDate)}</p><p className="mt-1"><b>Status:</b> {tenant.status}</p>{tenant.left && <p className="mt-1"><b>Left:</b> {formatDate(tenant.left.leftDate)} · {tenant.left.reason}</p>}</div><div className="rounded-md bg-slate-50 p-3 text-sm"><p><b>Phone:</b> {tenant.phone}</p><p className="mt-1"><b>Current rent:</b> {money(tenant.monthlyRent)}</p><p className="mt-1"><b>Security:</b> {money(tenant.securityReceived)} received of {money(tenant.security)}</p></div></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><div className="rounded-md bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Total paid</p><b>{money(totalPaid)}</b></div><div className="rounded-md bg-blue-50 p-3"><p className="text-xs text-blue-700">Rent paid</p><b>{money(paymentTotalFor('Rent'))}</b></div><div className="rounded-md bg-blue-50 p-3"><p className="text-xs text-blue-700">Security paid</p><b>{money(paymentTotalFor('Security Deposit'))}</b></div><div className="rounded-md bg-blue-50 p-3"><p className="text-xs text-blue-700">Other paid</p><b>{money(paymentTotalFor('Electricity') + paymentTotalFor('Other'))}</b></div><div className="rounded-md bg-orange-50 p-3"><p className="text-xs text-orange-700">Advance remaining</p><b>{money(Math.max(0, advanceRemaining))}</b></div></div>
      <section><h3 className="mb-2 font-bold">Monthly Rent & Rate History</h3><DataTable headers={['Rent month', 'Rent agreed', 'Received', 'Advance used', 'Balance', 'Due date', 'Status']}>{rentHistory.map((item) => { const balance = Math.max(0, item.agreed - item.received - item.advanceApplied); return <tr key={item.id} className="border-t border-slate-100"><td className="p-3">{formatMonth(item.period)}</td><td className="p-3 font-semibold">{money(item.agreed)}</td><td className="p-3 text-emerald-700">{money(item.received)}</td><td className="p-3">{money(item.advanceApplied)}</td><td className="p-3 text-rose-700">{money(balance)}</td><td className="p-3">{formatDate(item.dueDate)}</td><td className="p-3"><Badge tone={balance === 0 ? 'green' : item.received + item.advanceApplied > 0 ? 'orange' : 'red'}>{balance === 0 ? 'Paid' : item.received + item.advanceApplied > 0 ? 'Partial' : item.status}</Badge></td></tr> })}</DataTable></section>
      <section><h3 className="mb-2 font-bold">Complete Payment History</h3><DataTable headers={['Payment date', 'For month', 'Payment head', 'Amount', 'Mode', 'Description', 'Cashbook']}>{payments.map((payment) => { const cashbook = data.cashbook.find((entry) => entry.linkedId === payment.id); return <tr key={payment.id} className="border-t border-slate-100"><td className="p-3">{formatDate(payment.date)}</td><td className="p-3">{payment.month === 'one-time' ? '-' : formatMonth(payment.month)}</td><td className="p-3">{payment.paymentType}</td><td className="p-3 font-semibold text-emerald-700">{money(payment.amount)}</td><td className="p-3">{payment.paymentMode}</td><td className="p-3">{payment.description || '-'}</td><td className="p-3">{cashbook ? cashbook.description : '-'}</td></tr>})}{!payments.length && <tr><td className="p-3 text-slate-500" colSpan={7}>No payments recorded.</td></tr>}</DataTable></section>
      {security.length > 0 && <section><h3 className="mb-2 font-bold">Security History</h3><DataTable headers={['Date', 'Movement', 'Amount', 'Reason']}>{security.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3">{formatDate(item.date)}</td><td className="p-3 capitalize">{item.type}</td><td className="p-3">{money(item.amount)}</td><td className="p-3">{item.reason || '-'}</td></tr>)}</DataTable></section>}
      {advances.length > 0 && <section><h3 className="mb-2 font-bold">Advance History</h3><DataTable headers={['Date', 'Movement', 'Amount', 'Rent month', 'Description']}>{advances.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3">{formatDate(item.date)}</td><td className="p-3 capitalize">{item.type === 'credit' ? 'Advance received' : item.type === 'used' ? 'Advance adjusted' : 'Advance refunded'}</td><td className="p-3">{money(item.amount)}</td><td className="p-3">{item.period ? formatMonth(item.period) : '-'}</td><td className="p-3">{item.description || '-'}</td></tr>)}</DataTable></section>}
      <section><h3 className="mb-2 font-bold">Tenant Activity Timeline</h3><div className="grid gap-2"><div className="rounded-md border-l-4 border-blue-500 bg-slate-50 p-3 text-sm"><b>{tenant.joiningDate >= ledgerStartDate ? `${formatDate(tenant.joiningDate)} · Admission` : '01/03/2026 · Opening record'}</b><p className="mt-1 text-slate-600">{tenant.joiningDate >= ledgerStartDate ? `Admitted to Room ${room?.number || '-'}.` : 'Tenant active when the supplied register begins.'} Rent {money(admissionRent)}.</p></div>{(tenant.rejoins || []).map((item, index) => <div key={`${item.rejoinDate}-${index}`} className="rounded-md border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm"><b>{formatDate(item.rejoinDate)} · Rejoined</b><p className="mt-1">Room {data.rooms.find((room) => room.id === item.roomId)?.number || '-'} · Rent {money(item.monthlyRent)} · Paid at rejoin {money(item.initialRentReceived)}</p></div>)}{activity.map((item) => <div key={item.id} className="rounded-md border-l-4 border-slate-300 bg-slate-50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{item.actionType}</b><span>{formatDateTime(item.at)}</span></div><p className="mt-1 text-slate-600">{item.description}</p></div>)}{tenant.left && <div className="rounded-md border-l-4 border-rose-500 bg-rose-50 p-3 text-sm"><b>{formatDate(tenant.left.leftDate)} · Vacated</b><p className="mt-1">{tenant.left.reason}. Exit balance {money(tenant.left.finalRentBalance)}.</p></div>}</div></section>
      <div className="flex justify-end"><Button tone="soft" onClick={onClose}>Close Ledger</Button></div>
    </div>
  </Modal>
}

function CashbookModal({ entry, categories, branches, branchId, onClose, onSubmit }: { entry?: CashbookEntry; categories: string[]; branches: Branch[]; branchId: string; onClose: () => void; onSubmit: (entry: CashbookFormEntry) => void }) {
  const [type, setType] = useState<EntryType>(entry?.type || 'Credit')
  const [amount, setAmount] = useState(entry?.amount || 0)
  const [description, setDescription] = useState(entry?.description || '')
  const [date, setDate] = useState(entry?.date || today)
  const defaultCategories = ['Uncategorized', 'Rent', 'Security Deposit', 'Electricity', 'Other Income', 'Grocery', 'Vegetables', 'Gas Cylinder', 'Staff Salary', 'Maintenance', 'Inventory', 'Miscellaneous']
  const options = Array.from(new Set([...defaultCategories, ...categories, ...(entry?.category ? [entry.category] : [])])).sort((a, b) => a.localeCompare(b))
  const [category, setCategory] = useState(entry?.category || 'Uncategorized')
  const existingInterBranch = parseInterBranchReference(entry?.reference)
  const existingPartner = parsePartnerReference(entry?.reference)
  const otherBranches = branches.filter((item) => item.id !== branchId)
  const [interBranch, setInterBranch] = useState(Boolean(existingInterBranch))
  const [partnerEntry, setPartnerEntry] = useState(Boolean(existingPartner))
  const [partnerName, setPartnerName] = useState(existingPartner || '')
  const [counterpartyBranchId, setCounterpartyBranchId] = useState(existingInterBranch?.counterpartyBranchId || otherBranches[0]?.id || '')
  const [dueAmount, setDueAmount] = useState(existingInterBranch?.amount || 0)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const form = new FormData(event.currentTarget)
      const selectedCategory = category === '__new__' ? String(form.get('newCategory') || '').trim() : category
      const structuredReference = partnerEntry && type === 'Debit' ? `PTL|${encodeURIComponent(partnerName.trim())}` : interBranch ? `${type === 'Debit' ? 'IBR' : 'IBS'}|${counterpartyBranchId}|${dueAmount}` : String(form.get('reference') || '')
      onSubmit({ type, amount, description, date, category: partnerEntry && type === 'Debit' ? 'Partner Account' : interBranch && type === 'Credit' ? 'Inter-branch Settlement' : selectedCategory || 'Uncategorized', paymentMode: String(form.get('paymentMode')), reference: structuredReference, remarks: String(form.get('remarks')) })
      onClose()
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Modal title={entry ? 'Edit Cashbook Entry' : 'Add Cashbook Entry'} onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}><div className="md:col-span-2"><p className="mb-1 text-sm font-semibold text-slate-700">Transaction type</p><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={type === 'Credit'} onClick={() => { setType('Credit'); setPartnerEntry(false) }} className={`rounded-md border px-4 py-3 text-sm font-bold transition ${type === 'Credit' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-emerald-50'}`}>Credit / In</button><button type="button" aria-pressed={type === 'Debit'} onClick={() => setType('Debit')} className={`rounded-md border px-4 py-3 text-sm font-bold transition ${type === 'Debit' ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-rose-50'}`}>Debit / Out</button></div></div><Field label="Amount"><input className={inputClass} type="number" min="0.01" step="0.01" required value={amount || ''} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setAmount(Number(event.target.value))} /></Field><Field label="Description"><input className={inputClass} required value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="Date"><input className={inputClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Category"><select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}<option value="__new__">+ New Category</option></select></Field>{category === '__new__' && <Field label="New category"><input name="newCategory" className={inputClass} placeholder="Enter category name" required autoFocus /></Field>}<div className="md:col-span-2 flex items-center justify-between rounded-md border border-slate-400 p-3"><span className="text-sm font-semibold">Inter-branch lena / dena</span><input aria-label="Inter-branch entry" type="checkbox" checked={interBranch} onChange={(event) => { setInterBranch(event.target.checked); if (event.target.checked) setPartnerEntry(false) }} className="h-5 w-5 accent-blue-600" /></div>{interBranch && <><Field label="Other branch"><select className={inputClass} value={counterpartyBranchId} onChange={(event) => setCounterpartyBranchId(event.target.value)} required>{otherBranches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label={type === 'Debit' ? 'Amount to receive from branch' : 'Settlement received from branch'}><input className={inputClass} type="number" min="0.01" max={amount || undefined} step="0.01" value={dueAmount || ''} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setDueAmount(Number(event.target.value))} required /></Field></>}{type === 'Debit' && <><div className="md:col-span-2 flex items-center justify-between rounded-md border border-slate-400 p-3"><div><p className="text-sm font-semibold">Partner personal withdrawal</p><p className="text-xs text-slate-500">Partner ne personal paise liye</p></div><input aria-label="Partner ledger entry" type="checkbox" checked={partnerEntry} onChange={(event) => { setPartnerEntry(event.target.checked); if (event.target.checked) setInterBranch(false) }} className="h-5 w-5 accent-blue-600" /></div>{partnerEntry && <Field label="Partner name"><input className={inputClass} list="partner-names" value={partnerName} onChange={(event) => setPartnerName(event.target.value)} placeholder="Ashish, Pawan, Gouransh..." required /><datalist id="partner-names"><option value="Ashish" /><option value="Pawan" /><option value="Gouransh" /></datalist></Field>}</>}<Field label="Cash / Online"><select name="paymentMode" className={inputClass} defaultValue={entry?.paymentMode || 'Cash'}><option>Cash</option><option>Online</option><option>UPI</option><option>Bank Transfer</option><option>Card</option></select></Field>{!interBranch && !partnerEntry && <Field label="Reference"><input name="reference" className={inputClass} defaultValue={entry?.reference} /></Field>}<Field label="Remarks"><input name="remarks" className={inputClass} defaultValue={entry?.remarks} /></Field><div className="flex justify-end gap-2 md:col-span-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button disabled={saving} tone={type === 'Credit' ? 'green' : 'red'} type="submit">{entry ? 'Save Changes' : type === 'Credit' ? 'Add Credit' : 'Add Debit'}</Button></div></form></Modal>
}

type TenantEditChanges = {
  name: string
  phone: string
  email: string
  roomId: string
  bedNo: number
  joiningDate: string
  monthlyRent: number
  security: number
  electricity: Tenant['electricity']
  electricityAmount: number
  dueDate: string
  idProof: string
  status: Exclude<TenantStatus, 'Left'>
  rentPeriod: string
  rentBalance: number
  rentDueDate: string
  adjustRentLedger: boolean
  applyRentToPending: boolean
}

type TenantRentState = ReturnType<typeof getRentLedgerState>

function EditTenantModal({ tenant, rentState, rooms, tenants, onClose, onSubmit }: { tenant: Tenant; rentState: TenantRentState; rooms: Room[]; tenants: Tenant[]; onClose: () => void; onSubmit: (changes: TenantEditChanges) => Promise<void> }) {
  const [roomId, setRoomId] = useState(tenant.roomId)
  const [rentBalance, setRentBalance] = useState(rentState.pending)
  const [rentDueDate, setRentDueDate] = useState(rentState.dueDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const available = rooms.filter((room) => room.id === tenant.roomId || (room.status !== 'Maintenance' && tenants.filter((item) => item.roomId === room.id && item.id !== tenant.id).length < room.beds))

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const form = new FormData(event.currentTarget)
    const room = rooms.find((item) => item.id === roomId)
    if (!room) { setError('Select a valid room.'); return }
    const occupants = tenants.filter((item) => item.roomId === roomId && item.id !== tenant.id)
    const occupiedBeds = new Set(occupants.map((item) => item.bedNo))
    const nextFreeBed = Array.from({ length: room.beds }, (_, index) => index + 1).find((bed) => !occupiedBeds.has(bed))
    const bedNo = roomId === tenant.roomId ? tenant.bedNo : nextFreeBed
    if (!bedNo) { setError(`Room ${room.number} has no vacant bed.`); return }
    const balanceChanged = Math.abs(rentBalance - rentState.pending) > 0.009
    const dueDateChanged = rentDueDate !== rentState.dueDate
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        name: String(form.get('name')).trim().toUpperCase(),
        phone: String(form.get('phone')),
        email: String(form.get('email') || ''),
        roomId,
        bedNo,
        joiningDate: String(form.get('joiningDate')),
        monthlyRent: Number(form.get('monthlyRent')),
        security: Number(form.get('security')),
        electricity: String(form.get('electricity')) as Tenant['electricity'],
        electricityAmount: Number(form.get('electricityAmount')),
        dueDate: dueDateChanged ? rentDueDate : tenant.dueDate,
        idProof: String(form.get('idProof') || '').replace(/\s/g, ''),
        status: String(form.get('status')) as Exclude<TenantStatus, 'Left'>,
        rentPeriod: rentState.period,
        rentBalance,
        rentDueDate,
        adjustRentLedger: balanceChanged || dueDateChanged,
        applyRentToPending: form.get('applyRentToPending') === 'on',
      })
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Tenant could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Edit Tenant" onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
    <Field label="Tenant name"><input name="name" className={inputClass} defaultValue={tenant.name} required /></Field>
    <Field label="Phone"><input name="phone" className={inputClass} defaultValue={tenant.phone} required /></Field>
    <Field label="Email"><input name="email" className={inputClass} type="email" defaultValue={tenant.email} placeholder="Optional" /></Field>
    <Field label="Room number"><select className={inputClass} value={roomId} onChange={(event) => setRoomId(event.target.value)}>{available.map((room) => <option key={room.id} value={room.id}>Room {room.number} · {tenants.filter((item) => item.roomId === room.id && item.id !== tenant.id).length}/{room.beds} occupied</option>)}</select></Field>
    <Field label="Joining date"><input name="joiningDate" className={inputClass} type="date" defaultValue={tenant.joiningDate} /></Field>
    <Field label="Monthly rent"><input name="monthlyRent" className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.monthlyRent} /></Field>
    <Field label="Security deposit"><input name="security" className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.security} /></Field>
    <Field label="Electricity option"><select name="electricity" className={inputClass} defaultValue={tenant.electricity}><option>Included</option><option>Fixed</option></select></Field>
    <Field label="Electricity amount"><input name="electricityAmount" className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.electricityAmount} /></Field>
    <Field label="Aadhaar number"><input name="idProof" className={inputClass} inputMode="numeric" maxLength={12} pattern="[0-9]{12}" title="Enter a 12-digit Aadhaar number" defaultValue={tenant.idProof.replace(/\s/g, '')} placeholder="Optional, 12 digits" /></Field>
    <Field label="Status"><select name="status" className={inputClass} defaultValue={tenant.status}><option>Active</option><option>Notice</option><option>Needs Verification</option></select></Field>

    <div className="md:col-span-2 grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div><p className="font-bold text-amber-900">Rent Ledger Adjustment</p><p className="text-xs text-amber-800">Period: {formatMonth(rentState.period)} · Already received: {money(rentState.received)} · Advance applied: {money(rentState.advanceApplied)}</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Current rent balance"><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={rentBalance} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setRentBalance(Math.max(0, Number(event.target.value)))} required /></Field>
        <Field label="Current rent due date"><input className={inputClass} type="date" value={rentDueDate} onChange={(event) => setRentDueDate(event.target.value)} required /></Field>
      </div>
      <p className="text-xs text-amber-800"><b>Safe edit:</b> changing these fields adjusts only this rent ledger obligation. Existing payments, cashbook entries, invoices, security entries and old activity history are not deleted or rewritten.</p>
    </div>

    <label className="md:col-span-2 flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"><input name="applyRentToPending" type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" /><span><b>Apply new monthly rent to other existing unpaid months</b><br /><span className="text-slate-500">Off by default so a normal detail edit never changes old rent ledger entries.</span></span></label>
    {error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Tenant'}</Button></div>
  </form></Modal>
}

type InitialAdmissionPayment = { rentAmount: number; securityAmount: number; paymentDate: string; paymentMode: string }

function AdmitTenantModal({ rooms, tenants, canReceivePayment, onClose, onSubmit }: { rooms: Room[]; tenants: Tenant[]; canReceivePayment: boolean; onClose: () => void; onSubmit: (requestId: string, paymentRequestId: string, tenant: Omit<Tenant, 'id' | 'branchId' | 'status' | 'paidThisMonth' | 'securityReceived' | 'securityBalance'>, initialPayment: InitialAdmissionPayment) => Promise<void> }) {
  const roomVacancy = (room: Room) => room.beds - tenants.filter((t) => t.roomId === room.id).length
  const availableRooms = rooms.filter((room) => roomVacancy(room) > 0 && room.status !== 'Maintenance')
  const [roomId, setRoomId] = useState(availableRooms[0]?.id || '')
  const [requestId] = useState(() => crypto.randomUUID())
  const [paymentRequestId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [monthlyRent, setMonthlyRent] = useState(6500)
  const [security, setSecurity] = useState('2500')
  const room = rooms.find((item) => item.id === roomId) || availableRooms[0]
  const occupied = tenants.filter((tenant) => tenant.roomId === roomId).map((tenant) => tenant.bedNo)
  const nextBed = Array.from({ length: room?.beds || 1 }, (_, index) => index + 1).find((bed) => !occupied.includes(bed)) || 1
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setSaving(true); setError('')
    try {
      await onSubmit(
        requestId,
        paymentRequestId,
        { name: String(form.get('name')).trim().toUpperCase(), phone: String(form.get('phone')), email: String(form.get('email')), roomId, bedNo: nextBed, joiningDate: String(form.get('joiningDate')), dueDate: String(form.get('dueDate') || form.get('joiningDate')), monthlyRent, security: Number(security), electricity: String(form.get('electricity')) as 'Included' | 'Fixed', electricityAmount: Number(form.get('electricityAmount') || 0), idProof: String(form.get('idProof') || '').replace(/\s/g, '') },
        { rentAmount: Number(form.get('initialRent') || 0), securityAmount: Number(form.get('initialSecurity') || 0), paymentDate: String(form.get('paymentDate') || form.get('joiningDate')), paymentMode: String(form.get('paymentMode') || 'Cash') },
      )
      formElement.reset(); onClose()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Tenant could not be admitted.') }
    finally { setSaving(false) }
  }
  return <Modal title="New Tenant Admission" onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={submit}><Field label="Full name"><input name="name" className={inputClass} required /></Field><Field label="Phone"><input name="phone" className={inputClass} required /></Field><Field label="Email"><input name="email" className={inputClass} type="email" placeholder="Optional" /></Field><Field label="Room selection"><select className={inputClass} value={roomId} onChange={(event) => setRoomId(event.target.value)}>{availableRooms.map((item) => { const vacant = roomVacancy(item); return <option key={item.id} value={item.id}>Room {item.number} — {vacant} {vacant === 1 ? 'bed vacant' : 'beds vacant'}</option> })}</select></Field><Field label="Joining date"><input name="joiningDate" className={inputClass} type="date" defaultValue={today} required /></Field><Field label="Rent Due Date / Rent Date"><input name="dueDate" className={inputClass} type="date" defaultValue={today} required /></Field><Field label="Monthly rent"><input className={inputClass} type="number" min="0" value={String(monthlyRent)} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setMonthlyRent(Number(event.target.value))} required /></Field><Field label="Security deposit"><input className={inputClass} type="number" min="0" value={security} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setSecurity(event.target.value)} required /></Field><Field label="Electricity option"><select name="electricity" className={inputClass}><option>Included</option><option>Fixed</option></select></Field><Field label="Fixed electricity amount"><input name="electricityAmount" className={inputClass} type="number" min="0" defaultValue={room?.electricityAmount || 0} /></Field><Field label="Aadhaar number"><input name="idProof" className={inputClass} inputMode="numeric" maxLength={12} pattern="[0-9]{12}" title="Enter a 12-digit Aadhaar number" placeholder="Optional, 12 digits" /></Field>{canReceivePayment && <><div className="md:col-span-2 border-t border-slate-200 pt-3 text-sm font-bold text-slate-700">Payment received at admission</div><Field label="Rent received"><input name="initialRent" className={inputClass} type="number" min="0" defaultValue={0} /></Field><Field label="Security received"><input name="initialSecurity" className={inputClass} type="number" min="0" defaultValue={0} /></Field><Field label="Payment date"><input name="paymentDate" className={inputClass} type="date" defaultValue={today} required /></Field><Field label="Payment mode"><select name="paymentMode" className={inputClass}><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option></select></Field></>}{error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button tone="blue" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Admit Tenant'}</Button></div></form></Modal>
}

type SplitPaymentInput = { requestId: string; tenantId: string; rentAmount: number; securityAmount: number; electricityAmount: number; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }

function PaymentModal({ tenants, payments, obligations, selectedTenantId, onClose, onSubmit }: { tenants: Tenant[]; payments: Payment[]; obligations: PaymentObligation[]; selectedTenantId: string; onClose: () => void; onSubmit: (payment: SplitPaymentInput) => Promise<void> }) {
  const [tenantId, setTenantId] = useState(selectedTenantId || tenants[0]?.id || '')
  const [paymentMode, setPaymentMode] = useState('Cash')
  const [paymentDate, setPaymentDate] = useState(today)
  const [requestId] = useState(() => crypto.randomUUID())
  const [rentAmount, setRentAmount] = useState(0)
  const [securityAmount, setSecurityAmount] = useState(0)
  const [electricityAmount, setElectricityAmount] = useState(0)
  const [otherAmount, setOtherAmount] = useState(0)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const tenant = tenants.find((item) => item.id === tenantId)
  const rentState = tenant ? getRentLedgerState(tenant, payments, obligations) : undefined
  const rentBalance = rentState?.pending || 0
  const securityReceived = tenant ? Math.max(tenant.securityReceived || 0, paymentTotal(payments, 'Security Deposit', tenant.id, null)) : 0
  const securityBalance = tenant ? Math.max(0, tenant.security - securityReceived) : 0
  const isFirstTimeSecurity = (tenant?.security || 0) === 0 && (tenant?.securityReceived || 0) === 0
  const selectTenant = (id: string) => {
    setTenantId(id); setRentAmount(0); setSecurityAmount(0); setElectricityAmount(0); setOtherAmount(0); setError('')
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return
    const form = new FormData(event.currentTarget)
    if (rentAmount + securityAmount + electricityAmount + otherAmount <= 0) { setError('Enter at least one payment amount.'); return }
    if (securityAmount > 0 && !isFirstTimeSecurity && securityAmount > securityBalance) { setError(`Security amount (${money(securityAmount)}) exceeds remaining balance of ${money(securityBalance)}.`); return }
    savingRef.current = true; setSaving(true); setError('')
    try {
      await onSubmit({ requestId, tenantId, rentAmount, securityAmount, electricityAmount, otherAmount, paymentDate, rentPeriod: rentState?.period, paymentMode, description: String(form.get('description') || '') })
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Payment could not be saved.')
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Modal title="Add Received Payment" onClose={onClose}><form className="grid gap-4" onSubmit={submit}><Field label="Tenant"><select className={inputClass} value={tenantId} onChange={(event) => selectTenant(event.target.value)}>{tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 text-sm"><p>Rent balance ({rentState?.period || '-'})<br /><b>{money(rentBalance)}</b></p><p>Rent due date<br /><b>{formatDate(rentState?.dueDate)}</b></p><p>Security balance<br /><b>{money(securityBalance)}</b></p><p>Security received<br /><b className="text-emerald-700">{money(securityReceived)}</b></p><p>Security total<br /><b>{money(tenant?.security || 0)}</b></p></div>{isFirstTimeSecurity && <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2">This tenant has no security deposit on record. The amount you enter will set their total security deposit.</p>}<div className="grid gap-4 sm:grid-cols-2"><Field label="Rent received"><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={rentAmount || ''} placeholder="0" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setRentAmount(Number(event.target.value))} /></Field><Field label={`Security deposit received${isFirstTimeSecurity ? ' (first-time)' : ''}`}><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" max={isFirstTimeSecurity ? undefined : securityBalance} value={securityAmount || ''} placeholder={isFirstTimeSecurity ? 'Enter total security amount' : '0'} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setSecurityAmount(Number(event.target.value))} /></Field><Field label="Electricity received"><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={electricityAmount || ''} placeholder="0" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setElectricityAmount(Number(event.target.value))} /></Field><Field label="Other received"><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={otherAmount || ''} placeholder="0" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setOtherAmount(Number(event.target.value))} /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Payment date"><input name="paymentDate" className={inputClass} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></Field><Field label="Rent month being settled"><input className={inputClass} value={rentState?.period ? formatMonth(rentState.period) : '-'} disabled /></Field><Field label="Payment mode"><select className={inputClass} value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option></select></Field></div><Field label="Description/source optional"><input name="description" className={inputClass} /></Field>{error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button tone="green" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Payment'}</Button></div></form></Modal>
}

function NoticeModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (notice: NonNullable<Tenant['notice']>) => void }) {
  return <Modal title="Issue Vacating Notice" onClose={onClose}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ noticeDate: String(form.get('noticeDate')), expectedLeavingDate: String(form.get('expectedLeavingDate')), reason: String(form.get('reason')) }); onClose() }}><Field label="Notice date"><input name="noticeDate" className={inputClass} type="date" defaultValue={today} /></Field><Field label="Expected leaving date"><input name="expectedLeavingDate" className={inputClass} type="date" defaultValue="2026-06-30" /></Field><Field label="Reason"><textarea name="reason" className={inputClass} required /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button tone="blue" type="submit">Issue Notice</Button></div></form></Modal>
}

function VacateModal({ tenant, dueDate, alreadyReceived = 0, onClose, onSubmit }: { tenant: Tenant; dueDate: string; alreadyReceived?: number; onClose: () => void; onSubmit: (left: NonNullable<Tenant['left']>, settlementRequestId: string) => Promise<void> }) {
  const [leftDate, setLeftDate] = useState(today)
  const [settlementReceived, setSettlementReceived] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [settlementRequestId] = useState(() => crypto.randomUUID())
  const extraDays = Math.max(0, Math.ceil((new Date(`${leftDate}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) / 86400000))
  const extraRentCharge = extraDays * 500
  const balanceBeforeSettlement = Math.max(0, extraRentCharge - alreadyReceived)
  const finalRentBalance = Math.max(0, balanceBeforeSettlement - settlementReceived)
  return <Modal title="Vacate Tenant" onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); if (saving) return; const form = new FormData(event.currentTarget); setSaving(true); setError(''); try { await onSubmit({ leftDate, reason: String(form.get('reason')), finalRentBalance, electricityBalance: Number(form.get('electricityBalance')), maintenanceDeduction: Number(form.get('maintenanceDeduction')), securityRefund: Number(form.get('securityRefund')), finalSettlement: settlementReceived, extraDays, extraRentCharge, alreadyReceived, balanceBeforeSettlement, settlementReceived }, settlementRequestId); onClose() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Tenant could not be vacated.') } finally { setSaving(false) } }}><Field label="Tenant"><input className={inputClass} value={tenant.name} disabled /></Field><Field label="Left date"><input name="leftDate" className={inputClass} type="date" value={leftDate} onChange={(event) => { setLeftDate(event.target.value); setSettlementReceived(0) }} required /></Field><Field label="Reason"><input name="reason" className={inputClass} required /></Field><Field label="Current rent due date"><input className={inputClass} value={formatDate(dueDate)} disabled /></Field><div className="md:col-span-2 grid grid-cols-3 gap-3 rounded-md bg-orange-50 p-3 text-sm"><p>Extra days<br /><b>{extraDays}</b></p><p>Rate per day<br /><b>{money(500)}</b></p><p>Extra-days rent charge<br /><b>{money(extraRentCharge)}</b></p></div><div className="md:col-span-2 grid grid-cols-2 gap-3 rounded-md bg-blue-50 p-3 text-sm"><p>Already received for this due cycle<br /><b>{money(alreadyReceived)}</b></p><p>Balance before settlement<br /><b>{money(balanceBeforeSettlement)}</b></p></div><Field label="Settlement received (new money only)"><input className={inputClass} type="number" min="0" value={settlementReceived || ''} placeholder="0" onChange={(event) => setSettlementReceived(Number(event.target.value))} /></Field><Field label="Final rent balance"><input className={inputClass} value={money(finalRentBalance)} disabled /></Field><Field label="Electricity balance"><input name="electricityBalance" className={inputClass} type="number" min="0" defaultValue={0} /></Field><Field label="Maintenance deduction"><input name="maintenanceDeduction" className={inputClass} type="number" min="0" defaultValue={0} /></Field><Field label="Security refund"><input name="securityRefund" className={inputClass} type="number" min="0" defaultValue={0} /></Field>{error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button tone="red" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Final Settlement'}</Button></div></form></Modal>
}

function ExpenseModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (expense: Omit<Expense, 'id' | 'branchId'>) => void }) {
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const form = new FormData(event.currentTarget)
      onSubmit({ category: String(form.get('category')) as ExpenseCategory, description: String(form.get('description')), amount: Number(form.get('amount')), date: String(form.get('date')), vendor: String(form.get('vendor')) })
      onClose()
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Modal title="Add Expense" onClose={onClose}><form className="grid gap-4" onSubmit={handleSubmit}><Field label="Category"><select name="category" className={inputClass}>{['Grocery', 'Vegetables', 'Gas Cylinder', 'Staff Salary', 'Miscellaneous'].map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Description"><input name="description" className={inputClass} required /></Field><Field label="Amount"><input name="amount" className={inputClass} type="number" required /></Field><Field label="Date"><input name="date" className={inputClass} type="date" defaultValue={today} /></Field><Field label="Vendor/note"><input name="vendor" className={inputClass} /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button disabled={saving} tone="red" type="submit">Add Expense</Button></div></form></Modal>
}

function ManageCategoriesModal({ branchCategories, data, branch, updateData, role, currentUser, onClose }: { branchCategories: Category[]; data: AppData; branch: Branch; updateData: (updater: (previous: AppData) => AppData, action: string, entity: string, description?: string, metadata?: Record<string, string | number>) => void; role: Role; currentUser: User; onClose: () => void }) {
  const [addName, setAddName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const handleAdd = () => {
    if (!addName.trim()) return
    const id = uid('cat')
    updateData((prev) => ({ ...prev, categories: [{ id, branchId: branch.id, name: addName.trim() }, ...prev.categories] }), 'Add Category', 'Finance', `${role} ${currentUser.name} added category "${addName.trim()}".`)
    setAddName('')
  }
  const handleRename = (id: string) => {
    if (!editName.trim()) return
    const old = data.categories.find((c) => c.id === id)
    updateData((prev) => ({ ...prev, categories: prev.categories.map((c) => c.id === id ? { ...c, name: editName.trim() } : c) }), 'Rename Category', 'Finance', `${role} ${currentUser.name} renamed category from "${old?.name}" to "${editName.trim()}".`)
    setEditId(null)
    setEditName('')
  }
  const handleDelete = (id: string) => {
    const cat = data.categories.find((c) => c.id === id)
    if (!cat || !confirm(`Permanently delete category "${cat.name}"? Existing transactions under this category will become Uncategorized.`)) return
    updateData((prev) => ({ ...prev, categories: prev.categories.filter((c) => c.id !== id), cashbook: prev.cashbook.map((e) => e.categoryId === id ? { ...e, categoryId: undefined, category: e.category || 'Uncategorized' } : e), expenses: prev.expenses.map((e) => e.categoryId === id ? { ...e, categoryId: undefined } : e) }), 'Delete Category', 'Finance', `${role} ${currentUser.name} deleted category "${cat.name}".`)
  }
  return <Modal title="Manage Categories" onClose={onClose} wide>
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2"><Field label="New category name"><input className={inputClass} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Enter category name" /></Field><div className="pt-6"><Button tone="blue" onClick={handleAdd}><Plus size={15} /> Add</Button></div></div>
      <hr className="border-slate-200" />
      <div className="grid gap-2">{branchCategories.length === 0 ? <p className="text-sm text-slate-500">No categories yet.</p> : branchCategories.map((cat) => <div key={cat.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 p-3">{editId === cat.id ? <div className="flex flex-1 flex-wrap items-center gap-2"><input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleRename(cat.id); if (e.key === 'Escape') { setEditId(null); setEditName('') }}} /><Button tone="green" onClick={() => handleRename(cat.id)}>Save</Button><Button tone="soft" onClick={() => { setEditId(null); setEditName('') }}>Cancel</Button></div> : <><span className="font-medium text-slate-900">{cat.name}</span><div className="flex gap-1"><CompactAction title="Rename" onClick={() => { setEditId(cat.id); setEditName(cat.name) }}><Edit3 size={14} /></CompactAction><CompactAction title="Delete" danger onClick={() => handleDelete(cat.id)}><Trash2 size={14} /></CompactAction></div></>}</div>)}</div>
    </div>
  </Modal>
}

function PurchaseModal({ items, onClose, onSubmit }: { items: InventoryItem[]; onClose: () => void; onSubmit: (payload: { mode: string; itemId: string; name: string; category: InventoryCategory; unit: string; quantity: number; unitCost: number; date: string; note: string }) => void }) {
  const [mode, setMode] = useState('Existing Item')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const form = new FormData(event.currentTarget)
      onSubmit({ mode, itemId: String(form.get('itemId') || ''), name: String(form.get('name') || ''), category: String(form.get('category') || 'Furniture') as InventoryCategory, unit: String(form.get('unit') || 'pcs'), quantity: Number(form.get('quantity')), unitCost: Number(form.get('unitCost') || 0), date: String(form.get('date')), note: String(form.get('note') || '') })
      onClose()
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Modal title="Add Stock Purchase" onClose={onClose}><form className="grid gap-4" onSubmit={handleSubmit}><Tabs values={['Existing Item', 'New Item']} value={mode} onChange={setMode} />{mode === 'Existing Item' ? <Field label="Select item"><select name="itemId" className={inputClass} required>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stock} {item.unit}</option>)}</select></Field> : <><Field label="Item name"><input name="name" className={inputClass} required /></Field><Field label="Category"><select name="category" className={inputClass}>{['Furniture', 'Linen', 'Kitchen', 'Electrical', 'Housekeeping'].map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Unit"><input name="unit" className={inputClass} defaultValue="pcs" required /></Field></>}<Field label="Quantity"><input name="quantity" className={inputClass} type="number" min="1" defaultValue={1} required /></Field><Field label="Unit cost (optional)"><input name="unitCost" className={inputClass} type="number" min="0" step="0.01" placeholder="0" /></Field><Field label="Purchase date"><input name="date" className={inputClass} type="date" defaultValue={today} required /></Field><Field label="Vendor/note"><input name="note" className={inputClass} /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button disabled={saving} tone="green" type="submit">Add Purchase</Button></div></form></Modal>
}

function addPurchase(previous: AppData, branchId: string, payload: { mode: string; itemId: string; name: string; category: InventoryCategory; unit: string; quantity: number; unitCost: number; date: string; note: string }): AppData {
  const itemId = payload.mode === 'New Item' ? uid('iv') : payload.itemId
  const amount = payload.quantity * payload.unitCost
  const purchaseId = uid('ip')
  const expenseId = amount > 0 ? uid('e') : undefined
  const cashbookId = amount > 0 ? uid('c') : undefined
  const inventoryCatId = previous.categories.find((c) => c.branchId === branchId && c.name === 'Inventory')?.id
  return {
    ...previous,
    inventory: payload.mode === 'New Item'
      ? [{ id: itemId, branchId, name: payload.name, category: payload.category, unit: payload.unit || 'pcs', stock: payload.quantity, reorderAt: 5, lastPurchase: payload.date }, ...previous.inventory]
      : previous.inventory.map((item) => item.id === itemId ? { ...item, stock: item.stock + payload.quantity, lastPurchase: payload.date } : item),
    purchases: [{ id: purchaseId, branchId, itemId, quantity: payload.quantity, unitCost: payload.unitCost, date: payload.date, note: payload.note, expenseId, cashbookId }, ...previous.purchases],
    expenses: amount > 0 ? [{ id: expenseId!, branchId, category: 'Inventory', categoryId: inventoryCatId, description: `Inventory purchase - ${payload.mode === 'New Item' ? payload.name : previous.inventory.find((item) => item.id === itemId)?.name}`, amount, date: payload.date, vendor: payload.note }, ...previous.expenses] : previous.expenses,
    cashbook: amount > 0 ? [{ id: cashbookId!, branchId, type: 'Debit', amount, description: 'Inventory purchase', date: payload.date, source: 'Inventory', linkedId: purchaseId, category: 'Inventory', categoryId: inventoryCatId }, ...previous.cashbook] : previous.cashbook,
  }
}

function InventoryHistoryModal({ item, purchases, isAdmin, onClose, onEdit, onDelete }: { item: InventoryItem; purchases: InventoryPurchase[]; isAdmin: boolean; onClose: () => void; onEdit: (purchase: InventoryPurchase) => void; onDelete: (purchase: InventoryPurchase) => void }) {
  return <Modal title={`${item.name} Purchase History`} onClose={onClose}>{purchases.length ? <DataTable headers={['Date', 'Quantity', 'Unit cost', 'Total cost', 'Vendor/note', 'Actions']}>{purchases.map((purchase) => <tr key={purchase.id} className="border-t border-slate-100"><td className="p-3">{purchase.date}</td><td className="p-3">{purchase.quantity} {item.unit}</td><td className="p-3">{money(purchase.unitCost)}</td><td className="p-3 font-bold">{money(purchase.quantity * purchase.unitCost)}</td><td className="p-3">{purchase.note || '-'}</td><td className="p-3">{isAdmin && <div className="flex gap-1"><CompactAction title="Edit purchase" onClick={() => onEdit(purchase)}><Edit3 size={14} /></CompactAction><CompactAction title="Delete purchase" danger disabled={!isAdmin} onClick={() => { if (confirm('Delete this purchase and reverse its stock and finance entries?')) onDelete(purchase) }}><Trash2 size={14} /></CompactAction></div>}</td></tr>)}</DataTable> : <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">No recorded purchases for this item yet.</p>}</Modal>
}

function EditPurchaseModal({ purchase, onClose, onSubmit }: { purchase: InventoryPurchase; onClose: () => void; onSubmit: (changes: Pick<InventoryPurchase, 'quantity' | 'unitCost' | 'date' | 'note'>) => void }) {
  return <Modal title="Edit Inventory Purchase" onClose={onClose}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ quantity: Number(form.get('quantity')), unitCost: Number(form.get('unitCost') || 0), date: String(form.get('date')), note: String(form.get('note') || '') }); onClose() }}><Field label="Quantity"><input name="quantity" className={inputClass} type="number" min="1" defaultValue={purchase.quantity} required /></Field><Field label="Unit cost"><input name="unitCost" className={inputClass} type="number" min="0" step="0.01" defaultValue={purchase.unitCost} /></Field><Field label="Purchase date"><input name="date" className={inputClass} type="date" defaultValue={purchase.date} required /></Field><Field label="Vendor/note"><input name="note" className={inputClass} defaultValue={purchase.note} /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit">Save Purchase</Button></div></form></Modal>
}

function editPurchase(previous: AppData, purchaseId: string, changes: Pick<InventoryPurchase, 'quantity' | 'unitCost' | 'date' | 'note'>): AppData {
  const old = previous.purchases.find((purchase) => purchase.id === purchaseId)!
  const amount = changes.quantity * changes.unitCost
  const inventory = previous.inventory.map((item) => item.id === old.itemId ? { ...item, stock: Math.max(0, item.stock - old.quantity + changes.quantity), lastPurchase: changes.date } : item)
  let expenses = previous.expenses.filter((expense) => expense.id !== old.expenseId)
  let cashbook = previous.cashbook.filter((entry) => entry.id !== old.cashbookId)
  let expenseId: string | undefined
  let cashbookId: string | undefined
  if (amount > 0) {
    expenseId = uid('e'); cashbookId = uid('c')
    const inventoryCatId = previous.categories.find((c) => c.branchId === old.branchId && c.name === 'Inventory')?.id
    expenses = [{ id: expenseId, branchId: old.branchId, category: 'Inventory', categoryId: inventoryCatId, description: `Inventory purchase - ${inventory.find((item) => item.id === old.itemId)?.name}`, amount, date: changes.date, vendor: changes.note }, ...expenses]
    cashbook = [{ id: cashbookId, branchId: old.branchId, type: 'Debit', amount, description: 'Inventory purchase', date: changes.date, source: 'Inventory', linkedId: purchaseId, category: 'Inventory', categoryId: inventoryCatId }, ...cashbook]
  }
  return { ...previous, inventory, expenses, cashbook, purchases: previous.purchases.map((purchase) => purchase.id === purchaseId ? { ...purchase, ...changes, expenseId, cashbookId } : purchase) }
}

function deletePurchase(previous: AppData, purchase: InventoryPurchase): AppData {
  return { ...previous, inventory: previous.inventory.map((item) => item.id === purchase.itemId ? { ...item, stock: Math.max(0, item.stock - purchase.quantity) } : item), purchases: previous.purchases.filter((item) => item.id !== purchase.id), expenses: previous.expenses.filter((expense) => expense.id !== purchase.expenseId), cashbook: previous.cashbook.filter((entry) => entry.id !== purchase.cashbookId) }
}

function ResolveTicketModal({ ticket, room, onClose, onSubmit }: { ticket: MaintenanceTicket; room?: Room; onClose: () => void; onSubmit: (resolution: NonNullable<MaintenanceTicket['resolution']>, markAvailable: boolean) => void }) {
  const [markAvailable, setMarkAvailable] = useState(room?.status === 'Maintenance')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const form = new FormData(event.currentTarget)
      onSubmit({ date: String(form.get('date')), note: String(form.get('note')), cost: Number(form.get('cost') || 0), vendor: String(form.get('vendor') || '') }, markAvailable)
      onClose()
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Modal title={`Resolve: ${ticket.title}`} onClose={onClose}><form className="grid gap-4" onSubmit={handleSubmit}><Field label="Resolution date"><input name="date" className={inputClass} type="date" defaultValue={today} required /></Field><Field label="Resolution note"><textarea name="note" className={inputClass} required /></Field><Field label="Repair cost optional"><input name="cost" className={inputClass} type="number" min="0" defaultValue="0" /></Field><Field label="Vendor/worker name optional"><input name="vendor" className={inputClass} /></Field>{room?.status === 'Maintenance' && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={markAvailable} onChange={(event) => setMarkAvailable(event.target.checked)} /> Mark room available again</label>}<div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button disabled={saving} tone="green" type="submit">Resolve Ticket</Button></div></form></Modal>
}

function CreateBranchModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (branch: Omit<Branch, 'id' | 'active'>) => void }) {
  return <Modal title="Add New Branch" onClose={onClose}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ name: String(form.get('name')), address: String(form.get('address')), floors: Number(form.get('floors') || 0), notes: String(form.get('notes') || ''), contact: String(form.get('contact') || '') }) }}><Field label="Branch name"><input name="name" className={inputClass} required /></Field><Field label="Branch address"><textarea name="address" className={inputClass} required /></Field><Field label="Total floors optional"><input name="floors" className={inputClass} type="number" min="0" /></Field><Field label="Contact number optional"><input name="contact" className={inputClass} /></Field><Field label="Notes optional"><textarea name="notes" className={inputClass} /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit">Add Branch</Button></div></form></Modal>
}

const staffPermissionOptions = [
  ['admit_tenant', 'Can admit tenant'], ['add_payment', 'Can add payment'], ['move_tenant', 'Can move tenant'], ['vacate_tenant', 'Can vacate tenant'], ['add_cashbook', 'Can add cashbook entry'], ['add_expense', 'Can add expense'], ['add_inventory', 'Can add inventory purchase'], ['create_maintenance', 'Can create maintenance ticket'], ['resolve_maintenance', 'Can resolve maintenance ticket'], ['view_reports', 'Can view reports'],
]

function StaffModal({ user, branches, onClose, onSubmit }: { user?: User; branches: Branch[]; onClose: () => void; onSubmit: (staff: Omit<User, 'id' | 'role' | 'active'>) => void }) {
  const [branchIds, setBranchIds] = useState<string[]>(user?.branchIds || [])
  const [permissions, setPermissions] = useState<string[]>(user?.permissions || [])
  const toggle = (list: string[], value: string, setter: (next: string[]) => void) => setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  return <Modal title={user ? 'Edit Staff Member' : 'Add Staff Member'} onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (!branchIds.length) return; onSubmit({ name: String(form.get('name')), phone: String(form.get('phone')), email: String(form.get('email') || ''), username: String(form.get('username')), password: String(form.get('password')), branchIds, permissions }); onClose() }}><Field label="Staff name"><input name="name" className={inputClass} defaultValue={user?.name} required /></Field><Field label="Phone"><input name="phone" className={inputClass} defaultValue={user?.phone} required /></Field><Field label="Email optional"><input name="email" type="email" className={inputClass} defaultValue={user?.email} /></Field><Field label="Username/login ID"><input name="username" className={inputClass} defaultValue={user?.username} required /></Field><Field label="Password"><input name="password" className={inputClass} defaultValue={user?.password || `PG95-${Math.random().toString(36).slice(2, 8)}`} required /></Field><Field label="Role"><input className={inputClass} value="Staff" readOnly /></Field><div className="md:col-span-2"><p className="mb-2 text-sm font-semibold">Assigned branches</p><div className="grid gap-2 sm:grid-cols-2">{branches.map((branch) => <label key={branch.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => toggle(branchIds, branch.id, setBranchIds)} /> {branch.name}</label>)}</div>{!branchIds.length && <p className="mt-1 text-xs text-rose-600">Select at least one branch.</p>}</div><div className="md:col-span-2"><p className="mb-2 text-sm font-semibold">Permissions</p><div className="grid gap-2 sm:grid-cols-2">{staffPermissionOptions.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={permissions.includes(value)} onChange={() => toggle(permissions, value, setPermissions)} /> {label}</label>)}</div></div><div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit">{user ? 'Save Staff' : 'Add Staff'}</Button></div></form></Modal>
}

function AdminModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (staff: { name: string; phone?: string; email?: string; username: string; password?: string }) => void }) {
  return <Modal title="Add Admin User" onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ name: String(form.get('name')), phone: String(form.get('phone')), email: String(form.get('email') || ''), username: String(form.get('username')), password: String(form.get('password')) }); onClose() }}><Field label="Name"><input name="name" className={inputClass} required /></Field><Field label="Phone"><input name="phone" className={inputClass} required /></Field><Field label="Email"><input name="email" type="email" className={inputClass} /></Field><Field label="Username/Login ID"><input name="username" className={inputClass} required /></Field><Field label="Password"><input name="password" className={inputClass} defaultValue={`PG95-${Math.random().toString(36).slice(2, 8)}`} required /></Field><div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit">Add Admin</Button></div></form></Modal>
}

function ResetPasswordModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (newPassword: string) => void }) {
  const [value, setValue] = useState(`PG95-${Math.random().toString(36).slice(2, 8)}`)
  return <Modal title="Reset Password" onClose={onClose}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(value); onClose() }}><Field label="New password"><input className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} required /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit">Update Password</Button></div></form></Modal>
}



function MoveTenantModal({ tenant, rooms, tenants, onClose, onSubmit, onSwap }: { tenant: Tenant; rooms: Room[]; tenants: Tenant[]; onClose: () => void; onSubmit: (roomId: string, bedNo: number, note: string) => void; onSwap: (tenantAId: string, tenantBId: string, tenantARoomId: string, tenantABedNo: number, tenantBRoomId: string, tenantBBedNo: number, note: string) => Promise<void> }) {
  const available = rooms.filter((room) => room.id !== tenant.roomId && room.status !== 'Maintenance')
  const current = rooms.find((room) => room.id === tenant.roomId)
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [selectedBedNo, setSelectedBedNo] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const confirmRef = useRef<HTMLDivElement>(null)
  const selectedRoom = useMemo(() => rooms.find((r) => r.id === selectedRoomId), [rooms, selectedRoomId])
  const beds = useMemo(() => {
    if (!selectedRoom) return []
    const occupants = tenants.filter((t) => t.roomId === selectedRoom.id && t.status !== 'Left')
    return Array.from({ length: selectedRoom.beds }, (_, i) => {
      const bedNo = i + 1
      const occupant = occupants.find((t) => Number(t.bedNo) === bedNo)
      return { bedNo, occupant: occupant || null }
    })
  }, [selectedRoom, tenants])
  const selectedBedOccupant = useMemo(() => {
    if (!selectedRoomId || selectedBedNo === null) return null
    return tenants.find((t) => t.roomId === selectedRoomId && Number(t.bedNo) === selectedBedNo && t.status !== 'Left') || null
  }, [selectedRoomId, selectedBedNo, tenants])
  const handleMove = () => {
    if (savingRef.current || selectedBedNo === null) return
    savingRef.current = true; setSaving(true)
    try { onSubmit(selectedRoomId, selectedBedNo, note); onClose() }
    finally { savingRef.current = false; setSaving(false) }
  }
  const handleSwap = async () => {
    if (savingRef.current || !selectedBedOccupant) return
    savingRef.current = true; setSaving(true)
    try {
      await onSwap(tenant.id, selectedBedOccupant.id, tenant.roomId, Number(tenant.bedNo), selectedBedOccupant.roomId, Number(selectedBedOccupant.bedNo), note)
      onClose()
    } catch { savingRef.current = false; setSaving(false) }
  }
  return <Modal title="Move / Swap Tenant" onClose={onClose}>
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-md bg-slate-50 p-3 text-sm md:grid-cols-2">
        <p><b>Tenant:</b> {tenant.name}</p>
        <p><b>Current:</b> Room {current?.number} • Bed {tenant.bedNo}</p>
      </div>
      <Field label="Select destination room">
        <select className={inputClass} value={selectedRoomId} onChange={(e) => { setSelectedRoomId(e.target.value); setSelectedBedNo(null); setNote('') }}>
          <option value="">-- Select a room --</option>
          {available.map((room) => {
            const count = tenants.filter((t) => t.roomId === room.id && t.status !== 'Left').length
            return <option key={room.id} value={room.id}>Room {room.number} — {count}/{room.beds} {count === 1 ? 'bed' : 'beds'} occupied</option>
          })}
        </select>
      </Field>
      {selectedRoom && <>
        <p className="text-sm font-semibold text-slate-700">Beds in Room {selectedRoom.number}:</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {beds.map((bed) => (
            <button key={bed.bedNo} type="button" onClick={() => { setSelectedBedNo(bed.bedNo); setNote(''); setTimeout(() => confirmRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100) }}
              className={`cursor-pointer rounded-md border p-2.5 text-left text-xs transition ${selectedBedNo === bed.bedNo ? (bed.occupant ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200' : 'border-blue-500 bg-blue-50 ring-2 ring-blue-200') : 'border-slate-200 bg-white hover:border-slate-400'}`}>
              <p className="font-semibold text-slate-800">Bed {bed.bedNo}</p>
              {bed.occupant ? <><p className="mt-0.5 truncate text-slate-700">{bed.occupant.name}</p><p className="text-[11px] font-medium text-rose-600">Occupied</p></>
                : <p className="mt-1 text-[11px] font-medium text-emerald-600">Vacant</p>}
            </button>
          ))}
        </div>
      </>}
      {selectedBedNo !== null && selectedRoom && !selectedBedOccupant && <div ref={confirmRef} className="rounded-md bg-blue-50 p-3">
        <p className="mb-2 text-sm font-semibold text-blue-800">Move to Room {selectedRoom.number} • Bed {selectedBedNo}</p>
        <Field label="Move date (optional)"><input className={inputClass} type="date" defaultValue={today} /></Field>
        <Field label="Note/reason (optional)"><textarea className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end"><Button disabled={saving} onClick={handleMove}>Confirm Move</Button></div>
      </div>}
      {selectedBedOccupant && selectedRoom && <div ref={confirmRef} className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-bold text-amber-800">Replace / Swap with {selectedBedOccupant.name}</p>
        <div className="mt-3 grid gap-2 text-sm">
          <div className="rounded bg-white p-2"><p className="font-semibold">{tenant.name}</p><p className="text-slate-600">Current: Room {current?.number} • Bed {tenant.bedNo}</p><p className="text-slate-600">New: Room {selectedRoom.number} • Bed {selectedBedNo}</p></div>
          <div className="rounded bg-white p-2"><p className="font-semibold">{selectedBedOccupant.name}</p><p className="text-slate-600">Current: Room {selectedRoom.number} • Bed {selectedBedOccupant.bedNo}</p><p className="text-slate-600">New: Room {current?.number} • Bed {tenant.bedNo}</p></div>
        </div>
        <div className="mt-3 flex justify-end"><Button disabled={saving} onClick={handleSwap}>Confirm Swap</Button></div>
      </div>}
      <div className="flex justify-end gap-2">
        <Button tone="soft" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  </Modal>
}

function BranchModal({ branch, onClose, onSubmit, onDelete }: { branch: Branch; onClose: () => void; onSubmit: (changes: Pick<Branch, 'name' | 'address'>) => void; onDelete?: () => void }) {
  return <Modal title="Edit Branch Details" onClose={onClose}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ name: String(form.get('name')), address: String(form.get('address')) }); onClose() }}><Field label="Branch name"><input name="name" className={inputClass} defaultValue={branch.name} required /></Field><Field label="Branch address"><textarea name="address" className={inputClass} defaultValue={branch.address} required /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit">Save Branch</Button></div>{onDelete && <div className="border-t border-rose-200 pt-4"><h4 className="mb-2 text-sm font-bold text-rose-600">Danger Zone</h4><Button tone="red" onClick={onDelete}>Delete this Branch</Button></div>}</form></Modal>
}

function DeleteBranchConfirmModal({ branch, onClose, onConfirm }: { branch: Branch; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const confirm = async () => {
    if (saving) return
    setSaving(true); setError('')
    try { await onConfirm() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Branch deletion failed.') }
    finally { setSaving(false) }
  }
  const exactNameMatch = nameInput === branch.name
  return <Modal title="Delete Branch?" onClose={onClose}><p className="text-sm text-slate-600">This will permanently delete <strong>{branch.name}</strong> and all associated data including rooms, tenants, payments, and transactions. This action cannot be undone.</p>{error && <p className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="mt-4"><Field label={`Type the exact branch name to confirm`}><input className={inputClass} value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder={branch.name} /></Field></div><div className="mt-5 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button tone="red" disabled={!exactNameMatch || saving} onClick={confirm}>{saving ? 'Working...' : 'Delete Permanently'}</Button></div></Modal>
}

function RoomModal({ room, onClose, onSubmit }: { room?: Room; onClose: () => void; onSubmit: (room: Omit<Room, 'id' | 'branchId'>) => void }) {
  return <Modal title={room ? 'Edit Room' : 'Add Room'} onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ number: String(form.get('number')), floor: Number(form.get('floor')), type: String(form.get('type')) as RoomType, beds: Number(form.get('beds')), rent: Number(form.get('rent')), electricity: String(form.get('electricity')) as Room['electricity'], electricityAmount: Number(form.get('electricityAmount') || 0), status: String(form.get('status')) as RoomStatus, notes: String(form.get('notes') || '') }); onClose() }}><Field label="Room number"><input name="number" className={inputClass} defaultValue={room?.number} required /></Field><Field label="Floor"><input name="floor" className={inputClass} type="number" min="0" defaultValue={room?.floor || 1} required /></Field><Field label="Room type"><select name="type" className={inputClass} defaultValue={room?.type || 'Single'}>{['Single', 'Double', 'Triple', 'Suite', 'Custom'].map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Total beds/capacity"><input name="beds" className={inputClass} type="number" min="1" defaultValue={room?.beds || 1} required /></Field><Field label="Rent per month"><input name="rent" className={inputClass} type="number" min="0" defaultValue={room?.rent || 10000} required /></Field><Field label="Electricity option"><select name="electricity" className={inputClass} defaultValue={room?.electricity || 'Included'}><option>Included</option><option>Fixed</option></select></Field><Field label="Fixed electricity amount"><input name="electricityAmount" className={inputClass} type="number" min="0" defaultValue={room?.electricityAmount || 0} /></Field><Field label="Status"><select name="status" className={inputClass} defaultValue={room?.status || 'Vacant'}><option>Vacant</option><option>Occupied</option><option>Maintenance</option></select></Field><Field label="Notes optional"><textarea name="notes" className={inputClass} defaultValue={room?.notes} /></Field><div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit">{room ? 'Save Room' : 'Add Room'}</Button></div></form></Modal>
}

function ConfirmModal({ title, message, confirmLabel = 'Confirm', onClose, onConfirm }: { title: string; message: string; confirmLabel?: string; onClose: () => void; onConfirm: () => void | Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const confirm = async () => {
    if (saving) return
    setSaving(true); setError('')
    try { await onConfirm(); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Action failed.') }
    finally { setSaving(false) }
  }
  return <Modal title={title} onClose={onClose}><p className="text-sm text-slate-600">{message}</p>{error && <p className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button tone="red" disabled={saving} onClick={confirm}>{saving ? 'Working...' : confirmLabel}</Button></div></Modal>
}

function MaintenanceQRModal({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const qrUrl = `https://pg-admin-portal.vercel.app/maintenance/request/${branch.maintenanceToken}`
  const branchName = branch.name

  useEffect(() => {
    if (!canvasRef.current || !branch.maintenanceToken) return
    QRCode.toCanvas(canvasRef.current, qrUrl, { width: 280, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } }, (error) => {
      if (!error && canvasRef.current) {
        setQrDataUrl(canvasRef.current.toDataURL('image/png'))
      }
    })
  }, [branch.maintenanceToken, qrUrl])

  const handleDownload = useCallback(() => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `PG95-${branchName.replace(/\s+/g, '-')}-Maintenance-QR.png`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [qrDataUrl, branchName])

  const handlePrint = useCallback(() => {
    if (!qrDataUrl) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!doctype html><html><head><title>PG 95 - ${branchName} Maintenance QR</title><style>
      body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f7f3ec; }
      .poster { text-align: center; max-width: 420px; }
      .logo { width: 56px; height: 56px; border-radius: 8px; background: #2563eb; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 900; font-size: 24px; }
      h1 { font-size: 24px; margin: 16px 0 4px; color: #0f172a; }
      .branch { font-size: 16px; color: #64748b; margin-bottom: 24px; }
      img { width: 320px; height: 320px; border-radius: 12px; background: #fff; padding: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
      .instruction { margin-top: 20px; font-size: 16px; font-weight: 600; color: #0f172a; }
      .footer { margin-top: 8px; font-size: 12px; color: #94a3b8; }
      @media print { body { padding: 0; } .poster { margin: 0 auto; } img { box-shadow: none; } }
    </style></head><body><div class="poster"><div class="logo">95</div><h1>PG 95</h1><div class="branch">${branchName}</div><img src="${qrDataUrl}" alt="Maintenance QR" /><div class="instruction">Scan to Raise a Maintenance Request</div><div class="footer">pg-admin-portal.vercel.app</div></div><script>window.onload=()=>{window.print()}</script></body></html>`)
    win.document.close()
  }, [qrDataUrl, branchName])

  return <Modal title="Branch Maintenance QR" onClose={onClose}>
    <div className="grid gap-5">
      <div className="text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-blue-600 font-black text-white text-lg">95</div>
        <h2 className="mt-3 text-lg font-bold text-slate-900">PG 95</h2>
        <p className="text-sm text-slate-500">{branchName}</p>
      </div>
      <div className="flex justify-center">
        <div className="rounded-xl bg-white p-3 shadow-md">
          <canvas ref={canvasRef} className="h-56 w-56" />
        </div>
      </div>
      <p className="text-center text-sm text-slate-500">Scan to Raise a Maintenance Request</p>
      <div className="flex justify-center gap-3">
        <Button tone="blue" onClick={handleDownload} disabled={!qrDataUrl}><Download size={16} /> Download QR</Button>
        <Button tone="soft" onClick={handlePrint} disabled={!qrDataUrl}><Printer size={16} /> Print Poster</Button>
      </div>
      <p className="text-center text-xs text-slate-400">Print this poster on A4 paper and display inside the PG branch.</p>
    </div>
  </Modal>
}

function TicketModal({ rooms, tenants, onClose, onSubmit }: { rooms: Room[]; tenants: Tenant[]; onClose: () => void; onSubmit: (ticket: Omit<MaintenanceTicket, 'id' | 'branchId' | 'status'>) => void }) {
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const form = new FormData(event.currentTarget)
      onSubmit({ title: String(form.get('title')), roomId: String(form.get('roomId')), tenantId: String(form.get('tenantId') || ''), category: String(form.get('category')), priority: String(form.get('priority')) as 'Low' | 'Medium' | 'High', assignedTo: String(form.get('assignedTo')), raisedDate: String(form.get('raisedDate')), description: String(form.get('description')) })
      onClose()
    } finally { savingRef.current = false; setSaving(false) }
  }
  return <Modal title="New Maintenance Request" onClose={onClose}><form className="grid gap-4" onSubmit={handleSubmit}><Field label="Issue title"><input name="title" className={inputClass} required /></Field><Field label="Room"><select name="roomId" className={inputClass}>{rooms.map((room) => <option key={room.id} value={room.id}>Room {room.number}</option>)}</select></Field><Field label="Tenant optional"><select name="tenantId" className={inputClass}><option value="">No tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></Field><Field label="Category"><input name="category" className={inputClass} defaultValue="Plumbing" /></Field><Field label="Priority"><select name="priority" className={inputClass}><option>Low</option><option>Medium</option><option>High</option></select></Field><Field label="Assigned to"><input name="assignedTo" className={inputClass} /></Field><Field label="Date"><input name="raisedDate" className={inputClass} type="date" defaultValue={today} /></Field><Field label="Description"><textarea name="description" className={inputClass} /></Field><div className="flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button disabled={saving} tone="blue" type="submit">Create Request</Button></div></form></Modal>
}

function RoomDetailsModal({ room, tenants, tickets, onClose, onAdmit, onMaintenance }: { room: Room; tenants: Tenant[]; tickets: MaintenanceTicket[]; onClose: () => void; onAdmit: () => void; onMaintenance: () => void }) {
  return <Modal title={`Room ${room.number} Details`} onClose={onClose}><div className="grid gap-4"><div className="grid gap-3 md:grid-cols-3">{[['Floor', room.floor], ['Room type', room.type], ['Total beds', room.beds], ['Occupied beds', tenants.length], ['Vacant beds', room.beds - tenants.length], ['Rent', money(room.rent)], ['Electricity type', room.electricity], ['Maintenance status', room.status], ['Payment status', tenants.map(getPaymentStatus).join(', ') || 'No tenants']].map(([label, value]) => <div key={String(label)} className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="font-bold">{value}</p></div>)}</div><Card><h3 className="font-bold">Current tenants</h3>{tenants.map((tenant) => <p key={tenant.id} className="mt-2 text-sm">{tenant.name} · Bed {tenant.bedNo}</p>)}</Card><Card><h3 className="font-bold">Maintenance history</h3>{tickets.map((ticket) => <p key={ticket.id} className="mt-2 text-sm">{ticket.title} · {ticket.status}</p>)}</Card><div className="flex justify-end gap-2"><Button tone="blue" onClick={onAdmit}>Admit tenant to vacant bed</Button><Button tone="red" onClick={onMaintenance}>Mark room maintenance</Button></div></div></Modal>
}

function FiveMonthRegisterModal({ data, scoped, branch, visibleBranches, onClose, onExport }: { data: AppData; scoped: ReturnType<typeof branchData>; branch: Branch; visibleBranches: Branch[]; onClose: () => void; onExport?: (type: string, format: string) => void }) {
  const months = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']
  const availableReportMonths = months.filter((m) => m <= currentMonth)
  const defaultMonth = availableReportMonths.includes(currentMonth) ? currentMonth : availableReportMonths.at(-1) || currentMonth
  const [reportEndMonth, setReportEndMonth] = useState(defaultMonth)
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Vacated'>('All')
  const [roomFilter, setRoomFilter] = useState('All')
  const [branchFilterId, setBranchFilterId] = useState(branch.id)
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)

  const registerMonths = useMemo(() => {
    const [year, month] = reportEndMonth.split('-').map(Number)
    const result: string[] = []
    for (let i = 4; i >= 0; i--) {
      const date = new Date(year, month - 1 - i, 1)
      result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
    }
    return result
  }, [reportEndMonth])

  const filterBranchTenants = useMemo(() => {
    return data.tenants.filter((t) => t.branchId === branchFilterId)
  }, [data.tenants, branchFilterId])

  const filterBranchRooms = useMemo(() => {
    return data.rooms.filter((r) => r.branchId === branchFilterId)
  }, [data.rooms, branchFilterId])

  const firstMonth = registerMonths[0]
  const lastMonth = registerMonths[4]

  const relevantTenants = useMemo(() => {
    return filterBranchTenants.filter((tenant) => {
      const joinMonth = tenant.joiningDate.slice(0, 7)
      if (joinMonth > lastMonth) return false
      if (tenant.left && tenant.left.leftDate.slice(0, 7) < firstMonth) return false
      if (statusFilter === 'Active' && tenant.status === 'Left') return false
      if (statusFilter === 'Vacated' && tenant.status !== 'Left') return false
      if (roomFilter !== 'All' && tenant.roomId !== roomFilter) return false
      return true
    })
  }, [filterBranchTenants, firstMonth, lastMonth, statusFilter, roomFilter])

  const getRoomNumber = (tenant: Tenant) => {
    const room = filterBranchRooms.find((r) => r.id === tenant.roomId)
    return room?.number || ''
  }

  const sortedTenants = useMemo(() => {
    return [...relevantTenants].sort((a, b) => {
      const numA = getRoomNumber(a)
      const numB = getRoomNumber(b)
      const aMatch = numA.match(/^(\d+)/)
      const bMatch = numB.match(/^(\d+)/)
      if (aMatch && bMatch) {
        const numDiff = Number(aMatch[1]) - Number(bMatch[1])
        if (numDiff !== 0) return numDiff
      }
      return numA.localeCompare(numB)
    })
  }, [relevantTenants])

  const getMonthStatus = (tenant: Tenant, month: string): string => {
    const joinMonth = tenant.joiningDate.slice(0, 7)
    if (month < joinMonth) return '—'
    if (tenant.left && tenant.left.leftDate.slice(0, 7) < month) return '—'

    const importedPaid = importedRentPaidMonths[tenant.name.trim().toUpperCase()]
    if (importedPaid?.includes(month)) return 'X'

    const obligation = data.obligations.find(
      (o) => o.tenantId === tenant.id && o.period === month && o.paymentType === 'Rent'
    )
    if (obligation) {
      const totalReceived = obligation.received + obligation.advanceApplied
      if (totalReceived >= obligation.agreed) return 'X'
      if (totalReceived > 0) return `₹${obligation.received.toLocaleString('en-IN')} / ₹${obligation.agreed.toLocaleString('en-IN')}`
    }

    const paymentsForMonth = data.payments.filter(
      (p) => p.tenantId === tenant.id && p.paymentType === 'Rent' && p.month === month
    )
    const totalPayments = paymentsForMonth.reduce((sum, p) => sum + p.amount, 0)
    if (totalPayments >= tenant.monthlyRent) return 'X'
    if (totalPayments > 0) return `₹${totalPayments.toLocaleString('en-IN')} / ₹${tenant.monthlyRent.toLocaleString('en-IN')}`

    return 'Pending'
  }

  const getBalanceDisplay = (tenant: Tenant): string => {
    const rentState = scoped.rentStates.get(tenant.id)
    if (rentState && rentState.pending > 0) {
      return `${money(rentState.pending)} Pending`
    }
    const advanceBalance = data.advances
      .filter((a) => a.tenantId === tenant.id)
      .reduce((sum, a) => sum + (a.type === 'credit' ? a.amount : -a.amount), 0)
    if (advanceBalance > 0) {
      return `${money(advanceBalance)} Advance`
    }
    return '₹0'
  }

  const getSecurityDisplay = (tenant: Tenant): string => {
    if (tenant.security === 0) return '₹0 / Not Agreed'
    const refunded = data.securityLedger
      .filter((s) => s.tenantId === tenant.id && s.type === 'refunded')
      .reduce((sum, s) => sum + s.amount, 0)
    if (refunded > 0) return `Refunded ${money(refunded)}`
    if (tenant.securityReceived >= tenant.security) return `${money(tenant.security)} Paid`
    if (tenant.securityReceived > 0) return `${money(tenant.securityReceived)} / ${money(tenant.security)}`
    return `${money(tenant.security)} Pending`
  }

  const roomOptions = useMemo(() => {
    const options = filterBranchRooms.map((r) => ({ id: r.id, label: `Room ${r.number}` }))
    options.unshift({ id: 'All', label: 'All Rooms' })
    return options
  }, [filterBranchRooms])

  const generatePdf = useCallback(() => {
    setPdfStatus('Generating PDF...')
    const shortMonth = (m: string) => new Date(Number(m.slice(0,4)), Number(m.slice(5,7)) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' }).replace(/\s+/g, '-')
    const filename = `PG95-${branch.name}-5-Month-Register-${shortMonth(firstMonth)}-to-${shortMonth(lastMonth)}.pdf`
    let doc: any
    try {
      doc = new jsPDF('landscape', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()
      const margin = 8

      const head = ['#', 'Room', 'Tenant', ...registerMonths.map(formatMonth), 'Monthly Rent', 'Balance', 'Mobile', 'Rent Due', 'Electricity', 'Security']
      const colWidths = [8, 10, 26, ...registerMonths.map(() => 18), 16, 18, 18, 14, 12, 16]
      const body = sortedTenants.map((tenant, index) => {
        const room = filterBranchRooms.find((r) => r.id === tenant.roomId)
        const rentState = scoped.rentStates.get(tenant.id)
        return [
          String(index + 1),
          room?.number || '',
          tenant.name,
          ...registerMonths.map((m) => getMonthStatus(tenant, m)),
          money(tenant.monthlyRent),
          getBalanceDisplay(tenant),
          tenant.phone,
          formatDate(rentState?.dueDate || tenant.dueDate),
          tenant.electricity === 'Fixed' ? money(tenant.electricityAmount) : 'Included',
          getSecurityDisplay(tenant),
        ].map((cell) => cell.replace(/₹/g, 'Rs.'))
      })

      doc.setFontSize(10)
      doc.text(`5 Month Tenant Register - ${branch.name}`, margin, 12)
      doc.setFontSize(8)
      doc.text(`Period: ${formatMonth(firstMonth)} - ${formatMonth(lastMonth)}`, margin, 17)
      doc.text(`Generated: ${formatDate(today)}`, margin, 21)
      if (statusFilter !== 'All') doc.text(`Filter: ${statusFilter}`, pageWidth - margin, 17, { align: 'right' })

      autoTable(doc, {
        head: [head],
        body,
        startY: 24,
        margin: { left: margin, right: margin },
        tableLineWidth: 0.4,
        tableLineColor: [120, 120, 120],
        columnStyles: head.reduce<Record<string, { cellWidth: number }>>((acc, _, i) => {
          acc[i] = { cellWidth: colWidths[i] }
          return acc
        }, {}),
        styles: { fontSize: 6.5, cellPadding: 1.2, valign: 'middle', overflow: 'linebreak', lineWidth: 0.15, lineColor: [160, 160, 160] },
        headStyles: { fontSize: 6, fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
        bodyStyles: { fontSize: 6.5 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        pageBreak: 'auto',
        showHead: 'everyPage',
        didDrawPage: (data: any) => {
          doc.setFontSize(7)
          doc.text(`Page ${data.pageNumber}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 4, { align: 'right' })
        },
      })

      const blob = doc.output('blob')
      if (!blob || blob.size === 0) throw new Error('PDF blob is empty')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setPdfStatus('PDF downloaded successfully')
      onExport?.('5-Month Register', 'PDF')
      setTimeout(() => setPdfStatus(null), 3000)
    } catch (e: any) {
      console.error('PDF generation failed:', e)
      setPdfStatus(`PDF failed: ${e.message || 'unknown error'}`)
    }
  }, [sortedTenants, registerMonths, branch, reportEndMonth, firstMonth, lastMonth, statusFilter])

  return (
    <Modal title="5 Month Tenant Register" wide onClose={onClose}>
      <div className="grid gap-4">
        <div className="no-print flex flex-wrap items-center gap-3">
          <Field label="Report ending month">
            <select className={inputClass} value={reportEndMonth} onChange={(e) => setReportEndMonth(e.target.value)}>
              {availableReportMonths.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
            </select>
          </Field>
          <Field label="Branch">
            <select className={inputClass} value={branchFilterId} onChange={(e) => setBranchFilterId(e.target.value)}>
              {visibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Room">
            <select className={inputClass} value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
              {roomOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          <div className="flex gap-2 items-end">
            <Tabs values={['All', 'Active', 'Vacated']} value={statusFilter} onChange={(v) => setStatusFilter(v as typeof statusFilter)} />
          </div>
          <div className="flex-1" />
          <Button tone="blue" onClick={generatePdf}><Download size={16} /> Download PDF</Button>
          {pdfStatus && <span className={`text-xs font-semibold ${pdfStatus.includes('failed') ? 'text-rose-600' : pdfStatus.includes('success') ? 'text-emerald-600' : 'text-blue-600'}`}>{pdfStatus}</span>}
        </div>

        <Card className="overflow-hidden p-0">
          <div className="overflow-auto max-h-[65vh]">
            <table className="w-full text-left text-xs border-separate border-spacing-0 border border-slate-500">
              <thead className="sticky top-0 z-10 bg-blue-600 text-white">
                <tr>
                  <th className="p-2 w-8 border-r border-b border-white/20">#</th>
                  <th className="p-2 w-14 border-r border-b border-white/20">Room</th>
                  <th className="p-2 w-32 border-r border-b border-white/20">Tenant</th>
                  {registerMonths.map((m) => <th key={m} className="p-2 text-center w-24 border-r border-b border-white/20">{formatMonth(m)}</th>)}
                  <th className="p-2 w-20 border-r border-b border-white/20">Monthly Rent</th>
                  <th className="p-2 w-20 border-r border-b border-white/20">Balance</th>
                  <th className="p-2 w-22 border-r border-b border-white/20">Mobile</th>
                  <th className="p-2 w-18 border-r border-b border-white/20">Rent Due Date</th>
                  <th className="p-2 w-16 border-r border-b border-white/20">Electricity</th>
                  <th className="p-2 w-20 border-r border-b border-white/20">Security</th>
                </tr>
              </thead>
              <tbody>
                {sortedTenants.map((tenant, index) => {
                  const room = filterBranchRooms.find((r) => r.id === tenant.roomId)
                  const rentState = scoped.rentStates.get(tenant.id)
                  return <tr key={tenant.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                    <td className="p-2 text-slate-500 border-r border-b border-slate-500">{index + 1}</td>
                    <td className="p-2 font-semibold border-r border-b border-slate-500">{room?.number || ''}</td>
                    <td className="p-2 border-r border-b border-slate-500">{tenant.name}</td>
                    {registerMonths.map((m) => {
                      const status = getMonthStatus(tenant, m)
                      const isPaid = status === 'X'
                      const isPending = status === 'Pending'
                      const isNa = status === '—'
                      const isPartial = !isPaid && !isPending && !isNa
                      return <td key={m} className={`p-2 text-center font-semibold border-r border-b border-slate-500 ${isPaid ? 'text-emerald-700' : isPending ? 'text-rose-700' : isPartial ? 'text-orange-700' : 'text-slate-400'}`}>
                        {isNa ? '—' : isPaid ? 'X' : status}
                      </td>
                    })}
                    <td className="p-2 text-right font-semibold border-r border-b border-slate-500">{money(tenant.monthlyRent)}</td>
                    <td className={`p-2 text-right font-semibold border-r border-b border-slate-500 ${getBalanceDisplay(tenant).includes('Pending') ? 'text-rose-700' : getBalanceDisplay(tenant).includes('Advance') ? 'text-emerald-700' : ''}`}>{getBalanceDisplay(tenant)}</td>
                    <td className="p-2 border-r border-b border-slate-500">{tenant.phone}</td>
                    <td className="p-2 border-r border-b border-slate-500">{formatDate(rentState?.dueDate || tenant.dueDate)}</td>
                    <td className="p-2 border-r border-b border-slate-500">{tenant.electricity === 'Fixed' ? money(tenant.electricityAmount) : 'Included'}</td>
                    <td className="p-2 border-r border-b border-slate-500">{getSecurityDisplay(tenant)}</td>
                  </tr>
                })}
                {!sortedTenants.length && <tr><td colSpan={14} className="p-4 text-center text-slate-500 border-r border-b border-slate-500">No tenants found for the selected period.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Modal>
  )
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default App
