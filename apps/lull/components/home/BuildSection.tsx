import { ExplodedTablet } from '@/components/ExplodedTablet';
import { Reveal } from '@/components/Reveal';
import { BUILD_PRINCIPLES, LAYER_LABELS } from '@/lib/content';
import { DEFAULT_PRODUCT } from '@/lib/products';

export function BuildSection() {
  return (
    <Reveal
      as="section"
      id="prinzip"
      aria-labelledby="prinzip-title"
      className="wrap on-light relative mt-24 text-ink lg:mt-[130px]"
    >
      <div aria-hidden="true" className="h-px bg-ink/16" />
      <div className="grid items-start gap-8 pt-10 xl:grid-cols-[700px_minmax(0,440px)] xl:justify-between xl:gap-10">
        <div>
          <div className="ex-visual">
            <div aria-hidden="true" className="ex-art">
              <div className="ex-glow" />
              <div className="ex-shadow" />
              <ExplodedTablet product={DEFAULT_PRODUCT} />
            </div>
            <ol className="ex-labels" aria-label="Die drei Schichten, von oben nach unten">
              {LAYER_LABELS.map((label, k) => (
                <li
                  key={label.title}
                  className="ex-label"
                  style={{ animationDelay: `${k * 0.15}s` }}
                >
                  <span aria-hidden="true" className="ex-connector">
                    <span
                      className="absolute -top-[3.5px] -left-1 size-2 rounded-full"
                      style={{ background: label.color, boxShadow: `0 0 10px ${label.color}` }}
                    />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-display text-[14px] font-bold sm:text-[15px]">
                      {label.title}
                    </span>
                    <span className="text-[12px] leading-[1.35] text-ink-mute sm:text-[13px]">
                      {label.text}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex flex-col gap-7 xl:pt-[30px]">
          <h2
            id="prinzip-title"
            className="m-0 font-serif text-[48px] leading-none font-normal sm:text-[60px]"
          >
            Wie wir bauen
          </h2>
          {BUILD_PRINCIPLES.map((principle) => (
            <div key={principle.title} className="flex flex-col gap-2">
              <h3 className="m-0 font-display text-[17px] font-bold">{principle.title}</h3>
              <p className="m-0 text-[16px] leading-[1.6] text-ink-soft">{principle.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
