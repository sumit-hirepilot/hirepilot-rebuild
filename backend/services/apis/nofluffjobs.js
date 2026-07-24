const axios = require('axios');

const BASE_URL = 'https://nofluffjobs.com/api/posting';

const fetchJobs = async () => {
  try {
    const response = await axios.get(BASE_URL, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const postings = response.data?.postings || [];

    // The API returns one entry per (job, province-it's-visible-in) pair for
    // jobs open to multiple regions, not one entry per job - the same
    // posting shows up under a dozen different province-suffixed URLs. Dedup
    // to a single canonical entry per (company, title, postedAt), preferring
    // the plain "Remote" URL variant when one exists.
    const byKey = new Map();
    for (const p of postings) {
      if (!p.id || !p.title || !p.name) continue;
      const key = `${p.name}|${p.title}|${p.posted}`;
      const existing = byKey.get(key);
      const places = p.location?.places || [];
      const isRemoteVariant = places.some((pl) => /remote/i.test(pl.city || ''));
      if (!existing || (isRemoteVariant && !existing.__isRemoteVariant)) {
        byKey.set(key, { ...p, __isRemoteVariant: isRemoteVariant });
      }
    }

    return Array.from(byKey.values()).map((p) => {
      const places = p.location?.places || [];
      const cityPlace = places.find((pl) => pl.city && !/remote/i.test(pl.city));
      const country = places.find((pl) => pl.country)?.country?.name || '';
      const isRemote = p.fullyRemote || p.__isRemoteVariant;
      const location = isRemote ? 'Remote' : (cityPlace?.city || country || 'Poland');

      const salaryFrom = p.salary?.from ? Math.round(p.salary.from) : null;
      const salaryTo = p.salary?.to ? Math.round(p.salary.to) : null;

      const description = [
        `${(p.category || '').replace(/-/g, ' ')} role, ${(p.seniority || []).join('/')} level.`,
        location ? `Location: ${location}.` : '',
        salaryFrom ? `Salary: ${salaryFrom}-${salaryTo || salaryFrom} ${p.salary?.currency || ''}/month.` : '',
      ].filter(Boolean).join(' ');

      return {
        external_id: `nfj-${p.id}`,
        id: `nfj-${p.id}`,
        title: p.title,
        company: p.name,
        url: `https://nofluffjobs.com/job/${p.url}`,
        job_url: `https://nofluffjobs.com/job/${p.url}`,
        description,
        location,
        country: country || 'Poland',
        salary_min: salaryFrom,
        salary_max: salaryTo,
        currency: p.salary?.currency || 'PLN',
        work_arrangement: isRemote ? 'remote' : 'on-site',
        job_type: 'full-time',
        posted_at: p.posted ? new Date(Number(p.posted)) : new Date(),
      };
    });
  } catch (err) {
    console.error('NoFluffJobs API error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
