'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ratingColor } from '@/lib/format'

const AXIS = { stroke: 'transparent', tick: { fill: '#8a93a8', fontSize: 11 }, tickLine: false }

function TooltipBox({ label, rows }: { label: string; rows: [string, string][] }) {
  return (
    <div className="glass px-3 py-2 text-xs">
      <div className="mb-1 font-medium text-ink-700">{label}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="num flex gap-3 text-ink-500">
          <span>{k}</span>
          <span className="ml-auto font-medium text-ink-900">{v}</span>
        </div>
      ))}
    </div>
  )
}

export function RatingTrend({
  data,
}: {
  data: { label: string; rating: number; kda: string }[]
}) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34c98a" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#34c98a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e6e9f2" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={44} domain={[0, 'auto']} />
          <ReferenceLine y={1} stroke="#c3cadb" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ stroke: '#c3cadb', strokeDasharray: '3 3' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  label={String(label)}
                  rows={[
                    ['Rating', Number(payload[0].value).toFixed(2)],
                    ['K-D-A', String(payload[0].payload.kda)],
                  ]}
                />
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="rating"
            stroke="#1f9d63"
            strokeWidth={2}
            fill="url(#ratingFill)"
            dot={{ r: 3, strokeWidth: 0, fill: '#1f9d63' }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function RatingHistogram({ data }: { data: { bucket: string; count: number; mid: number }[] }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
          <CartesianGrid stroke="#e6e9f2" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" {...AXIS} />
          <YAxis {...AXIS} width={44} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(47,163,107,0.10)' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox label={`Rating ${label}`} rows={[['场次', String(payload[0].value)]]} />
              ) : null
            }
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.bucket} fill={ratingColor(d.mid)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
