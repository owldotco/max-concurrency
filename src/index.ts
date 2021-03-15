import { decorate } from 'core-decorators';
import mkDebug = require('debug');

type AsyncFunction<R, A extends any[]> = (...args: A) => Promise<R>;
interface MaxConcurrencyLimiter extends ThrottleFunctionOrDecorator {
  run<T>(task: () => Promise<T>): Promise<T>;
}

const debug = mkDebug('@owldotco/max-concurrency');

function makeLimiter(max: number): MaxConcurrencyLimiter['run'] {
  const running: Promise<any>[] = [];
  return async <T>(task: () => Promise<T>) => {
    while (running.length >= max) {
      await Promise.race(running).catch(() => null);
    }
    const p = task();
    running.push(p);
    try {
      return await p;
    } finally {
      running.splice(running.indexOf(p), 1);
    }
  };
}

function makeLimiterWithTimeout(
  max: number,
  timeout: number
): MaxConcurrencyLimiter['run'] {
  type PromiseWithTimeoutError<T> = Promise<T> & { timeoutError?: Error };
  const running: PromiseWithTimeoutError<any>[] = [];
  let timeoutStart = 0;
  let timeoutCount = 0;
  let timeoutPromise: Promise<boolean> | undefined;
  let timeoutClear: (() => void) | undefined;
  const refreshTimeout = () => {
    const now = Date.now();
    if (now - timeoutStart < 10) {
      return;
    }
    timeoutClear?.();
    if (running.length === 0) {
      return;
    }
    timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutStart = now;
      const timeoutHandle = setTimeout(() => {
        timeoutClear = undefined;
        const timedOutPromise = running.find((p) => p.timeoutError);
        if (timedOutPromise) {
          timeoutCount++;
          debug(timedOutPromise.timeoutError);
          if (timeoutCount > 1) {
            debug(`${timeoutCount} timed out still running`);
          }
          timedOutPromise.timeoutError = undefined;
        }
        resolve(true);
      }, timeout);
      timeoutClear = () => {
        // TODO: why arent tests hitting these lines?
        timeoutClear = undefined;
        clearTimeout(timeoutHandle);
        resolve(false);
      };
    });
  };

  return async <T>(
    task: () => Promise<T>,
    name = task.name || 'anonymous function'
  ) => {
    refreshTimeout();
    // let timedOut = false;
    while (running.length >= max + timeoutCount) {
      const runningPromise = Promise.race(running).catch(() => null);
      await (timeoutPromise
        ? Promise.race([timeoutPromise, runningPromise])
        : runningPromise);
    }

    // run task

    const p: PromiseWithTimeoutError<T> = task();
    p.timeoutError = new Error(`${name} timed out; override concurrency limit`);
    running.push(p);
    try {
      return await p;
    } finally {
      running.splice(running.indexOf(p), 1);
      if (!p.timeoutError) {
        // this task was marked as timed out
        timeoutCount--;
      }
    }
  };
}

function maxConcurrencyImpl(opts: { max: number; timeout?: number }) {
  const { max, timeout } = opts;
  if (process.env.NODE_ENV !== 'production') {
    if (typeof max !== 'number') {
      debug('maxConcurrency limit is not a number: %o', max);
      throw new Error('Invalid limit in maxConcurrency()');
    }
  }

  return timeout ? makeLimiterWithTimeout(max, timeout) : makeLimiter(max);
}
function maxConcurrencyWrapper(limiter: MaxConcurrencyLimiter['run']) {
  return function boundMaxConcurrency<R, A extends any[]>(
    fn: AsyncFunction<R, A>
  ): AsyncFunction<R, A> {
    if (process.env.NODE_ENV !== 'production') {
      if (typeof fn !== 'function') {
        debug('maxConcurrency parameter is not a function: %o', fn);
        throw new Error('Invalid function parameter in maxConcurrency()');
      }
    }

    return async function wrapper(this: any, ...args) {
      return limiter(() => fn.apply(this, args));
    };
  };
}

type ThrottleFunctionOrDecorator = {
  <R, A extends any[]>(fn: AsyncFunction<R, A>): AsyncFunction<R, A>;
  // from core MethodDecorator type
  <T>(
    // eslint-disable-next-line @typescript-eslint/ban-types
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> | void;
};

interface MaxConcurrencyOpts {
  max: number;
  timeout?: number;
}

export default function maxConcurrency(max: number): MaxConcurrencyLimiter;

export default function maxConcurrency(
  opts: MaxConcurrencyOpts
): MaxConcurrencyLimiter;

export default function maxConcurrency(
  arg: number | MaxConcurrencyOpts
): MaxConcurrencyLimiter {
  const opts = typeof arg === 'number' ? { max: arg } : arg;
  const run = maxConcurrencyImpl(opts);
  const wrapper = maxConcurrencyWrapper(run);
  const decorator = decorate(wrapper);

  function boundDecorator(...wrapArgs: any[]) {
    if (wrapArgs.length === 1) {
      return wrapper(wrapArgs[0]);
    } else {
      return decorator(wrapArgs[0], wrapArgs[1], wrapArgs[2]);
    }
  }
  return Object.assign(boundDecorator as ThrottleFunctionOrDecorator, { run });
}
