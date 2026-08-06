/*
 * The process ends itself when it stops serving, and says why before it goes.
 *
 * Two outages, both recovered by a human redeploy. The second time
 * /api/health returned 200 while /api/jobs returned 502, then everything went
 * 502 and stayed there - and it recurred later on code that did NOT contain
 * the change I had blamed for it, so the cause is still unknown.
 *
 * There is a Docker HEALTHCHECK and it has never helped: Railway does not act
 * on Docker health status, so a wedged container sits marked unhealthy until
 * someone notices. What the platform reacts to is a process that EXITS.
 *
 * These drive both failure shapes the outages actually took - a probe that
 * HANGS and a probe that THROWS - because a watchdog that only handles the
 * throwing case would have slept through the outage that happened.
 */

const { installCrashLogging, startWatchdog } = require('../services/watchdog');

const flush = () => new Promise((r) => setImmediate(r));

describe('a probe that hangs is a failure, not a wait', () => {
  it('exits after the configured number of consecutive failures', async () => {
    const exits = [];
    // Never resolves - the outage shape where the process is up and stuck.
    const wedged = () => new Promise(() => {});
    const { tick } = startWatchdog(wedged, {
      timeoutMs: 5, failuresBeforeExit: 3, intervalMs: 1e9, exit: (c) => exits.push(c),
    });

    await tick();
    await tick();
    expect(exits).toEqual([]);   // not yet - two failures is not three

    await tick();
    expect(exits).toEqual([1]);  // and now it goes, non-zero
  });

  it('exits on a probe that throws, not only on one that hangs', async () => {
    const exits = [];
    const { tick } = startWatchdog(() => Promise.reject(new Error('db down')), {
      timeoutMs: 50, failuresBeforeExit: 2, intervalMs: 1e9, exit: (c) => exits.push(c),
    });

    await tick();
    await tick();
    expect(exits).toEqual([1]);
  });

  it('forgets failures once it recovers, so a blip cannot accumulate into an exit', async () => {
    /*
     * Without this a healthy service that failed twice yesterday exits on its
     * next single failure - a restart loop built out of unrelated blips.
     */
    const exits = [];
    let healthy = false;
    const probe = () => (healthy ? Promise.resolve() : Promise.reject(new Error('nope')));
    const { tick } = startWatchdog(probe, {
      timeoutMs: 50, failuresBeforeExit: 3, intervalMs: 1e9, exit: (c) => exits.push(c),
    });

    await tick();
    await tick();
    healthy = true;
    await tick();          // recovered - counter resets
    healthy = false;
    await tick();
    await tick();
    expect(exits).toEqual([]);   // two fresh failures, still under the bar
  });

  it('never exits while the probe keeps answering', async () => {
    const exits = [];
    const { tick } = startWatchdog(() => Promise.resolve(), {
      timeoutMs: 50, failuresBeforeExit: 2, intervalMs: 1e9, exit: (c) => exits.push(c),
    });

    for (let i = 0; i < 10; i += 1) await tick();
    expect(exits).toEqual([]);
  });
});

describe('the process names its own death', () => {
  const captured = [];
  let handlers;
  let write;

  beforeEach(() => {
    captured.length = 0;
    handlers = {};
    // Both streams: crashes go to stderr, a signal is a warning on stdout, and
    // a spy on one of them silently misses the other.
    const grab = (line) => { captured.push(String(line)); return true; };
    write = jest.spyOn(process.stderr, 'write').mockImplementation(grab);
    jest.spyOn(process.stdout, 'write').mockImplementation(grab);
    jest.spyOn(process, 'on').mockImplementation((event, fn) => { handlers[event] = fn; return process; });
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs a stack for an uncaught exception before exiting non-zero', () => {
    const exits = [];
    installCrashLogging({ exit: (c) => exits.push(c) });

    handlers.uncaughtException(new Error('boom'));

    const line = JSON.parse(captured.find((l) => l.includes('uncaughtException')));
    expect(line.event).toBe('uncaughtException');
    expect(line.message).toBe('boom');
    expect(line.stack).toMatch(/Error: boom/);
    expect(exits).toEqual([1]);
  });

  it('logs an unhandled rejection, which kills Node just as silently', () => {
    const exits = [];
    installCrashLogging({ exit: (c) => exits.push(c) });

    handlers.unhandledRejection('plain string reason');

    const line = JSON.parse(captured.find((l) => l.includes('unhandledRejection')));
    expect(line.message).toBe('plain string reason');
    expect(line.stack).toBeTruthy();
    expect(exits).toEqual([1]);
  });

  it('records a SIGTERM with memory, because an OOM kill arrives as one', () => {
    const exits = [];
    installCrashLogging({ exit: (c) => exits.push(c) });

    handlers.SIGTERM();

    const line = JSON.parse(captured.find((l) => l.includes('"signal"')));
    expect(line.signal).toBe('SIGTERM');
    expect(typeof line.rssMb).toBe('number');
    expect(exits).toEqual([0]);
  });
});
