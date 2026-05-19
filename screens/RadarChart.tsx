import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Polygon, Line, Circle, Text as SvgText, G } from 'react-native-svg';

type Series = {
  label: string;
  values: (number | null)[];
  color: string;
  fillOpacity?: number;
};

type Props = {
  axes: string[];
  series: Series[];
  size?: number;
  maxValue?: number;
};

export default function RadarChart({ axes, series, size = 320, maxValue = 5 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 60;
  const n = axes.length;

  if (n < 3) {
    return <Text style={{ color: '#94A3B8', textAlign: 'center', padding: 20 }}>レーダーチャートは3項目以上必要です</Text>;
  }

  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const point = (i: number, value: number) => {
    const r = (radius * value) / maxValue;
    return { x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) };
  };
  const labelPoint = (i: number) => {
    const r = radius + 22;
    return { x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) };
  };

  const gridLevels = [1, 2, 3, 4, 5].filter(v => v <= maxValue);

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {/* 同心多角形 */}
        {gridLevels.map(level => {
          const pts = axes.map((_, i) => {
            const p = point(i, level);
            return `${p.x},${p.y}`;
          }).join(' ');
          return (
            <Polygon
              key={level}
              points={pts}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={1}
            />
          );
        })}

        {/* 軸線 */}
        {axes.map((_, i) => {
          const p = point(i, maxValue);
          return (
            <Line
              key={i}
              x1={cx} y1={cy}
              x2={p.x} y2={p.y}
              stroke="#E2E8F0"
              strokeWidth={1}
            />
          );
        })}

        {/* データ系列 (重ね描き) */}
        {series.map((s, sIdx) => {
          const pts = axes.map((_, i) => {
            const v = s.values[i] ?? 0;
            const p = point(i, v);
            return `${p.x},${p.y}`;
          }).join(' ');
          return (
            <G key={sIdx}>
              <Polygon
                points={pts}
                fill={s.color}
                fillOpacity={s.fillOpacity ?? 0.25}
                stroke={s.color}
                strokeWidth={2}
              />
              {axes.map((_, i) => {
                const v = s.values[i];
                if (v == null) return null;
                const p = point(i, v);
                return <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={s.color} />;
              })}
            </G>
          );
        })}

        {/* 軸ラベル */}
        {axes.map((label, i) => {
          const p = labelPoint(i);
          const a = angle(i);
          let anchor: 'start' | 'middle' | 'end' = 'middle';
          if (Math.cos(a) > 0.3) anchor = 'start';
          else if (Math.cos(a) < -0.3) anchor = 'end';
          return (
            <SvgText
              key={i}
              x={p.x}
              y={p.y}
              fontSize={11}
              fontWeight="600"
              fill="#475569"
              textAnchor={anchor}
              alignmentBaseline="middle"
            >
              {label}
            </SvgText>
          );
        })}
      </Svg>

      {/* 凡例 */}
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {series.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: s.color, opacity: 0.6 }} />
            <Text style={{ fontSize: 12, color: '#475569', fontWeight: '600' }}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
