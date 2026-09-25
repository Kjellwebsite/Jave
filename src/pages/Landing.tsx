import { motion } from 'motion/react';
import { navigate } from '../app/router';
import { Footer, Header } from '../components/Chrome';
import { Instrument } from '../components/Instrument';
import { Button, Label, Tag } from '../components/ui';
import { BATTERIES } from '../engine/batteries';
import { DOMAINS } from '../engine/domains';
import './landing.css';

const STATUS_TAG: Record<string, string | null> = {
  core: null,
  performance: 'Performance',
  metrics: 'Metrics',
  experimental: 'Experimental',
};

const rise = (i: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.08 + i * 0.07, duration: 0.6, ease: [0.2, 0.7, 0.1, 1] as const },
});

export default function Landing() {
  return (
    <>
      <Header />
      <main id="main">
        <section className="hero wrap">
          <div className="hero-copy">
            <motion.div {...rise(0)}>
              <Label>Cognitive assessment instrument · v1.0</Label>
            </motion.div>
            <motion.h1 className="hero-title" {...rise(1)}>
              <span className="hero-jvln">JVLN</span>
              <span className="hero-intel">Intelligence</span>
            </motion.h1>
            <motion.p className="hero-lede" {...rise(2)}>
              A multidimensional assessment of how you think.
            </motion.p>
            <motion.div className="hero-actions" {...rise(3)}>
              <Button size="lg" onClick={() => navigate('setup')}>
                Begin assessment
              </Button>
              <Button size="lg" variant="ghost" onClick={() => navigate('method')}>
                How it works
              </Button>
            </motion.div>
          </div>
          <motion.div className="hero-visual" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease: [0.2, 0.7, 0.1, 1] }}>
            <Instrument />
          </motion.div>
        </section>

        <div className="wrap">
          <dl className="spec-strip mono">
            <div>
              <dt>Domains</dt>
              <dd>11</dd>
            </div>
            <div>
              <dt>Instruments</dt>
              <dd>37</dd>
            </div>
            <div>
              <dt>Item selection</dt>
              <dd>Adaptive · IRT</dd>
            </div>
            <div>
              <dt>Difficulty range</dt>
              <dd>Foundation → Apex</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>On this device</dd>
            </div>
          </dl>
        </div>

        <section className="section wrap">
          <div className="section-head">
            <Label>Construct model</Label>
            <h2>Eleven domains under one general factor.</h2>
            <p>Each domain is measured by one or more established paradigms, rebuilt with original, generated items. Domains that cannot yet be ranked honestly are reported as metrics, and experimental constructs are marked as such.</p>
          </div>
          <ol className="domain-list">
            {DOMAINS.map((d) => (
              <li key={d.id} className="domain-row">
                <span className="domain-index mono">{String(d.index).padStart(2, '0')}</span>
                <span className="domain-name">{d.name}</span>
                <span className="domain-short">{d.short}</span>
                <span className="domain-meta">
                  <span className="mono domain-anchor">{d.anchor}</span>
                  {STATUS_TAG[d.status] ? <Tag tone="outline">{STATUS_TAG[d.status]}</Tag> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="section wrap">
          <div className="principles">
            <div>
              <span className="principle-num mono">A</span>
              <h3>Adaptive</h3>
              <p>Every answer updates an ability estimate. The next item is the one that tells us most about you, so difficulty follows you upward instead of running out.</p>
            </div>
            <div>
              <span className="principle-num mono">B</span>
              <h3>Difficult by design</h3>
              <p>The hardest items combine many interacting rules, deep look-ahead and nested beliefs. They are built to separate very strong performers, not to trick anyone.</p>
            </div>
            <div>
              <span className="principle-num mono">C</span>
              <h3>Honest about uncertainty</h3>
              <p>Every estimate comes with its standard error. Until JVLN is calibrated on a large sample, ranks are marked provisional and no percentiles are shown.</p>
            </div>
          </div>
        </section>

        <section className="section wrap">
          <div className="section-head">
            <Label>Formats</Label>
            <h2>Three lengths. Same instrument.</h2>
          </div>
          <div className="mode-grid">
            {(['quick', 'core', 'full'] as const).map((m) => (
              <button key={m} type="button" className="mode-card" onClick={() => navigate('setup')}>
                <span className="mode-top">
                  <Label>{BATTERIES[m].label}</Label>
                  <span className="mono mode-min">~{BATTERIES[m].minutes} min</span>
                </span>
                <span className="mode-count">{BATTERIES[m].paradigms.length}</span>
                <span className="mode-count-label mono">sections</span>
                <span className="mode-desc">{BATTERIES[m].description}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
