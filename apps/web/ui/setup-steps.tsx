/** Three-step setup progress for a new project: add, verify, approve. */
import { Icon } from './icons';
export function SetupSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Add the site', 'Prove you own it', 'Approve the run'];
  return (
    <ol className="steps" aria-label="Setup progress">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return <li key={s} data-state={state} aria-current={state === 'current' ? 'step' : undefined}><span className="n">{state === 'done' ? <Icon name="tick" /> : n}</span>{s}<span className="sr-only">{state === 'done' ? ' (done)' : ''}</span></li>;
      })}
    </ol>
  );
}
