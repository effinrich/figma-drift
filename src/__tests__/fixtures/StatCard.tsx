export interface StatCardProps {
  title: string
  value: string
  change?: string
  trend?: 'up' | 'down' | 'neutral'
}

export function StatCard({
  title,
  value,
  change,
  trend = 'neutral'
}: StatCardProps) {
  return (
    <div className="rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <p className="text-sm text-muted-foreground">{title}</p>
      <span className="text-2xl font-bold">{value}</span>
      {change && <span className="text-emerald-600">{change}</span>}
    </div>
  )
}
