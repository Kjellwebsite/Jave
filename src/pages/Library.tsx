import { navigate } from '../app/router';
import { startSession } from '../app/sessions';
import { Footer, Header } from '../components/Chrome';
import { Label, Tag } from '../components/ui';
import { DOMAINS } from '../engine/domains';
import { allParadigms } from '../engine/registry';
import type { Paradigm } from '../items/paradigm';

const GROUPS: { id: Paradigm['group']; label: string }[] = [
  { id: 'core', label: 'Core instruments' },
  { id: 'performance', label: 'Performance' },
  { id: 'creativity', label: 'Creativity' },
  { id: 'applied', label: 'Applied' },
];

export default function Library() {
  const all = allParadigms().filter((p) => p.id !== 'pairsRecall' && p.id !== 'categoryRetain');
  const run = (id: string) => {
    startSession('single', id);
    navigate('assessment');
  };
  return (
    <>
      <Header current="library" />
      <main id="main" className="wrap">
        <section className="section">
          <div className="section-head">
            <Label>Instruments</Label>
            <h2>Every instrument, on its own.</h2>
            <p>Run a single instrument to explore it. Single runs produce a report for that instrument only; the full profile needs one of the assessment formats.</p>
          </div>
          {GROUPS.map((g) => {
            const list = all.filter((p) => p.group === g.id);
            return (
              <div key={g.id} className="library-group">
                <Label as="h3">{g.label}</Label>
                <ul className="library-list">
                  {list
                    .sort((a, b) => DOMAINS.findIndex((d) => d.id === a.domain) - DOMAINS.findIndex((d) => d.id === b.domain))
                    .map((p) => (
                      <li key={p.id}>
                        <button type="button" className="library-row" onClick={() => run(p.id)}>
                          <span className="mono library-domain">{DOMAINS.find((d) => d.id === p.domain)?.name}</span>
                          <span className="library-title">{p.title}</span>
                          <span className="library-sub">{p.subtitle}</span>
                          <span className="library-meta">
                            {p.kind === 'items' ? <Tag tone="outline">Adaptive</Tag> : <Tag tone="outline">Trials</Tag>}
                            {p.experimental ? <Tag>Experimental</Tag> : null}
                            <span className="mono">~{p.minutes} min</span>
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </section>
      </main>
      <Footer />
    </>
  );
}
