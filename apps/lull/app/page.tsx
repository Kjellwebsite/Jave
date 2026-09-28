import { SiteFooter } from '@/components/SiteFooter';
import { BuildSection } from '@/components/home/BuildSection';
import { Certificate } from '@/components/home/Certificate';
import { Faq } from '@/components/home/Faq';
import { Finder } from '@/components/home/Finder';
import { Hero } from '@/components/home/Hero';
import { Marquee } from '@/components/home/Marquee';
import { Shipping } from '@/components/home/Shipping';
import { Sortiment } from '@/components/home/Sortiment';
import { Stats } from '@/components/home/Stats';
import {
  CERTIFICATE_REPORT_URL,
  CONTACT_URL,
  pendingHref,
  placeholdersEnabled,
} from '@/lib/launch';
import { PRODUCTS } from '@/lib/products';
import { overallRating } from '@/lib/ratings';

export default function HomePage() {
  const placeholders = placeholdersEnabled();
  return (
    <main className="relative isolate overflow-x-clip">
      <Hero rating={placeholders ? overallRating(PRODUCTS) : null} />
      {/* flow-root: the marquee's top margin must not collapse through and open a gap. */}
      <div className="relative flow-root">
        <div aria-hidden="true" className="bg-under home-lower-bg" />
        <div aria-hidden="true" className="grain grain-under" />
        <Marquee />
        <Stats />
        <Finder />
        <Sortiment showRatings={placeholders} />
        <BuildSection />
        <Certificate reportHref={pendingHref(CERTIFICATE_REPORT_URL, '#zertifikat')} />
        <Shipping />
        <Faq contactHref={pendingHref(CONTACT_URL, '#faq')} />
        <div className="wrap on-light mt-20 pb-10 text-ink-soft lg:mt-24">
          <SiteFooter />
        </div>
      </div>
    </main>
  );
}
