'use client';
// Map view over the same persisted states/transitions as the list. Positions are computed once per
// state (layered by first discovery) and kept stable as new nodes arrive; the view never auto-pans.
import { useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MarkerType, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type State = { id: string; route: string; title: string; actor: string; device: string };
type Transition = { id: string; from_state: string | null; to_state: string; label: string };

export function WorkflowMap({ states, transitions }: { states: State[]; transitions: Transition[] }) {
  const { nodes, edges } = useMemo(() => {
    const depth = new Map<string, number>();
    if (states[0]) depth.set(states[0].id, 0);
    for (let pass = 0; pass < states.length; pass++) {
      for (const t of transitions) {
        if (t.from_state && depth.has(t.from_state) && !depth.has(t.to_state)) depth.set(t.to_state, depth.get(t.from_state)! + 1);
      }
    }
    const perLevel = new Map<number, number>();
    const nodes: Node[] = states.map((s, i) => {
      const d = depth.get(s.id) ?? 0;
      const row = perLevel.get(d) ?? 0; perLevel.set(d, row + 1);
      return {
        id: s.id, position: { x: d * 260, y: row * 104 },
        data: { label: <div className="flow-node"><strong>{s.title}</strong><span>{s.route}</span><span>{s.actor} · {s.device}</span></div> },
        style: { width: 210, padding: '10px 12px', borderRadius: 10, border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--separator-strong)'}`, background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow-1)' },
      };
    });
    const edges: Edge[] = transitions.filter((t) => t.from_state).map((t) => ({
      id: t.id, source: t.from_state!, target: t.to_state, label: t.label.slice(0, 40),
      labelStyle: { fontSize: 10.5, fill: 'var(--text-2)' }, labelBgStyle: { fill: 'var(--surface)' }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4,
      style: { stroke: 'var(--text-3)', strokeWidth: 1.2 }, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--text-3)' },
    }));
    return { nodes, edges };
  }, [states, transitions]);
  return (
    <div style={{ height: 'min(560px, 70vh)' }} className="card flow-card fade-in" aria-label="Workflow map (the List view has the same information)">
      {states.length ? (
        <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} colorMode="system" proOptions={{ hideAttribution: false }} style={{ borderRadius: 'var(--radius)' }}>
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} /><Controls showInteractive={false} />
        </ReactFlow>
      ) : <div className="empty" style={{ height: '100%', alignContent: 'center' }}><p>No page states recorded yet. The map fills in as the agent explores.</p></div>}
    </div>
  );
}
