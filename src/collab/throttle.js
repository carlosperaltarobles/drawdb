export function throttle(fn, ms) {
  let lastTime = 0;
  let timer = null;
  let lastArgs = null;
  let lastThis = null;

  const invoke = () => {
    lastTime = Date.now();
    const args = lastArgs;
    const ctx = lastThis;
    lastArgs = null;
    lastThis = null;
    fn.apply(ctx, args);
  };

  function throttled(...args) {
    const now = Date.now();
    lastArgs = args;
    lastThis = this;

    const remaining = ms - (now - lastTime);
    if ((lastTime === 0 || remaining <= 0) && timer === null) {
      invoke();
      return;
    }

    if (timer === null) {
      timer = setTimeout(
        () => {
          timer = null;
          if (lastArgs !== null) {
            invoke();
          }
        },
        Math.max(0, remaining),
      );
    }
  }

  throttled.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
    lastThis = null;
  };

  return throttled;
}

export default throttle;
