import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useI18n } from '../i18n/I18nContext';

interface EcuFailureData {
  module: string;
  name: string;
  failures: number;
}

// Mock historical data since we don't have a backend to store multiple scans
const mockHistoricalData: EcuFailureData[] = [
  { module: 'ECM', name: 'Engine Control', failures: 12 },
  { module: 'TCM', name: 'Transmission', failures: 4 },
  { module: 'ABS', name: 'Anti-lock Brakes', failures: 8 },
  { module: 'BCM', name: 'Body Control', failures: 15 },
  { module: 'SRS', name: 'Airbags', failures: 2 },
  { module: 'IPC', name: 'Instrument Cluster', failures: 5 },
  { module: 'HVAC', name: 'Climate Control', failures: 7 },
  { module: 'EPS', name: 'Power Steering', failures: 3 },
  { module: 'TPMS', name: 'Tire Pressure', failures: 9 },
  { module: 'PAM', name: 'Parking Assist', failures: 1 },
];

export const DiagnosticHeatmap: React.FC = () => {
  const { t, isRtl } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const width = 600;
    const height = 300;
    const margin = { top: 20, right: 20, bottom: 40, left: 60 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous render

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Sort data by failures descending
    const sortedData = [...mockHistoricalData].sort((a, b) => b.failures - a.failures);

    const x = d3.scaleBand()
      .domain(sortedData.map(d => d.module))
      .range([0, innerWidth])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(sortedData, d => d.failures) || 0])
      .range([innerHeight, 0]);

    // Heatmap color scale (interpolate from cyan to rose)
    const colorScale = d3.scaleSequential()
      .domain([0, d3.max(sortedData, d => d.failures) || 0])
      .interpolator(d3.interpolateYlOrRd);

    // X Axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px');
      
    // Y Axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px');

    // Axes styling
    g.selectAll('.domain, .tick line')
      .attr('stroke', '#334155');

    // Bars
    g.selectAll('rect')
      .data(sortedData)
      .enter()
      .append('rect')
      .attr('x', d => x(d.module) || 0)
      .attr('y', d => y(d.failures))
      .attr('width', x.bandwidth())
      .attr('height', d => innerHeight - y(d.failures))
      .attr('fill', d => colorScale(d.failures) as string)
      .attr('rx', 4)
      .on('mouseenter', function(event, d) {
        d3.select(this)
          .transition().duration(200)
          .attr('opacity', 0.8);
      })
      .on('mouseleave', function() {
        d3.select(this)
          .transition().duration(200)
          .attr('opacity', 1);
      });
      
    // Labels
    g.selectAll('.label')
      .data(sortedData)
      .enter()
      .append('text')
      .attr('class', 'label')
      .attr('x', d => (x(d.module) || 0) + x.bandwidth() / 2)
      .attr('y', d => y(d.failures) - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', '#cbd5e1')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .text(d => d.failures);

  }, [isRtl]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg w-full">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          {isRtl ? 'الخريطة الحرارية للأعطال' : 'Diagnostic Heatmap'}
        </h3>
        <p className="text-xs text-slate-400">
          {isRtl 
            ? 'تكرار أعطال وحدات التحكم (ECU) بناءً على السجل التاريخي للفحوصات' 
            : 'Most frequently failing ECU modules based on historical DTC scans'}
        </p>
      </div>
      <div className="w-full overflow-x-auto custom-scrollbar">
        <svg ref={svgRef} className="w-full h-auto min-w-[500px]" style={{ maxHeight: '300px' }}></svg>
      </div>
    </div>
  );
};
