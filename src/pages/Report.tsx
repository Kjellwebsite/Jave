import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { navigate } from '../app/router';
import { reportSessionId, setReportSession } from '../app/sessions';
import { Footer, Header } from '../components/Chrome';
import { CalibrationCurve, IntervalPlot, PolarProfile, type ProfileRow } from '../components/report/charts';
import { Button, Label, Rule, Tag, Ticker } from '../components/ui';
import { deleteAll, listSessions, loadSession } from '../data/storage';
import { BAND_LABEL } from '../adaptive/irt';
import { type EstimateView, type FacetView, generateReport, type Report } from '../scoring/report';
import { displayRank } from '../scoring/rank';
import type { Metric, Session } from '../types';
import './report.css';

const fmt2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const signed = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : `−${Math.abs(v).toFixed(2)}`);

function RankRange({ e, size = 'lg' }: { e: EstimateView; size?: 'lg' | 'sm' }) {
  const range = e.rankLo !== e.rankHi;
  return (
    <span className={`rank rank-${size}`}>
      <span className="rank-letter">{displayRank(e.rank)}</span>
      {range ? (
        <span className="rank-range mono">
          {displayRank(e.rankLo)} – {displayRank(e.rankHi)}
          {e.ceiling ? ' or higher' : ''}
        </span>
      ) : null}
    </span>
  );
}

function EstimateLine({ e }: { e: EstimateView | null }) {
  if (!e) return <span className="muted">Insufficient data</span>;
  return (
    <span className="mono estimate-line">
      θ {e.ceiling ? '≥ ' : ''}
      {signed(e.theta)} <span className="muted">± {fmt2(e.se)}</span> · n {e.n}
    </span>
  );
}

