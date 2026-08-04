const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/*
 * A7.1 — identify the caller when they have a token, but never require one.
 *
 * /api/jobs was unauthenticated, so it could not personalise even in
 * principle: it ordered by posted_at because it had no idea who was asking.
 * /api/matches was authenticated and ordered by score. That single difference
 * is why "View all jobs" led from a scored, personalised list to a
 * chronological dump of everything indexed.
 *
 * A bad or expired token is treated as absent rather than rejected - browsing
 * jobs must never fail on auth, it just stops being personalised.
 */
const attachUserIfPresent = (req, _res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    } catch (err) {
      req.user = null;
    }
  }
  next();
};

module.exports = {
  verifyToken,
  attachUserIfPresent,
};
