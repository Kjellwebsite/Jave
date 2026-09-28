import { ExplodedTablet } from '@/components/ExplodedTablet';
import { PHASE_IDS, type Product, type ReleaseMatrix as ReleaseCopy } from '@/lib/products';
import { clock, NIGHT } from '@/lib/sleep';
import { LAYER_COLORS } from './chartTokens';
import { NightChart } from './NightChart';
import { DecayChart, EffectPlot, StageBar } from './SleepCharts';

const BARRIER_COLOR = '#8e86b8';

const LEVELS: Record<number, string> = {
  3: 'Meta-Analyse am Menschen',
  2: 'Randomisierte Studie am Menschen',
  1: 'Tierstudie',
};

function Source({ label, href }: { label: string; href?: string }) {
  if (!href) return <span className="rm-source">{label}</span>;
  return (
    <a className="rm-source link-u" href={href} target="_blank" rel="noopener noreferrer">
      {label}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (öffnet in neuem Tab)</span>
    </a>
  );
}

function Level({ level }: { level: number }) {
  return (
    <span
      className="rm-level"
      role="img"
      aria-label={`Evidenzstufe ${level} von 3: ${LEVELS[level]}`}
    >
      {[1, 2, 3].map((step) => (
        <span key={step} data-on={step <= level || undefined} />
      ))}
    </span>
  );
}

/**
 * "Double Release Matrix": the tablet's three layers, a night of sleep against the release
 * profile, one card per phase with its data, the ingredient matrix and the studies behind it.
 */
