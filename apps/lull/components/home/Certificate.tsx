import { Reveal } from '@/components/Reveal';
import { CERTIFICATE } from '@/lib/content';

/** The rotating AM seal: circular caption, foil disc with sheen, and a check mark drawn on loop. */
function Seal() {
  return (
    <div className="seal" aria-hidden="true">
      <div className="seal-glow" />
      <svg className="seal-ring" viewBox="0 0 360 360">
        <defs>
          <path id="seal-path" d="M180,180 m-156,0 a156,156 0 1,1 312,0 a156,156 0 1,1 -312,0" />
        </defs>
        <circle cx="180" cy="180" r="172" fill="none" stroke="#1c1548" strokeOpacity="0.14" />
        <text
          fill="#1c1548"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 4,
          }}
        >
          <textPath href="#seal-path">{CERTIFICATE.ring}</textPath>
        </text>
      </svg>
      <div className="seal-disc">
        <div className="foil-sheen" />
        <svg className="seal-check" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="21" fill="#1c1548" />
          <path
            d="M13 22.5 L19.5 29 L31 16"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="seal-am">AM</span>
        <span className="seal-caption">ZERTIFIZIERT</span>
      </div>
    </div>
  );
}

export function Certificate({ reportHref }: { reportHref: string | null }) {
  return (
    <Reveal
      as="section"
      id="zertifikat"
      aria-labelledby="zertifikat-title"
      className="wrap on-light relative mt-20 text-ink lg:mt-[100px]"
    >
      <div aria-hidden="true" className="h-px bg-ink/16" />
      <div className="grid items-start gap-10 pt-12 lg:grid-cols-[360px_minmax(0,730px)] lg:justify-between lg:gap-[90px] lg:pt-[70px] lg:pl-5">
        <div className="flex justify-center lg:block">
          <Seal />
        </div>
        <div className="flex flex-col gap-[22px]">
          <h2
            id="zertifikat-title"
            className="m-0 font-serif text-[48px] leading-none font-normal sm:text-[64px]"
          >
            {CERTIFICATE.title}
          </h2>
          <p className="m-0 max-w-[640px] text-[17px] leading-[1.6] text-ink-soft sm:text-[19px]">
            {CERTIFICATE.lead}
          </p>
          <ul className="mt-1 grid gap-x-9 gap-y-[22px] sm:grid-cols-2">
            {CERTIFICATE.checks.map((check, k) => (
              <li
                key={check.title}
                className="ck flex items-start gap-3.5"
                style={{ animationDelay: `${(0.2 + k * 0.12).toFixed(2)}s` }}
              >
                <svg
                  className="ck-badge shrink-0"
                  width="30"
                  height="30"
                  viewBox="0 0 30 30"
                  aria-hidden="true"
                >
                  <circle cx="15" cy="15" r="15" fill={check.color} />
                  <path
                    d="M9 15.5 L13.5 20 L21.5 11"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ animationDelay: `${(0.45 + k * 0.12).toFixed(2)}s` }}
                  />
                </svg>
                <span className="flex flex-col gap-[3px]">
                  <span className="font-display text-[16px] font-bold">{check.title}</span>
                  <span className="text-[15px] leading-[1.5] text-ink-mute">{check.text}</span>
                </span>
              </li>
            ))}
          </ul>
          {reportHref && (
            <a
              href={reportHref}
              className="link-u mt-1 self-start text-[16px] font-semibold text-ink"
            >
              {CERTIFICATE.reportLabel}
            </a>
          )}
        </div>
      </div>
    </Reveal>
  );
}
