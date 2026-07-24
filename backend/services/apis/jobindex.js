const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

const BASE_URL = 'https://www.jobindex.dk/jobsoegning.rss';

const parser = new XMLParser({ ignoreAttributes: true });

// This feed double-encodes: HTML tags are represented as numeric character
// references (e.g. "&#x3C;div&#x3E;") rather than literal "<div>", so
// entities must be decoded before tags can be stripped.
const decodeEntities = (text) =>
  (text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const stripHtml = (html) =>
  decodeEntities(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const idFromLink = (link) => crypto.createHash('md5').update(link).digest('hex').slice(0, 16);

// Jobindex titles follow the convention "{Job Title}, {Company Name}" - the
// company is reliably the segment after the last comma.
const splitTitleCompany = (raw) => {
  const idx = raw.lastIndexOf(',');
  if (idx === -1) return { title: raw, company: 'Company on Jobindex' };
  return { title: raw.slice(0, idx).trim(), company: raw.slice(idx + 1).trim() };
};

const fetchJobs = async () => {
  try {
    const response = await axios.get(BASE_URL, {
      timeout: 10000,
      headers: { Accept: 'application/rss+xml' },
    });

    const parsed = parser.parse(response.data);
    const items = parsed?.rss?.channel?.item;
    const list = Array.isArray(items) ? items : (items ? [items] : []);

    return list
      .filter((item) => item.link && item.title)
      .map((item) => {
        const { title, company } = splitTitleCompany(decodeEntities(String(item.title)));
        return {
          external_id: `jix-${idFromLink(item.link)}`,
          id: `jix-${idFromLink(item.link)}`,
          title,
          company,
          url: item.link,
          job_url: item.link,
          description: stripHtml(String(item.description || '')),
          location: 'Denmark',
          country: 'Denmark',
          work_arrangement: 'on-site',
          job_type: 'full-time',
          posted_at: item.pubDate ? new Date(item.pubDate) : new Date(),
        };
      });
  } catch (err) {
    console.error('Jobindex RSS error:', err.message);
    throw err;
  }
};

module.exports = { fetchJobs };
