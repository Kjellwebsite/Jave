import { expect, type Page, test } from '@playwright/test';
import { signInAs } from './fixtures';
import { SEEDED_PAPERS } from './seed-ai-research';

test.describe.configure({ mode: 'serial' });

const NEW_PAPER = {
  title: 'Attention is all you need',
  arxivId: '1706.03762',
};
const UNKNOWN_ITEM = '/research/00000000-0000-4000-8000-000000000000';

/** A titled Panel (a <section> whose header strip carries the title). */
function panelTitled(page: Page, title: string) {
  return page.locator('section', { has: page.getByRole('heading', { name: title, exact: true }) });
}

function proposal(page: Page, panel: string, kind: string) {
  return panelTitled(page, panel).getByRole('article', { name: `${kind} proposal` });
}

async function openItem(page: Page, title: string): Promise<void> {
  await page.goto(`/research?q=${encodeURIComponent(title)}`);
  await page.getByRole('link', { name: title }).first().click();
  await page.waitForURL(/\/research\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test.describe('JAVE AI console', () => {
  test('founder sees the provider, usage and a confirmation queue', async ({ page }) => {
    await signInAs(page, 'founder');
    await page.getByRole('link', { name: 'JAVE AI' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'JAVE AI' })).toBeVisible();
    await expect(page.getByText('MOCK / DEVELOPMENT ONLY', { exact: true })).toBeVisible();
    await expect(page.getByText('REACHABLE')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Organization today' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'AI usage by member today' })).toContainText(
      'Mara Voss',
    );
    await expect(
      page.getByRole('navigation', { name: 'JAVE AI sections' }).getByLabel('2 awaiting your confirmation'),
    ).toBeVisible();
  });

  test('founder confirms a drafted mission and rejects an announcement', async ({ page }) => {
    await signInAs(page, 'founder');
    await page.goto('/ai?tab=proposals');
    const mission = proposal(page, 'Awaiting your confirmation', 'Draft mission');
    await expect(mission).toContainText('Decode the CubeSat beacon');
    await mission.getByTestId('confirm-proposal').click();
    const confirm = page.getByRole('dialog', { name: 'Create draft mission' });
    await expect(confirm).toContainText('Created as DRAFT');
    await confirm.getByRole('button', { name: 'Create draft mission' }).click();
    await expect(page.getByText(/MISSION DRAFTED — #\d{4} Decode the CubeSat beacon/)).toBeVisible();
    await expect(mission).toBeHidden();

    const announcement = proposal(page, 'Awaiting your confirmation', 'Announcement');
    await announcement.getByTestId('reject-proposal').click();
    const reject = page.getByRole('dialog', { name: 'Reject proposal' });
    await reject.getByLabel('Reason').fill('Wait until the brief is final.');
    await reject.getByRole('button', { name: 'Reject proposal' }).click();
    await expect(page.getByText('PROPOSAL REJECTED — ANNOUNCEMENT. Nothing was executed.')).toBeVisible();
    await expect(page.getByText('NOTHING TO CONFIRM')).toBeVisible();
  });

  test('founder drafts an announcement; nothing posts until it is confirmed', async ({ page }) => {
    await signInAs(page, 'founder');
    await page.goto('/ai?tab=proposals');
    await page.getByLabel('Announcement brief').fill('Ground station maintenance on Saturday.');
    await page.getByRole('button', { name: 'Draft announcement' }).click();
    await expect(page.getByText(/PROPOSAL READY — ANNOUNCEMENT/)).toBeVisible();
    const drafted = proposal(page, 'Your proposals', 'Announcement').first();
    await expect(drafted).toContainText('PENDING');
    await drafted.getByTestId('confirm-proposal').click();
    await page
      .getByRole('dialog', { name: 'Post announcement' })
      .getByRole('button', { name: 'Post announcement' })
      .click();
    await expect(page.getByText(/ANNOUNCEMENT QUEUED/)).toBeVisible();
    await expect(proposal(page, 'Your proposals', 'Announcement').first()).toContainText('QUEUED');
  });

  test('the ledger shows metadata only, everyone to auditors', async ({ page }) => {
    await signInAs(page, 'founder');
    await page.goto('/ai?tab=ledger');
    const ledger = page.getByRole('table', { name: 'AI requests' });
    await expect(ledger.getByRole('columnheader', { name: 'Member' })).toBeVisible();
    await expect(ledger).toContainText('Sana Okafor');
    await expect(ledger).not.toContainText('Does sleep help memory');
    await page.getByLabel('Feature').selectOption('research');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/feature=research/);
    await expect(ledger.locator('tbody tr')).toHaveCount(1);
  });

  test('BREAK: a member sees only their own requests and no staff controls', async ({ page }) => {
    await signInAs(page, 'member');
    await page.goto('/ai');
    await expect(page.getByRole('heading', { name: 'Organization today' })).toBeHidden();
    await expect(page.getByText('Usage by member today')).toBeHidden();
    await page.goto('/ai?tab=proposals');
    await expect(page.getByText('Awaiting your confirmation')).toBeHidden();
    await expect(page.getByText('Draft with JAVE AI')).toBeHidden();
    await expect(page.getByTestId('confirm-proposal')).toHaveCount(0);
    await page.goto('/ai?tab=ledger');
    await expect(page.getByText('Your AI requests.')).toBeVisible();
    const ledger = page.getByRole('table', { name: 'AI requests' });
    await expect(ledger.getByRole('columnheader', { name: 'Member' })).toHaveCount(0);
    await expect(ledger.locator('tbody tr')).toHaveCount(1);
    await expect(ledger).toContainText('Summarize');
  });
});

test.describe('research library', () => {
  test('a member adds a reference; a duplicate opens the existing item', async ({ page }) => {
    await signInAs(page, 'verified');
    await page.getByRole('link', { name: 'Research' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Research' })).toBeVisible();
    await expect(page.getByText('SIDUS NOT CONFIGURED')).toBeVisible();
    await page.getByTestId('add-reference').click();
    const dialog = page.getByRole('dialog', { name: 'Add reference' });
    await dialog.getByLabel('Title').fill(NEW_PAPER.title);
    await dialog.getByLabel('arXiv ID').fill(NEW_PAPER.arxivId);
    await dialog.getByLabel('Tags').fill('transformers, attention');
    await dialog.getByRole('button', { name: 'Add to library' }).click();
    await page.waitForURL(/\/research\/[0-9a-f-]{36}$/);
    const itemUrl = page.url();
    await expect(page.getByRole('heading', { level: 1, name: NEW_PAPER.title })).toBeVisible();
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: NEW_PAPER.arxivId })).toHaveAttribute(
      'href',
      `https://arxiv.org/abs/${NEW_PAPER.arxivId}`,
    );
    await expect(page.getByText('Review', { exact: true })).toBeHidden();

    await page.goto('/research');
    await page.getByTestId('add-reference').click();
    const again = page.getByRole('dialog', { name: 'Add reference' });
    await again.getByLabel('arXiv ID').fill(`arXiv:${NEW_PAPER.arxivId}v2`);
    await again.getByRole('button', { name: 'Add to library' }).click();
    await page.waitForURL(itemUrl);
  });

  test('search and filters narrow the library', async ({ page }) => {
    await signInAs(page, 'verified');
    await page.goto('/research');
    await page.getByRole('searchbox', { name: 'Search research' }).fill('numpy');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/q=numpy/);
    const rows = page.getByRole('table', { name: 'Research items' }).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(SEEDED_PAPERS.numpy);
    await expect(rows.first()).toContainText('VERIFIED');
    await page.goto('/research?status=reviewed');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(SEEDED_PAPERS.alphafold);
    await page.goto('/research?tag=nothing-tagged-this');
    await expect(page.getByText('NO MATCHES')).toBeVisible();
  });

  test('a reviewer verifies the item and pushes it to Sidus', async ({ page }) => {
    await signInAs(page, 'operations');
    await openItem(page, NEW_PAPER.title);
    const review = page.getByRole('form', { name: 'Review' });
    await review.getByLabel('Status').selectOption('verified');
    await review.getByLabel('Evidence level').selectOption('peer_reviewed');
    await review.getByLabel('Topic').fill('Machine learning');
    await review.getByRole('button', { name: 'Record review' }).click();
    await expect(page.getByText('REVIEW RECORDED — VERIFIED — evidence: PEER REVIEWED.')).toBeVisible();
    await expect(page.getByText('VERIFIED', { exact: true }).first()).toBeVisible();

    await page.getByTestId('push-sidus').click();
    await page
      .getByRole('dialog', { name: 'Push to Sidus' })
      .getByRole('button', { name: 'Push to Sidus' })
      .click();
    await expect(page.getByText(/SIDUS SYNC QUEUED/)).toBeVisible();
    await expect(panelTitled(page, 'Sidus sync')).toContainText('PENDING');
  });

  test('BREAK: stale reviews, own submissions and unknown items are refused', async ({ browser }) => {
    const reviewer = await browser.newPage();
    const second = await browser.newPage();
    await signInAs(reviewer, 'operations');
    await signInAs(second, 'core');
    await openItem(reviewer, SEEDED_PAPERS.sleep);
    await openItem(second, SEEDED_PAPERS.sleep);
    await second.getByRole('form', { name: 'Review' }).getByLabel('Status').selectOption('reviewed');
    await second.getByRole('form', { name: 'Review' }).getByLabel('Evidence level').selectOption('observational');
    await second.getByRole('button', { name: 'Record review' }).click();
    await expect(second.getByText(/REVIEW RECORDED — REVIEWED/)).toBeVisible();
    // The first reviewer still has the old version on screen.
    await reviewer.getByRole('form', { name: 'Review' }).getByLabel('Status').selectOption('verified');
    await reviewer.getByRole('form', { name: 'Review' }).getByLabel('Evidence level').selectOption('anecdotal');
    await reviewer.getByRole('button', { name: 'Record review' }).click();
    await expect(reviewer.getByText('This item changed while you were reviewing it.', { exact: false })).toBeVisible();
    await reviewer.close();
    await second.close();

    const page = await browser.newPage();
    await signInAs(page, 'verified');
    await openItem(page, SEEDED_PAPERS.sleep);
    await expect(page.getByRole('form', { name: 'Review' })).toHaveCount(0);
    await expect(page.getByTestId('push-sidus')).toHaveCount(0);
    const response = await page.goto(UNKNOWN_ITEM);
    expect(response?.status()).toBe(404);
    await expect(page.getByText('NOT FOUND')).toBeVisible();
    await page.close();
  });
});
