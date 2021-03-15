import { decorate } from 'core-decorators';

import maxConcurrency from '..';

describe('maxConcurrency', () => {
  [1, 5, 15].forEach((max) => {
    it(`should limit concurrency for functions to ${max}`, async function testLimit() {
      let n = 0;
      // const max = 15;

      const check = () => {
        if (n > max) {
          throw new Error(`${n} > ${max}`);
        }
      };

      const testFunc = maxConcurrency(max)(async function testMax() {
        n++;
        check();
        return new Promise<void>((resolve) => {
          check();
          setTimeout(() => {
            check();
            n--;
            resolve();
          }, 10);
        });
      });

      const promises: Array<Promise<any>> = [];
      for (let i = 0; i < 100; i++) {
        promises.push(testFunc());
      }
      await Promise.all(promises);
    });
  });

  it(`should pass parameters to wrapped functions`, async function testPassParams() {
    const max = 15;

    const testFunc = maxConcurrency(max)(
      async (v: number): Promise<number> => 2 * v
    );

    const promises: Array<Promise<any>> = [];
    for (let i = 0; i < 100; i++) {
      const expected = 2 * i;
      promises.push(testFunc(i).then((res) => expect(res).toBe(expected)));
    }
    await Promise.all(promises);
  });

  xit(`should time out if functions do not return`, async function testTimeout() {
    let started = 0;
    const testFunc = maxConcurrency({ max: 1, timeout: 100 })(
      () =>
        new Promise((resolve) => {
          started++;
          setTimeout(resolve, 2000);
        })
    );

    let done = 0;
    // eslint-disable-next-line promise/catch-or-return
    testFunc().then(() => done++);
    // eslint-disable-next-line promise/catch-or-return
    testFunc().then(() => done++);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(started).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(started).toBe(2);
    expect(done).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(done).toBe(2);
  });

  // @TODO: Implement (fix!)
  xit('should limit concurrency for static class methods', async function testStatic() {
    let n = 0;
    const max = 15;

    const check = () => {
      if (n > max) {
        throw new Error(`${n} > ${max}`);
      }
    };

    class B {
      @decorate(maxConcurrency, max)
      public static async testFunc() {
        n++;
        check();
        return new Promise<void>((resolve) => {
          check();
          setTimeout(() => {
            check();
            n--;
            resolve();
          }, 10);
        });
      }
    }
    const bs: B[] = [new B(), new B(), new B(), new B()];

    const promises: Array<Promise<any>> = [];
    for (let i = 0; i < 100 / bs.length; i++) {
      for (let j = 0, len = bs.length; j < len; j++) {
        promises.push(B.testFunc());
      }
    }
    await Promise.all(promises);
  });
});
