'use client';
// Map view over the same persisted states/transitions as the list. Positions are computed once per
// state (layered by first discovery) and kept stable as new nodes arrive; the view never auto-pans.
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
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
    const nodes: Node[] = states.map((s) => {
      const d = depth.get(s.id) ?? 0;
      const row = perLevel.get(d) ?? 0; perLevel.set(d, row + 1);
      return {
        id: s.id, position: { x: d * 240, y: row * 90 },
        data: { label: `${s.title}\n${s.route} · ${s.actor}/${s.device}` },
        style: { fontSize: 11, width: 200, whiteSpace: 'pre-line', borderRadius: 8, border: '1px solid var(--separator-strong)', background: 'var(--surface)', color: 'var(--text)' },
      };
    });
    const edges: Edge[] = transitions.filter((t) => t.from_state).map((t) => ({ id: t.id, source: t.from_state!, target: t.to_state, label: t.label.slice(0, 40), labelStyle: { fontSize: 10 } }));
    return { nodes, edges };
  }, [states, transitions]);
  return (
    <div style={{ height: 520 }} className="card" aria-label="Workflow map (the List view has the same information)">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} proOptions={{ hideAttribution: false }}>
        <Background /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
