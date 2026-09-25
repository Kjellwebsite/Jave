import { Footer, Header } from '../components/Chrome';
import { Label } from '../components/ui';
import { RANK_THRESHOLDS, displayRank } from '../scoring/rank';

export default function Method() {
  return (
    <>
      <Header current="method" />
      <main id="main" className="wrap">
        <section className="section">
          <div className="section-head">
            <Label>Method</Label>
            <h2>How JVLN measures, and what it can and cannot claim.</h2>
            <p className="lede">JVLN estimates your performance on a set of cognitive constructs. It adapts to you as you go, reports the precision of every estimate, and refuses to invent numbers it cannot support.</p>
          </div>
          <div className="method-grid">
            <article className="prose">
              <h3>What is measured</h3>
              <p>Eleven domains informed by the Cattell–Horn–Carroll model of cognitive abilities: reasoning, quantitative and probabilistic reasoning, memory, attention and processing, executive function, learning, strategic reasoning, metacognition, social cognition, language, and an experimental adaptive/natural domain.</p>
              <p>Each domain uses established paradigms such as matrix reasoning, span tasks, one-touch planning, category learning and belief tracking. Every item is original; most are generated fresh for each session.</p>

              <h3>How adaptivity works</h3>
              <p>Items carry difficulty and discrimination parameters under a three-parameter logistic model. After each answer, JVLN updates a Bayesian (EAP) estimate of your ability and chooses the item that is most informative at that estimate. A section stops when the estimate is precise enough, or after a maximum number of items.</p>
              <p>Difficulty rises through structure: more interacting rules, deeper look-ahead, longer dependency chains and nested beliefs. The hardest levels are designed to separate very strong performers.</p>

              <h3>Uncertainty</h3>
              <p>Every estimate is shown with a standard error and a 90% interval. When an interval spans several ranks, you see the range. Estimates based on too few items are not shown. If you solve even the hardest items, the report says the estimate is a lower bound.</p>

              <h3>Provisional parameters</h3>
              <p>Item parameters are currently predicted from the complexity of each item, not yet estimated from a large sample. Ranks are therefore labelled <em>Provisional · unnormed</em>, and JVLN shows no percentiles. A difficult item is a hypothesis about difficulty; it is not proof of any particular ability level.</p>

              <h3>Performance measures</h3>
              <p>Reaction times, search slopes, switch costs and typing speed are reported as raw values. Browsers and devices add roughly 25–100 ms of latency, so these values are only comparable on the same device. They never enter the intelligence estimate.</p>

              <h3>What JVLN is not</h3>
              <ul>
                <li>Not an IQ test and not a measure of “true intelligence”.</li>
                <li>Not for clinical diagnosis, hiring, admissions or any decision about a person.</li>
                <li>Not normed: until calibration on a large sample, no population comparison is possible.</li>
              </ul>

              <h3>Privacy</h3>
              <p>No account, no name, no email. Your responses are stored in this browser only. Fonts are self-hosted, and no third-party services are contacted. You can export or delete your data from the report.</p>
            </article>
            <aside className="method-aside">
              <Label>Rank scale · future norms</Label>
              <p className="method-aside-note">Thresholds are defined on a population-standardised scale. They become meaningful only after norming.</p>
              <table className="rank-table mono">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">z from</th>
                  </tr>
                </thead>
                <tbody>
                  {RANK_THRESHOLDS.map((r) => (
                    <tr key={r.rank}>
                      <td>{displayRank(r.rank)}</td>
                      <td>{Number.isFinite(r.z) ? r.z.toFixed(3) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="method-aside-note">S = top 0.1% · A = top 1% · B = top 5% · C = top 20% · D = top 50%</p>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
