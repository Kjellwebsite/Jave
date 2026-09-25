import { useMemo, useState } from 'react';
import { detectDevice } from '../app/device';
import { navigate } from '../app/router';
import { currentSession, startSession } from '../app/sessions';
import { Footer, Header } from '../components/Chrome';
import { Button, Label, Tag } from '../components/ui';
import { BATTERIES } from '../engine/batteries';
import { getParadigm } from '../engine/registry';
import { deleteSession } from '../data/storage';
import './setup.css';

type Choice = 'quick' | 'core' | 'full';

export default function Setup() {
  const [mode, setMode] = useState<Choice>('core');
  const [agreed, setAgreed] = useState(false);
  const device = useMemo(detectDevice, []);
  const [active, setActive] = useState(() => currentSession());

  const begin = () => {
    startSession(mode);
    navigate('assessment');
  };

  const battery = BATTERIES[mode];
  const domains = new Set(battery.paradigms.map((p) => getParadigm(p).domain));

  return (
    <>
      <Header />
      <main id="main" className="wrap setup">
        <section className="section">
          <div className="section-head">
            <Label>Before you begin</Label>
            <h2>Choose the length of your assessment.</h2>
            <p>All formats adapt to you. Longer formats measure more domains and reach tighter estimates.</p>
          </div>

          {active ? (
            <div className="resume-card">
              <div>
                <Label>Assessment in progress</Label>
                <p>
                  {BATTERIES[active.mode as Choice]?.label ?? 'Single instrument'} · section {Math.min(active.cursor + 1, active.plan.length)} of {active.plan.length}
                </p>
              </div>
              <div className="resume-actions">
                <Button onClick={() => navigate('assessment')}>Resume</Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    deleteSession(active.id);
                    setActive(null);
                  }}
                >
                  Discard
                </Button>
              </div>
            </div>
          ) : null}

          <div className="setup-grid">
            <fieldset className="mode-options">
              <legend className="sr-only">Assessment length</legend>
              {(['quick', 'core', 'full'] as const).map((m) => (
                <label key={m} className={`mode-option ${mode === m ? 'is-selected' : ''}`}>
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                  <span className="mode-option-head">
                    <span className="mode-option-name">{BATTERIES[m].label}</span>
                    <span className="mono mode-option-min">~{BATTERIES[m].minutes} min</span>
                  </span>
                  <span className="mode-option-desc">{BATTERIES[m].description}</span>
                  <span className="mono mode-option-count">{BATTERIES[m].paradigms.length} sections</span>
                </label>
              ))}
            </fieldset>

            <aside className="setup-panel">
              <div className="setup-summary">
                <Label>{battery.label} assessment</Label>
                <div className="setup-big">~{battery.minutes}<span> min</span></div>
                <dl className="setup-facts mono">
                  <div><dt>Sections</dt><dd>{battery.paradigms.length}</dd></div>
                  <div><dt>Domains</dt><dd>{domains.size} of 11</dd></div>
                  <div><dt>Difficulty</dt><dd>Adaptive</dd></div>
                  <div><dt>Pausable</dt><dd>Yes</dd></div>
                </dl>
              </div>

              <div className="setup-block">
                <Label>Your device</Label>
                <ul className="setup-checks">
                  <li>
                    <Tag tone={device.input === 'mouse' ? 'neutral' : 'outline'}>{device.input === 'mouse' ? 'Keyboard' : 'Touch'}</Tag>
                    {device.input === 'mouse'
                      ? 'Keyboard and mouse detected. Recommended.'
                      : 'Touch detected. Everything works, but reaction times will not be comparable with keyboard results.'}
                  </li>
                  <li>
                    <Tag>{device.viewport}</Tag>
                    {device.viewport === 'small' ? 'Small screen. A larger screen is better for matrices and visual search.' : 'Screen size is suitable.'}
                  </li>
                  <li>
                    <Tag>Quiet</Tag>A quiet room without interruptions. Sections can be paused between items.
                  </li>
                </ul>
              </div>

              <div className="setup-block">
                <Label>Please note</Label>
                <p className="setup-note">
                  JVLN is an experimental assessment. Results are provisional estimates on the measured tasks, not a clinical or diagnostic test, and not an IQ score. Responses stay in this browser.
                </p>
                <label className="consent">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I understand, and I will work on my own without outside help.</span>
                </label>
              </div>

              <Button size="lg" onClick={begin} disabled={!agreed} className="setup-begin">
                Begin {battery.label.toLowerCase()} assessment
              </Button>
              <p className="setup-footnote">Every unfamiliar task starts with practice. Practice is never scored.</p>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
