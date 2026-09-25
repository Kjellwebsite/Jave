import { Suspense, useMemo, useState } from 'react';
import { BAND_LABEL, information, thetaMax } from '../adaptive/irt';
import { Footer, Header } from '../components/Chrome';
import { itemRenderer } from '../components/tasks';
import { Label, Tag } from '../components/ui';
import { allParadigms, isItemParadigm } from '../engine/registry';
import type { ItemParadigm } from '../items/paradigm';
import type { Item } from '../types';
import { createRng, hashSeed } from '../utils/rng';

function describeKey(item: Item) {
  return item.response.kind === 'choice' ? `option ${(item.key as number) + 1}` : String(item.key);
}

export default function Review() {
  const paradigms = allParadigms().filter(isItemParadigm) as ItemParadigm[];
  const [pid, setPid] = useState(paradigms[0]?.id ?? '');
  const [seed, setSeed] = useState(1);
  const paradigm = paradigms.find((p) => p.id === pid)!;
  const candidates = useMemo(() => paradigm.candidates([]), [paradigm]);
  const [key, setKey] = useState<string>('');
  const chosen = candidates.find((c) => c.key === key) ?? candidates[0];

  const sample = useMemo(() => {
    if (!chosen) return { items: [] as Item[], errors: [] as string[], ms: 0 };
    const errors: string[] = [];
    const items: Item[] = [];
    const t0 = performance.now();
    const n = paradigm.facetTargets ? 1 : 4;
    for (let i = 0; i < n; i++) {
      try {
        items.push(paradigm.instantiate(chosen.key, createRng(hashSeed('review', pid, chosen.key, seed, i))));
      } catch (e) {
        errors.push(String(e));
      }
    }
    return { items, errors, ms: (performance.now() - t0) / Math.max(1, n) };
  }, [paradigm, chosen, pid, seed]);

  const Renderer = itemRenderer(pid);

  return (
    <>
      <Header />
      <main id="main" className="wrap review">
        <section className="section">
          <div className="section-head">
            <Label>Internal · item review</Label>
            <h2>Inspect generated and authored items.</h2>
            <p>Every level of every item instrument, with its key, provisional parameters, complexity features and rationale. Use it to check ambiguity, clues and visual clarity before items go live.</p>
          </div>
          <div className="review-controls">
            <label>
              <Label>Instrument</Label>
              <select
                value={pid}
                onChange={(e) => {
                  setPid(e.target.value);
                  setKey('');
                }}
              >
                {paradigms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <Label>{paradigm.facetTargets || paradigm.id === 'rat' ? 'Item' : 'Level'}</Label>
              <select value={chosen?.key ?? ''} onChange={(e) => setKey(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.key} · b {c.irt.b.toFixed(2)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary btn-md" onClick={() => setSeed((s) => s + 1)}>
              New samples
            </button>
          </div>
          {chosen ? (
            <dl className="review-params mono">
              <div><dt>a</dt><dd>{chosen.irt.a.toFixed(2)}</dd></div>
              <div><dt>b</dt><dd>{chosen.irt.b.toFixed(2)}</dd></div>
              <div><dt>c</dt><dd>{chosen.irt.c.toFixed(3)}</dd></div>
              <div><dt>θ max info</dt><dd>{thetaMax(chosen.irt).toFixed(2)}</dd></div>
              <div><dt>Info at θ max</dt><dd>{information(thetaMax(chosen.irt), chosen.irt).toFixed(3)}</dd></div>
              <div><dt>Band</dt><dd>{BAND_LABEL[sample.items[0]?.band ?? 'standard']}</dd></div>
              <div><dt>Generation</dt><dd>{sample.ms.toFixed(1)} ms / item</dd></div>
              <div><dt>Calibration</dt><dd>provisional</dd></div>
            </dl>
          ) : null}
          {sample.errors.length ? <p className="runner-warning">{sample.errors.join(' · ')}</p> : null}
          <div className="review-items">
            {sample.items.map((item, i) => (
              <article key={`${i}-${item.id}`} className="review-item">
                <header className="review-item-head">
                  <span className="mono">{item.id}</span>
                  <Tag tone="outline">Key: {describeKey(item)}</Tag>
                </header>
                <div className="review-render">
                  <Suspense fallback={<div className="renderer-loading" />}>
                    <Renderer item={item} practice disabled onAnswer={() => undefined} reveal={{ key: item.key, chosen: null, correct: true }} />
                  </Suspense>
                </div>
                <dl className="review-features mono">
                  {Object.entries(item.features).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
                {item.explanation ? <p className="review-explain">{item.explanation}</p> : null}
              </article>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
