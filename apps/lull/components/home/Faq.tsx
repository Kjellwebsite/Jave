'use client';

import { useId, useState } from 'react';
import { Reveal } from '@/components/Reveal';
import { FAQ } from '@/lib/content';

/** Accordion: one answer open at a time, the first one to start with. */
export function Faq({ contactHref }: { contactHref: string | null }) {
  const [openIndex, setOpenIndex] = useState(0);
  const baseId = useId();

  return (
    <Reveal
      as="section"
      id="faq"
      aria-labelledby="faq-title"
      className="wrap on-light relative mt-20 text-ink lg:mt-[100px]"
    >
      <div className="grid gap-10 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-[72px]">
        <div className="flex flex-col gap-5 lg:pt-2.5">
          <h2
            id="faq-title"
            className="m-0 font-serif text-[52px] leading-[0.98] font-normal sm:text-[68px]"
          >
            Fragen und Antworten
          </h2>
          <p className="m-0 text-[17px] leading-[1.6] text-ink-soft">
            Deine Frage ist nicht dabei? Schreib uns, wir antworten meist innerhalb weniger Stunden.
          </p>
          {contactHref && (
            <a href={contactHref} className="btn btn-ink h-[54px] self-start px-7 text-[16px]">
              Frag uns direkt
            </a>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {FAQ.map((item, i) => {
            const open = i === openIndex;
            const buttonId = `${baseId}-q${i}`;
            const panelId = `${baseId}-a${i}`;
            return (
              <div key={item.q} className={open ? 'faq-item open' : 'faq-item'}>
                <h3 className="m-0 font-normal">
                  <button
                    id={buttonId}
                    type="button"
                    className="faq-q flex w-full items-center justify-between gap-4 px-5 py-5 text-left font-serif text-[22px] leading-[1.15] text-ink sm:gap-6 sm:px-7 sm:py-6 sm:text-[28px]"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(open ? -1 : i)}
                  >
                    <span>{item.q}</span>
                    <span aria-hidden="true" className="faq-icon">
                      <span className="bar-h" />
                      <span className="bar-v" />
                    </span>
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  aria-hidden={!open}
                  className="faq-a"
                >
                  <div className="overflow-hidden">
                    <p className="m-0 px-5 pb-6 text-[16px] leading-[1.65] text-ink-soft sm:pr-[90px] sm:pb-[26px] sm:pl-7 sm:text-[17px]">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Without JavaScript every answer stays readable. */}
      <noscript
        dangerouslySetInnerHTML={{
          __html:
            '<style>.faq-a{grid-template-rows:1fr!important}.faq-a p{opacity:1!important;transform:none!important}</style>',
        }}
      />
    </Reveal>
  );
}
