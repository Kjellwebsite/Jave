/** Test fixtures: real-shaped Crossref and arXiv payloads (trimmed). */

export const CROSSREF_WORK = {
  status: 'ok',
  message: {
    DOI: '10.1038/nature12373',
    title: ['Nanometre-scale thermometry in a living cell'],
    author: [
      { given: 'G.', family: 'Kucsko' },
      { given: 'P. C.', family: 'Maurer' },
      { name: 'The Lab Consortium' },
    ],
    'container-title': ['Nature'],
    published: { 'date-parts': [[2013, 7, 31]] },
    abstract: '<jats:p>Sensitive probing of temperature &amp; heat.</jats:p>',
  },
};

export function arxivFeed(id: string, title = 'Attention Is All You Need'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/${id}v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>${title}</title>
    <summary>  The dominant sequence transduction models are based on
      complex recurrent &lt;or&gt; convolutional networks.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
  </entry>
</feed>`;
}
