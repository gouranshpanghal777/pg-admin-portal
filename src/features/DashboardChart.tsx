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

type MonthSummary = { month: string; collected: number; expected: number }
type RoomSummary = { name: string; value: number }

type DashboardChartProps = {
  kind: 'revenue' | 'rooms' | 'occupancy'
  months?: MonthSummary[]
  roomDistribution?: RoomSummary[]
  occupancyRate?: number
}

const money = (value: number) => `₹${Math.abs(value || 0).toLocaleString('en-IN')}`
const colors = ['#2563eb', '#16a34a', '#f97316', '#8b5cf6']

export default function DashboardChart({ kind, months = [], roomDistribution = [], occupancyRate = 0 }: DashboardChartProps) {
  if (kind === 'revenue') {
    return <ChartCard title="Revenue Overview" height="h-72"><BarChart data={months}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Bar dataKey="collected" fill="#16a34a" radius={[4, 4, 0, 0]} /><Bar dataKey="expected" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ChartCard>
  }

  if (kind === 'rooms') {
    return <ChartCard title="Room Distribution" height="h-72"><PieChart><Pie data={roomDistribution} innerRadius={58} outerRadius={92} dataKey="value" label>{roomDistribution.map((room, index) => <Cell key={room.name} fill={colors[index % colors.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ChartCard>
  }

  const occupancy = months.map((item, index) => ({ month: item.month, occupancy: Math.min(100, occupancyRate - 12 + index * 3) }))
  return <ChartCard title="Occupancy Trend" height="h-48"><AreaChart data={occupancy}><XAxis dataKey="month" /><YAxis /><Tooltip /><Area dataKey="occupancy" fill="#bfdbfe" stroke="#2563eb" /></AreaChart></ChartCard>
}

function ChartCard({ title, height, children }: { title: string; height: string; children: React.ReactElement }) {
  return <section className="rounded-lg border border-slate-400 bg-white p-4 shadow-sm"><h2 className="mb-4 text-lg font-bold">{title}</h2><div className={height}><ResponsiveContainer>{children}</ResponsiveContainer></div></section>
}
