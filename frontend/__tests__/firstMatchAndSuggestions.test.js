/*
 * C1a/C1b — the last three of feature 1.
 *
 * FirstMatch shows ONE REAL scored row from the same query the feed runs, so
 * the product proves itself while the user is still deciding whether to
 * finish. Constraint 1 governs the empty case: a fabricated "76% Senior
 * Product Designer at X" would be the single most damaging lie in the product,
 * because it is the first thing a new user ever sees it claim.
 *
 * SuggestSelect exists because the spec forbids an empty field with only a
 * placeholder. Its suggestions are real - the user's own parsed roles, and
 * cities read from the index - because a suggestion the feed cannot match is a
 * promise the next screen breaks.
 */

import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FirstMatch from '../components/FirstMatch';
import SuggestSelect from '../components/SuggestSelect';

const JOB = {
  id: 1, title: 'Senior Product Designer', company_name: 'Acme',
  location: 'Bengaluru', overall_score: 0.76,
};

const respond = (body, ok = true, status = 200) => {
  global.fetch = jest.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) }));
};

beforeEach(() => { localStorage.setItem('token', 't'); });

describe('the first match is real, or it is not shown', () => {
  it('shows the row and its score from the real query', async () => {
    respond({ jobs: [JOB], total: 1 });
    render(<FirstMatch title="Product Designer" />);

    expect(await screen.findByText('Senior Product Designer')).toBeInTheDocument();
    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
    // Same endpoint the feed uses - the argument that carries the value.
    expect(String(global.fetch.mock.calls[0][0])).toMatch(/\/api\/jobs\?.*search=Product/);
  });

  it('says nothing matches yet rather than inventing one', async () => {
    respond({ jobs: [], total: 0 });
    render(<FirstMatch title="Underwater Basket Weaver" />);

    expect(await screen.findByText(/Nothing matches that yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('does not read a 502 body as "no matches"', async () => {
    // An error page is JSON too. Treating it as an empty result would tell a
    // new user their search found nothing when the search never ran.
    respond({ jobs: [], total: 0 }, false, 502);
    render(<FirstMatch title="Designer" />);

    expect(await screen.findByText(/could not check for matches/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing matches that yet/i)).not.toBeInTheDocument();
  });

  it('never shows a percentage for an unscored row', async () => {
    respond({ jobs: [{ ...JOB, overall_score: null }], total: 1 });
    render(<FirstMatch title="Designer" />);

    expect(await screen.findByText('Senior Product Designer')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();
    expect(screen.getByText(/Not scored yet/i)).toBeInTheDocument();
  });

  it('asks nothing before there is a title to ask about', () => {
    respond({ jobs: [] });
    render(<FirstMatch title="" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

function SuggestHarness({ suggestions }) {
  const [v, setV] = useState('');
  return <SuggestSelect label="Where do you want to work?" value={v} onChange={setV} suggestions={suggestions} placeholder="e.g. Bengaluru" />;
}

describe('the field is never empty with only a placeholder', () => {
  it('offers real suggestions as taps, visible without focusing', () => {
    render(<SuggestHarness suggestions={['Bengaluru', 'Hyderabad', 'Pune']} />);
    expect(screen.getByRole('button', { name: 'Bengaluru' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pune' })).toBeInTheDocument();
  });

  /*
   * The field is queried as a COMBOBOX, not a textbox: an input bound to a
   * <datalist> takes that role, which is the correct semantics and what a
   * screen reader announces. Asserting textbox failed and the component was
   * right - worth keeping as a note rather than a scar.
   */
  it('fills the field on a tap', async () => {
    const user = userEvent.setup();
    render(<SuggestHarness suggestions={['Bengaluru', 'Pune']} />);

    await user.click(screen.getByRole('button', { name: 'Bengaluru' }));

    expect(screen.getByRole('combobox')).toHaveValue('Bengaluru');
  });

  it('still allows typing - the suggestions are a shortcut, not a cage', async () => {
    const user = userEvent.setup();
    render(<SuggestHarness suggestions={['Bengaluru']} />);

    await user.type(screen.getByRole('combobox'), 'Kochi');

    expect(screen.getByRole('combobox')).toHaveValue('Kochi');
  });

  it('renders nothing extra when there is nothing real to suggest', () => {
    // Better an ordinary field than an invented list of places.
    render(<SuggestHarness suggestions={[]} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('does not offer the same value twice', () => {
    render(<SuggestHarness suggestions={['Pune', 'Pune', ' Pune ', '']} />);
    expect(screen.getAllByRole('button', { name: 'Pune' })).toHaveLength(1);
  });
});

/*
 * Found on production, not by a test: the location field offered
 * "north_america", "europe" and "unspecified" as places to work. Raw region
 * bucket keys - the wrong granularity for a question asking about a city, and
 * one of them not somewhere a person can want to work at all.
 */
describe('a suggestion is never a raw database token', () => {
  const { humanise } = require('../lib/labels');

  it('humanises a region key rather than showing it', () => {
    expect(humanise('north_america')).toBe('North america');
    expect(humanise('asia_pacific')).toBe('Asia pacific');
  });

  it('the onboarding page drops the unspecified bucket', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'pages', 'onboarding.js'), 'utf8'
    );
    expect(src).toMatch(/unspecified\|not\[ _-\]\?specified/);
    expect(src).toMatch(/humanise\(r\.value\)/);
  });

  it('describes them as regions, and takes them from the index region facet', () => {
    /*
     * This asserted only that the sentence "Regions where the jobs in our
     * index are" is present. The sentence makes a checkable claim - that the
     * suggestions come from the index's own region facet - and the test never
     * checked it, so the label could have gone on describing a list that had
     * moved to anything at all.
     */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'pages', 'onboarding.js'), 'utf8'
    );
    // The claim's substance: sourced from the index facet, region specifically.
    expect(src).toMatch(/api\/jobs\/facets/);
    expect(src).toMatch(/data\.region/);
    expect(src).toMatch(/Regions where the jobs in our index are/);
  });
});
