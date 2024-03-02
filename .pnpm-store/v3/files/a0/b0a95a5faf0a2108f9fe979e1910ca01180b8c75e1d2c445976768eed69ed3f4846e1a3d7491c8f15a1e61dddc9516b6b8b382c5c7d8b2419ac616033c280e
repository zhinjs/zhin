"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineTripTrap = exports.Trapper = exports.Dispose = void 0;
var Dispose;
(function (Dispose) {
    function from(source, callback) {
        return new Proxy(callback, {
            get(target, p, receiver) {
                return Reflect.get(source, p, receiver);
            }
        });
    }
    Dispose.from = from;
})(Dispose = exports.Dispose || (exports.Dispose = {}));
class Trapper {
    constructor() {
        this.matchers = new Map();
    }
    getListeners(...args) {
        return [...this.matchers.keys()]
            .filter(matcherFn => matcherFn(...args))
            .map(matcherFn => this.matchers.get(matcherFn));
    }
    listeners(matcher) {
        if (!matcher)
            return [...this.matchers.values()];
        if (typeof matcher === 'function')
            return [this.matchers.get(matcher)].filter(Boolean);
        const result = [];
        this.matchers.forEach((listener, matcherFn) => {
            if (matcherFn(matcher)) {
                result.push(listener);
            }
        });
        return result;
    }
    trap(matcher, listener) {
        return this.addMatcher(matcher, listener);
    }
    addMatcher(matcher, listener) {
        if (typeof matcher !== "function")
            matcher = Trapper.createMatcherFn(matcher);
        this.matchers.set(matcher, listener);
        const dispose = (() => {
            this.matchers.delete(matcher);
        });
        return Dispose.from(this, dispose);
    }
    trapOnce(matcher, listener) {
        const dispose = this.trap(matcher, (...args) => {
            listener(...args);
            dispose();
        });
        return dispose;
    }
    offTrap(matcher, listener) {
        if (!matcher)
            this.matchers = new Map();
        const matcherFns = this.getMatchers(matcher);
        matcherFns.forEach(matcherFn => {
            if (!listener || listener === matcherFn) {
                if (!listener || listener === matcherFn) {
                    this.matchers.delete(matcherFn);
                }
            }
        });
    }
    async tripAsync(matcher, ...args) {
        for (const listener of this.getListeners(matcher, ...args)) {
            await listener.apply(this, args);
        }
    }
    trip(matcher, ...args) {
        for (const listener of this.getListeners(matcher, ...args)) {
            listener.apply(this, args);
        }
    }
    async bailSync(matcher, ...args) {
        for (const listener of this.getListeners(matcher, ...args)) {
            const result = await listener.apply(this, args);
            if (result)
                return result;
        }
    }
    bail(matcher, ...args) {
        for (const listener of this.getListeners(matcher, ...args)) {
            const result = listener.apply(this, args);
            if (result && !Trapper.isPromise(result))
                return result;
        }
    }
    getMatchers(matcher) {
        if (typeof matcher === 'function')
            return [matcher];
        return [...this.matchers.keys()].filter(matcherFn => matcherFn(matcher));
    }
}
exports.Trapper = Trapper;
function defineTripTrap() {
    const matchers = new Map();
    const getMatchers = (matcher) => {
        if (typeof matcher === 'function')
            return [matcher];
        return [...matchers.keys()].filter(matcherFn => matcherFn(matcher));
    };
    const getListeners = (...args) => {
        return [...matchers.keys()]
            .filter(matcherFn => matcherFn(...args))
            .map(matcherFn => matchers.get(matcherFn));
    };
    const trapper = {
        matchers,
        addMatcher(matcher, listener) {
            if (typeof matcher !== "function")
                matcher = Trapper.createMatcherFn(matcher);
            matchers.set(matcher, listener);
            return trapper;
        },
        trap(matcher, listener) {
            return trapper.addMatcher(matcher, listener);
        },
        trip(eventName, ...args) {
            for (const listener of getListeners(eventName, ...args)) {
                listener.apply(this, args);
            }
        },
        async tripAsync(eventName, ...args) {
            for (const listener of getListeners(eventName, ...args)) {
                await listener.apply(this, args);
            }
        },
        bail(eventName, ...args) {
            for (const listener of this.getListeners(...args)) {
                const result = listener.apply(this, args);
                if (result && !Trapper.isPromise(result))
                    return result;
            }
        },
        async bailAsync(eventName, ...args) {
            for (const listener of this.getListeners(...args)) {
                const result = await listener.apply(this, args);
                if (result)
                    return result;
            }
        },
        listeners(matcher) {
            return getMatchers(matcher).map(matcherFn => matchers.get(matcherFn));
        },
        delete(matcher, listener) {
            const matcherFns = getMatchers(matcher);
            matcherFns.forEach(matcherFn => {
                if (!listener || listener === matcherFn) {
                    matchers.delete(matcherFn);
                }
            });
            return trapper;
        },
        clean() {
            matchers.clear();
            return trapper;
        }
    };
    return trapper;
}
exports.defineTripTrap = defineTripTrap;
(function (Trapper) {
    function isPromise(object) {
        return typeof object === 'object' && typeof object['then'] === 'function' && typeof object['catch'] === 'function';
    }
    Trapper.isPromise = isPromise;
    function createMatcherFn(eventName) {
        return (...args) => {
            if (["string", 'symbol'].includes(typeof eventName))
                return args[0] === eventName;
            return eventName.test(args[0]);
        };
    }
    Trapper.createMatcherFn = createMatcherFn;
})(Trapper = exports.Trapper || (exports.Trapper = {}));
exports.default = Trapper;