export function ReleaseMatrix({
  product,
  copy,
  textClass,
}: {
  product: Product;
  copy: ReleaseCopy;
  textClass: string;
}) {
  const [top, core] = copy.layers;
  const windows = [
    [0, (top?.end ?? 0) * 60],
    [(top?.end ?? 0) * 60, (core?.end ?? 0) * 60],
    [(core?.end ?? 0) * 60, NIGHT.minutes],
  ] as const;
  const withEffects = product.ingredients.find((i) => i.evidence?.effects?.length);
  const halfLifeOf = product.ingredients.find((i) => i.name === copy.halfLife.ingredient);
  const byLayer = (layer: number) => product.ingredients.filter((i) => i.layer === layer);

  return (
    <section id="matrix" aria-labelledby="matrix-title" className={`${textClass} rm`}>
      <div className="rm-intro">
        <div className="flex flex-col gap-[18px]">
          <span className="font-display text-[13px] font-bold tracking-[0.5px] opacity-80">
            {copy.eyebrow}
          </span>
          <h2
            id="matrix-title"
            className="m-0 font-serif text-[44px] leading-[1.02] font-normal text-balance sm:text-[56px]"
          >
            {copy.title}
          </h2>
          <p className="m-0 max-w-[560px] text-[17px] leading-[1.6] sm:text-[18px]">{copy.lead}</p>
        </div>

        <div className="ex-visual rm-tablet">
          <div aria-hidden="true" className="ex-art">
            <div
              className="ex-glow"
              style={{
                background: `radial-gradient(closest-side, ${product.colors.glow}, rgba(255,255,255,0))`,
              }}
            />
            <div className="ex-shadow" />
            <ExplodedTablet product={product} />
          </div>
          <ol
            className="ex-labels ex-labels-static"
            aria-label="Die drei Schichten, von oben nach unten"
          >
            {copy.layers.map((layer, k) => {
              const color = LAYER_COLORS[k] ?? BARRIER_COLOR;
              const actives = byLayer(k);
              return (
                <li key={layer.name} className="ex-label">
                  <span aria-hidden="true" className="ex-connector">
                    <span
                      className="absolute -top-[3.5px] -left-1 size-2 rounded-full"
                      style={{ background: color, boxShadow: `0 0 10px ${color}` }}
                    />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-display text-[14px] font-bold sm:text-[15px]">
                      {layer.name}
                    </span>
                    <span className="text-[12px] leading-[1.4] opacity-75 sm:text-[13px]">
                      {layer.text}
                    </span>
                    {actives.length > 0 && (
                      <span className="text-[12px] leading-[1.4] font-semibold sm:text-[13px]">
                        {actives.map((i) => `${i.name} ${i.dose}`).join(', ')}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="rm-card rm-night">
        <NightChart release={copy} />
      </div>

      <div className="rm-phases">
        {copy.phases.map((phase, k) => (
          <article
            key={phase.id}
            className="rm-card rm-phase"
            aria-labelledby={`phase-${phase.id}`}
          >
            <div className="flex flex-col gap-2">
              <span className="rm-time">
                {clock(windows[k]![0])} bis {clock(windows[k]![1])}
              </span>
              <h3
                id={`phase-${phase.id}`}
                className="m-0 font-serif text-[30px] leading-none font-normal"
              >
                {phase.title}
              </h3>
              <p className="m-0 text-[15px] leading-[1.55] opacity-90">{phase.text}</p>
            </div>
            {phase.id === 'einschlafen' && withEffects?.evidence && (
              <>
                <EffectPlot effects={withEffects.evidence.effects!} />
                <p className="rm-cite">
                  {withEffects.name}, {withEffects.evidence.kind}. Mittelwert mit
                  95-%-Konfidenzintervall.{' '}
                  <Source label={withEffects.evidence.source} href={withEffects.evidence.url} />
                </p>
              </>
            )}
            {phase.id === 'durchschlafen' && (
              <>
                <StageBar />
                <p className="rm-cite">
                  Anteile am Schlaf in der typischen Nacht oben, daneben der Richtwert für gesunde
                  junge Erwachsene.{' '}
                  <Source label="Carskadon & Dement, Principles and Practice of Sleep Medicine" />
                </p>
              </>
            )}
            {phase.id === 'aufwachen' && halfLifeOf && (
              <>
                <DecayChart halfLifeMinutes={copy.halfLife.minutes} />
                <p className="rm-cite">
                  {halfLifeOf.name} {halfLifeOf.dose} um {clock(0)}, relativ zum Spitzenwert. Modell
                  mit einer Halbwertszeit von {copy.halfLife.minutes} Minuten.{' '}
                  <Source label={copy.halfLife.source} href={copy.halfLife.url} />
                </p>
              </>
            )}
          </article>
        ))}
      </div>

      <div className="rm-card rm-matrix">
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 font-serif text-[30px] leading-[1.1] font-normal">Wirkstoffmatrix</h3>
          <p className="m-0 text-[14px] leading-[1.5] opacity-75">
            Was jeder Wirkstoff in welcher Phase beiträgt. Markiert sind zugelassene
            gesundheitsbezogene Angaben der EU.
          </p>
        </div>
        <table className="rm-table">
          <caption className="sr-only">Wirkstoffmatrix von Lull {product.name}</caption>
          <thead>
            <tr>
              <th scope="col">Wirkstoff</th>
              {copy.phases.map((phase, k) => (
                <th key={phase.id} scope="col">
                  {phase.title}
                  <span>
                    {clock(windows[k]![0])} bis {clock(windows[k]![1])}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {product.ingredients.map((ingredient) => {
              const layer = ingredient.layer ?? 0;
              return (
                <tr key={ingredient.name}>
                  <th scope="row">
                    <span className="rm-name">{ingredient.name}</span>
                    <span className="rm-dose">{ingredient.dose}</span>
                    <span className="rm-chip">
                      <span style={{ background: LAYER_COLORS[layer] ?? BARRIER_COLOR }} />
                      {copy.layers[layer]?.name}
                    </span>
                  </th>
                  {PHASE_IDS.map((id, k) => {
                    const role = ingredient.roles?.find((r) => r.phase === id);
                    return (
                      <td
                        key={id}
                        data-label={copy.phases[k]?.title}
                        data-empty={!role || undefined}
                      >
                        {role ? (
                          <>
                            <span className="rm-text">{role.text}</span>
                            {role.claim && <span className="rm-claim">EU-Health-Claim</span>}
                          </>
                        ) : (
                          <span aria-label="kein direkter Beitrag">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <h3 className="m-0 font-serif text-[30px] leading-[1.1] font-normal">
            Was die Studien zeigen
          </h3>
          <ul className="rm-level-legend" aria-label="Evidenzstufen">
            {[3, 2, 1].map((level) => (
              <li key={level}>
                <Level level={level} />
                {LEVELS[level]}
              </li>
            ))}
          </ul>
        </div>
        <div className="rm-evidence">
          {product.ingredients.map((ingredient) =>
            ingredient.evidence ? (
              <article key={ingredient.name} className="rm-card rm-study">
                <div className="flex items-center justify-between gap-3">
                  <span className="rm-kind">{ingredient.evidence.kind}</span>
                  <Level level={ingredient.evidence.level} />
                </div>
                <h4 className="m-0 font-display text-[16px] font-bold">
                  {ingredient.name}{' '}
                  <span className="font-semibold opacity-60">{ingredient.dose}</span>
                </h4>
                <p className="m-0 text-[15px] leading-[1.55]">{ingredient.evidence.finding}</p>
                <Source label={ingredient.evidence.source} href={ingredient.evidence.url} />
              </article>
            ) : null,
          )}
        </div>
      </div>

      <p className="rm-note">{copy.note}</p>
    </section>
  );
}