function MetricList({ metrics }: { metrics: Metric[] }) {
  if (!metrics.length) return null;
  return (
    <dl className="metric-list">
      {metrics.map((m) => (
        <div key={m.id} className={`metric metric-${m.status ?? 'ok'}`}>
          <dt>{m.label}</dt>
          <dd>
            <span className="mono metric-value">{m.display}</span>
            {m.note ? <span className="metric-note">{m.note}</span> : null}
            {m.caveat ? <span className="metric-caveat">{m.caveat}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FacetRow({ f }: { f: FacetView }) {
  return (
    <div className="facet">
      <div className="facet-head">
        <div>
          <span className="facet-title">{f.title}</span>
          <span className="facet-construct">{f.construct}</span>
        </div>
        <div className="facet-right">
          {f.status === 'not-taken' ? <Tag tone="outline">Not taken</Tag> : f.status === 'skipped' ? <Tag tone="outline">Skipped</Tag> : null}
          {f.load ? <Tag tone="outline">{f.load}</Tag> : null}
          {f.estimate ? <RankRange e={f.estimate} size="sm" /> : null}
        </div>
      </div>
      {f.status === 'done' ? (
        <div className="facet-body">
          {f.items || f.estimate ? (
            <p className="facet-stats mono">
              <EstimateLine e={f.estimate} />
              {f.items ? <span> · {f.items} items</span> : null}
              {f.rapid ? <span> · {f.rapid} rapid guesses excluded</span> : null}
              {f.excluded ? <span> · {f.excluded} excluded (memory check)</span> : null}
              {f.estimate?.ceiling ? <span> · ceiling reached</span> : null}
            </p>
          ) : null}
          <MetricList metrics={f.metrics} />
        </div>
      ) : null}
    </div>
  );
}

function pickSession(): Session | null {
  const id = reportSessionId();
  const s = id ? loadSession(id) : null;
  if (s) return s;
  const latest = listSessions().find((x) => x.status === 'complete');
  return latest ? loadSession(latest.id) : null;
}

export default function ReportPage() {
  const [session, setSession] = useState<Session | null>(pickSession);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const report: Report | null = useMemo(() => (session ? generateReport(session) : null), [session]);
  const sessions = listSessions().filter((s) => s.status === 'complete');

  if (!session || !report) {
    return (
      <>
        <Header />
        <main id="main" className="wrap section">
          <div className="section-head">
            <Label>Report</Label>
            <h2>No completed assessment on this device.</h2>
            <p>Reports are generated from assessments completed in this browser.</p>
          </div>
          <Button onClick={() => navigate('setup')}>Begin an assessment</Button>
        </main>
        <Footer />
      </>
    );
  }

  const coreDomains = report.domains.filter((d) => d.info.status !== 'performance' && d.info.status !== 'metrics');
  const rows: ProfileRow[] = coreDomains.map((d) => ({ id: d.info.id, label: `${String(d.info.index).padStart(2, '0')}  ${d.info.name}`, estimate: d.estimate, experimental: d.info.status === 'experimental' }));
  const measured = coreDomains.filter((d) => d.estimate);
  const strongest = [...measured].sort((a, b) => b.estimate!.lo - a.estimate!.lo).slice(0, 3);
  const g = report.general;
  const date = new Date(report.createdAt);
  const minutes = Math.round(report.durationMs / 60000);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ session, report }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jvln-${session.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <>
      <Header />
      <main id="main" className="report wrap">
        <header className="report-mast">
          <div className="report-mast-top">
            <div className="report-brand">
              <span className="report-jvln">JVLN</span>
              <span className="report-intel">Intelligence</span>
            </div>
            <dl className="report-meta mono">
              <div><dt>Profile</dt><dd>{session.id.slice(2, 10).toUpperCase()}</dd></div>
              <div><dt>Date</dt><dd>{date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</dd></div>
              <div><dt>Format</dt><dd>{session.mode}</dd></div>
              <div><dt>Duration</dt><dd>{minutes} min</dd></div>
              <div><dt>Items</dt><dd>{report.conditions.totalItems}</dd></div>
            </dl>
          </div>
          <Rule />
          <div className="report-provisional">
            <Tag tone="strong">Provisional · unnormed</Tag>
            <p>Item parameters are predicted, not yet calibrated on a population. Ranks are estimates on the provisional scale and carry no percentile meaning. Intervals show 90% uncertainty.</p>
          </div>
        </header>

        {/* SUMMARY */}
        <section className="report-section summary" aria-labelledby="summary-title">
          <Label as="h2">Summary</Label>
          <div className="summary-grid">
            <div className="summary-rank">
              <Label>Core intelligence</Label>
              {g ? (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.2, 0.7, 0.1, 1] }}>
                  <RankRange e={g} />
                </motion.div>
              ) : (
                <p className="summary-none">Insufficient data</p>
              )}
            </div>
            <div className="summary-facts">
              <div className="summary-fact">
                <Label>Estimate</Label>
                <span className="summary-num">{g ? <Ticker value={g.theta} format={(v) => signed(v)} /> : '—'}</span>
                <span className="muted mono">θ, provisional scale</span>
              </div>
              <div className="summary-fact">
                <Label>Precision</Label>
                <span className="summary-num">{g ? `± ${fmt2(g.se)}` : '—'}</span>
                <span className="muted mono">{g ? `90% interval ${signed(g.lo)} to ${signed(g.hi)}` : ''}</span>
              </div>
              <div className="summary-fact">
                <Label>Difficulty band</Label>
                <span className="summary-num summary-band">{g ? BAND_LABEL[g.band] : '—'}</span>
                <span className="muted mono">where you solve about half the items</span>
              </div>
              <div className="summary-fact">
                <Label>Coverage</Label>
                <span className="summary-num">{measured.length}<span className="muted"> / {coreDomains.length}</span></span>
                <span className="muted mono">domains with an estimate</span>
              </div>
            </div>
          </div>
          <p id="summary-title" className="summary-note">
            {g
              ? `The core estimate pools ${g.n} scored responses across ${measured.filter((d) => d.info.status !== 'experimental').length} core domains (the experimental Adaptive/Natural domain is excluded).`
              : 'Complete more sections to obtain a core estimate.'}
          </p>
        </section>

        {/* CORE PROFILE */}
        <section className="report-section" aria-labelledby="profile-title">
          <div className="report-section-head">
            <Label as="h2">Core profile</Label>
            <p id="profile-title">Each dot is an estimate; the bar is its 90% interval. Hollow dots mark experimental constructs.</p>
          </div>
          <div className="profile-grid">
            <IntervalPlot rows={rows} />
            <div className="profile-polar">
              <PolarProfile rows={rows} />
              <ol className="polar-key mono">
                {rows.map((r, i) => (
                  <li key={r.id}>
                    {String(i + 1).padStart(2, '0')} {r.label.replace(/^\d+\s+/, '')}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* SIGNALS */}
        <section className="report-section signals">
          <div>
            <Label as="h2">Strongest signals</Label>
            <ol className="signal-list">
              {strongest.length ? (
                strongest.map((d) => (
                  <li key={d.info.id}>
                    <span>{d.info.name}</span>
                    <span className="mono muted">lower bound {signed(d.estimate!.lo)}</span>
                  </li>
                ))
              ) : (
                <li className="muted">Not enough data yet.</li>
              )}
            </ol>
            <p className="signal-note">Ranked by the lower end of the interval, so a strong but uncertain estimate does not outrank a strong and precise one.</p>
          </div>
          <div>
            <Label as="h2">Most uncertainty</Label>
            <ol className="signal-list">
              {report.uncertainty.slice(0, 3).map((u) => (
                <li key={u.label}>
                  <span>{u.label}</span>
                  <span className="mono muted">
                    ± {fmt2(u.se)} · n {u.n}
                    {u.ceiling ? ' · ceiling' : ''}
                  </span>
                </li>
              ))}
              {coreDomains
                .filter((d) => !d.estimate)
                .slice(0, 3)
                .map((d) => (
                  <li key={d.info.id}>
                    <span>{d.info.name}</span>
                    <span className="mono muted">not measured</span>
                  </li>
                ))}
            </ol>
          </div>
        </section>

        {/* DOMAINS */}
        <section className="report-section" aria-labelledby="domains-title">
          <div className="report-section-head">
            <Label as="h2">Domain scores</Label>
            <p id="domains-title">Domain estimates pool every scored item in the domain. Facets are the individual instruments behind them.</p>
          </div>
          <div className="domain-cards">
            {report.domains.map((d) => {
              const taken = d.facets.filter((f) => f.status !== 'not-taken');
              if (!taken.length && !d.estimate && d.info.status !== 'metrics') return null;
              if (d.info.status === 'metrics') return null;
              return (
                <article key={d.info.id} className="domain-card">
                  <header className="domain-card-head">
                    <div>
                      <span className="mono domain-card-index">{String(d.info.index).padStart(2, '0')}</span>
                      <h3>{d.info.name}</h3>
                      <p className="domain-card-short">{d.info.short}</p>
                    </div>
                    <div className="domain-card-rank">
                      {d.estimate ? <RankRange e={d.estimate} size="sm" /> : <Tag tone="outline">{d.info.status === 'performance' ? 'Metrics only' : 'No estimate'}</Tag>}
                      {d.info.status === 'experimental' ? <Tag>Experimental</Tag> : null}
                    </div>
                  </header>
                  {d.estimate ? (
                    <p className="domain-card-est">
                      <EstimateLine e={d.estimate} />
                    </p>
                  ) : null}
                  <div className="facets">
                    {d.facets.map((f) => (
                      <FacetRow key={f.paradigm} f={f} />
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* METACOGNITION */}
        <section className="report-section" aria-labelledby="meta-title">
          <div className="report-section-head">
            <Label as="h2">Metacognition</Label>
            <p id="meta-title">How well your confidence tracked your accuracy on {report.metacognition.n} rated items.</p>
          </div>
          {report.metacognition.sufficient ? (
            <div className="meta-grid">
              <CalibrationCurve meta={report.metacognition} />
              <dl className="metric-list">
                <div className="metric">
                  <dt>Calibration</dt>
                  <dd>
                    <span className="metric-value">{report.metacognition.label.calibration}</span>
                    <span className="metric-note mono">
                      Mean confidence {(report.metacognition.meanConfidence * 100).toFixed(0)}% vs {(report.metacognition.accuracy * 100).toFixed(0)}% correct. Bias {signed(report.metacognition.bias)} (90% CI {signed(report.metacognition.biasCi[0])} to {signed(report.metacognition.biasCi[1])}).
                    </span>
                  </dd>
                </div>
                <div className="metric">
                  <dt>Confidence discrimination</dt>
                  <dd>
                    <span className="metric-value">{report.metacognition.label.discrimination}</span>
                    <span className="metric-note mono">
                      Type-2 AUROC {fmt2(report.metacognition.auroc)} (90% CI {fmt2(report.metacognition.aurocCi[0])}–{fmt2(report.metacognition.aurocCi[1])}). 0.50 means confidence carries no information.
                    </span>
                  </dd>
                </div>
                <div className="metric">
                  <dt>Brier score</dt>
                  <dd>
                    <span className="metric-value mono">{report.metacognition.brier.toFixed(3)}</span>
                    <span className="metric-note mono">
                      Reliability {report.metacognition.reliability.toFixed(3)} · resolution {report.metacognition.resolution.toFixed(3)} · uncertainty {report.metacognition.uncertainty.toFixed(3)}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="muted">Insufficient data: at least 12 rated items with 3 correct and 3 incorrect are needed. Current: {report.metacognition.n} rated.</p>
          )}
        </section>

        {(['performance', 'creativity', 'applied'] as const).map((group) =>
          report[group].some((f) => f.status !== 'not-taken') ? (
            <section key={group} className="report-section">
              <div className="report-section-head">
                <Label as="h2">{group === 'performance' ? 'Performance' : group === 'creativity' ? 'Creativity' : 'Applied capabilities'}</Label>
                <p>
                  {group === 'performance'
                    ? 'Raw speed and efficiency measures. Device-dependent and not part of any intelligence estimate.'
                    : group === 'creativity'
                      ? 'Creativity overlaps only modestly with intelligence (r ≈ .17). Reported separately; originality needs calibration data.'
                      : 'Skills, not broad abilities. Reported separately from the core profile.'}
                </p>
              </div>
              <div className="facets facets-wide">
                {report[group]
                  .filter((f) => f.status !== 'not-taken')
                  .map((f) => (
                    <FacetRow key={f.paradigm} f={f} />
                  ))}
              </div>
            </section>
          ) : null,
        )}

        {/* CONDITIONS */}
        <section className="report-section" aria-labelledby="cond-title">
          <div className="report-section-head">
            <Label as="h2">Test conditions</Label>
            <p id="cond-title">Circumstances that affect how these results should be read.</p>
          </div>
          <dl className="conditions mono">
            <div><dt>Input</dt><dd>{report.conditions.input}</dd></div>
            <div><dt>Screen</dt><dd>{report.conditions.viewport}</dd></div>
            <div><dt>Browser</dt><dd>{report.conditions.browser}</dd></div>
            <div><dt>Attempt</dt><dd>{report.conditions.attempt}{report.conditions.attempt > 1 ? ' · practice effects likely' : ''}</dd></div>
            <div><dt>Reloads / resumes</dt><dd>{report.conditions.resumes}</dd></div>
            <div><dt>Voided items</dt><dd>{report.conditions.voided}</dd></div>
            <div><dt>Tab switches</dt><dd>{report.conditions.hidden}</dd></div>
            <div><dt>Rapid guesses</dt><dd>{report.conditions.rapid}</dd></div>
            <div><dt>Ignored duplicate inputs</dt><dd>{report.conditions.duplicates}</dd></div>
            <div><dt>Reduced motion</dt><dd>{report.conditions.reducedMotion ? 'On' : 'Off'}</dd></div>
            <div><dt>Complete</dt><dd>{report.complete ? 'Yes' : 'No'}</dd></div>
          </dl>
        </section>

        <section className="report-section report-actions">
          <div className="report-action-row">
            <Button variant="secondary" onClick={exportJson}>
              Export data (JSON)
            </Button>
            <Button variant="ghost" onClick={() => navigate('setup')}>
              New assessment
            </Button>
            {confirmDelete ? (
              <span className="confirm">
                Delete every JVLN session in this browser?
                <Button
                  size="sm"
                  onClick={() => {
                    deleteAll();
                    setSession(null);
                  }}
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete my data
              </Button>
            )}
          </div>
          {sessions.length > 1 ? (
            <div className="report-history">
              <Label>Other reports on this device</Label>
              <ul>
                {sessions
                  .filter((s) => s.id !== session.id)
                  .slice(0, 8)
                  .map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="link-btn mono"
                        onClick={() => {
                          setReportSession(s.id);
                          setSession(loadSession(s.id));
                          window.scrollTo(0, 0);
                        }}
                      >
                        {new Date(s.createdAt).toLocaleDateString('en-GB')} · {s.mode}
                        {s.paradigm ? ` · ${s.paradigm}` : ''}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          <p className="report-disclaimer">
            JVLN estimates performance on the measured constructs. It is not an IQ test, not a clinical instrument, and must not be used for decisions about a person. See Method for limitations.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
