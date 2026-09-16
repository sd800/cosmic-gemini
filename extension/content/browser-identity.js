// Shared mechanism only: authorized products supply complete policies and precedence.
// No observers, timers, network access, or self-starting policy decisions.
(() => {
  const KEY = Symbol.for('cosmic-gemini.browser-identity');
  if (globalThis[KEY]) return;
  const NativeDate = Date;
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  const nativeParse = Date.parse;
  const nativeOffset = Date.prototype.getTimezoneOffset;
  const systemTimeZone = new NativeDateTimeFormat().resolvedOptions().timeZone;
  const policies = new Map();
  let installed = null;
  let signature = '';

  class IdentityInstallation {
    constructor(policy) {
      this.policy = policy;
      this.live = true;
      this.identityRestorers = [];
      this.nativeDate = NativeDate;
      this.nativeDateTimeFormat = NativeDateTimeFormat;
      this.systemTimeZone = systemTimeZone;
      this.identityTimeZone = policy.timeZone || '';
      this.zonedPartsFormatter = null;
      this.zonedNameFormatter = null;
      if (policy.language || policy.globalPrivacyControl) this.installNavigatorIdentity();
      if (policy.locale || policy.timeZone) {
        this.installIntlConstructor('DateTimeFormat', args => this.dateTimeFormatArguments(args));
        for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
          this.installLocaleMethod(Date.prototype, name, 0, true);
        }
      }
      if (policy.locale) {
        for (const name of ['NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat',
          'DisplayNames', 'Segmenter', 'DurationFormat']) {
          this.installIntlConstructor(name, args => this.defaultLocaleArguments(args));
        }
        this.installLocaleMethod(Number.prototype, 'toLocaleString');
        if (typeof BigInt === 'function') this.installLocaleMethod(BigInt.prototype, 'toLocaleString');
        this.installLocaleMethod(Array.prototype, 'toLocaleString');
        this.installLocaleMethod(String.prototype, 'localeCompare', 1);
      }
      if (policy.timeZone) {
        this.installZonedDateReads();
        this.installZonedDateWrites();
        this.installZonedDateConstructor();
      }
    }
    dispose() {
      this.live = false;
      for (const restore of this.identityRestorers.reverse()) restore();
      this.identityRestorers = [];
    }
    descriptorMatches(current, installed) {
      return !!current && current.value === installed.value && current.get === installed.get
        && current.set === installed.set;
    }

    installIdentityProperty(owner, name, descriptor) {
      if (!owner) return false;
      const original = Object.getOwnPropertyDescriptor(owner, name);
      if (original && original.configurable === false) return false;
      try { Object.defineProperty(owner, name, descriptor); }
      catch { return false; }
      const installed = Object.getOwnPropertyDescriptor(owner, name);
      this.identityRestorers.push(() => {
        const current = Object.getOwnPropertyDescriptor(owner, name);
        if (!this.descriptorMatches(current, installed)) return;
        try {
          if (original) Object.defineProperty(owner, name, original);
          else delete owner[name];
        } catch {}
      });
      return true;
    }

    propertyOwner(value, name) {
      let owner = value;
      while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) owner = Object.getPrototypeOf(owner);
      return owner || Object.getPrototypeOf(value) || value;
    }

    installNavigatorIdentity() {
      const pageNavigator = globalThis.navigator;
      if (!pageNavigator) return;
      const values = [];
      if (this.policy.language) {
        const languages = Object.freeze([this.policy.language]);
        values.push(
          ['language', this.policy.language],
          ['languages', languages],
          ['userLanguage', this.policy.language],
          ['browserLanguage', this.policy.language],
          ['systemLanguage', this.policy.language]
        );
      }
      if (this.policy.globalPrivacyControl === true) values.push(['globalPrivacyControl', true]);
      for (const [name, value] of values) {
        const owner = this.propertyOwner(pageNavigator, name);
        const original = Object.getOwnPropertyDescriptor(owner, name);
        this.installIdentityProperty(owner, name, {
          configurable: true,
          enumerable: Object.getOwnPropertyDescriptor(owner, name)?.enumerable ?? true,
          get: () => this.live ? value : (original?.get ? Reflect.apply(original.get, pageNavigator, []) : original?.value)
        });
      }
    }

    defaultLocaleArguments(args, localeIndex = 0) {
      if (!this.live) return args;
      const normalized = [...args];
      while (normalized.length <= localeIndex) normalized.push(undefined);
      if ((normalized[localeIndex] === undefined || (Array.isArray(normalized[localeIndex]) && normalized[localeIndex].length === 0)) && this.policy.locale) normalized[localeIndex] = this.policy.locale;
      return normalized;
    }

    dateTimeFormatArguments(args) {
      const normalized = this.defaultLocaleArguments(args);
      if (!this.live || !this.identityTimeZone) return normalized;
      while (normalized.length < 2) normalized.push(undefined);
      if (normalized[1] === undefined) normalized[1] = { timeZone: this.identityTimeZone };
      else if (normalized[1] && typeof normalized[1] === 'object' && normalized[1].timeZone === undefined) {
        normalized[1] = Object.create(normalized[1], { timeZone: { value: this.identityTimeZone } });
      }
      return normalized;
    }

    installIntlConstructor(name, argumentTransform) {
      const intl = globalThis.Intl;
      const Original = intl?.[name];
      if (typeof Original !== 'function') return;
      let wrapped;
      wrapped = new Proxy(Original, {
        apply: (target, receiver, args) => Reflect.apply(target, receiver, argumentTransform(args)),
        construct: (target, args, newTarget) => Reflect.construct(
          target,
          argumentTransform(args),
          newTarget === wrapped ? target : newTarget
        )
      });
      const descriptor = Object.getOwnPropertyDescriptor(intl, name) || {
        configurable: true, enumerable: false, writable: true
      };
      if (this.installIdentityProperty(intl, name, { ...descriptor, value: wrapped })) {
        const constructorDescriptor = Object.getOwnPropertyDescriptor(Original.prototype, 'constructor');
        if (constructorDescriptor?.value === Original) {
          this.installIdentityProperty(Original.prototype, 'constructor', {
            ...constructorDescriptor,
            value: wrapped
          });
        }
      }
    }

    installLocaleMethod(owner, name, localeIndex = 0, applyTimeZone = false) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      const original = descriptor?.value;
      if (typeof original !== 'function') return;
      const runtime = this;
      const wrapped = function localeMethod(...args) {
        const normalized = runtime.defaultLocaleArguments(args, localeIndex);
        if (runtime.live && applyTimeZone && runtime.identityTimeZone) {
          const optionsIndex = localeIndex + 1;
          while (normalized.length <= optionsIndex) normalized.push(undefined);
          if (normalized[optionsIndex] === undefined) {
            normalized[optionsIndex] = { timeZone: runtime.identityTimeZone };
          } else if (normalized[optionsIndex] && typeof normalized[optionsIndex] === 'object'
            && normalized[optionsIndex].timeZone === undefined) {
            normalized[optionsIndex] = Object.create(normalized[optionsIndex], { timeZone: { value: runtime.identityTimeZone } });
          }
        }
        return Reflect.apply(original, this, normalized);
      };
      this.installIdentityProperty(owner, name, { ...descriptor, value: wrapped });
    }

    zonedParts(value) {
      const time = Date.prototype.getTime.call(value);
      if (!Number.isFinite(time)) return null;
      this.zonedPartsFormatter ||= new this.nativeDateTimeFormat('en-US', {
        timeZone: this.identityTimeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      });
      const parts = {};
      for (const part of this.zonedPartsFormatter.formatToParts(value)) {
        if (part.type !== 'literal') parts[part.type] = part.value;
      }
      return {
        year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second)
      };
    }

    zonedOffset(value, parts = this.zonedParts(value)) {
      if (!parts) return NaN;
      const time = Date.prototype.getTime.call(value);
      const wholeSecondTime = Math.floor(time / 1000) * 1000;
      const representedAsUtc = this.partsTimestamp(parts);
      return Math.round((wholeSecondTime - representedAsUtc) / 60_000);
    }

    zonedTimeZoneName(value) {
      this.zonedNameFormatter ||= new this.nativeDateTimeFormat('en-US', {
        timeZone: this.identityTimeZone, year: 'numeric', timeZoneName: 'long'
      });
      return this.zonedNameFormatter.formatToParts(value).find(part => part.type === 'timeZoneName')?.value || '';
    }

    installZonedDateReads() {
      if (this.identityTimeZone === this.systemTimeZone) return;
      const runtime = this;
      const datePrototype = Date.prototype;
      const numericReads = {
        getFullYear: parts => parts.year,
        getYear: parts => parts.year - 1900,
        getMonth: parts => parts.month - 1,
        getDate: parts => parts.day,
        getDay: parts => new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay(),
        getHours: parts => parts.hour,
        getMinutes: parts => parts.minute,
        getSeconds: parts => parts.second
      };
      for (const [name, read] of Object.entries(numericReads)) {
        const descriptor = Object.getOwnPropertyDescriptor(datePrototype, name);
        const original = descriptor?.value;
        if (typeof original !== 'function') continue;
        this.installIdentityProperty(datePrototype, name, {
          ...descriptor,
          value: function zonedDateRead() {
            if (!runtime.live) return Reflect.apply(original, this, []);
            Date.prototype.getTime.call(this);
            const parts = runtime.zonedParts(this);
            return parts ? read(parts) : NaN;
          }
        });
      }
      const offsetDescriptor = Object.getOwnPropertyDescriptor(datePrototype, 'getTimezoneOffset');
      this.installIdentityProperty(datePrototype, 'getTimezoneOffset', {
        ...offsetDescriptor,
        value: function getTimezoneOffset() { return runtime.live ? runtime.zonedOffset(this) : Reflect.apply(offsetDescriptor.value, this, []); }
      });
      const pad = value => String(Math.abs(value)).padStart(2, '0');
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const strings = {
        toDateString(parts) {
          const weekday = weekdays[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
          return `${weekday} ${months[parts.month - 1]} ${pad(parts.day)} ${parts.year}`;
        },
        toTimeString(parts, value) {
          const offset = runtime.zonedOffset(value, parts);
          const sign = offset <= 0 ? '+' : '-';
          const absolute = Math.abs(offset);
          const zoneName = runtime.zonedTimeZoneName(value);
          return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} GMT${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}${zoneName ? ` (${zoneName})` : ''}`;
        }
      };
      for (const name of ['toDateString', 'toTimeString', 'toString']) {
        const descriptor = Object.getOwnPropertyDescriptor(datePrototype, name);
        const original = descriptor?.value;
        if (typeof original !== 'function') continue;
        this.installIdentityProperty(datePrototype, name, {
          ...descriptor,
          value: function zonedDateString() {
            if (!runtime.live) return Reflect.apply(original, this, []);
            Date.prototype.getTime.call(this);
            const parts = runtime.zonedParts(this);
            if (!parts) return 'Invalid Date';
            const date = strings.toDateString(parts, this);
            if (name === 'toDateString') return date;
            const time = strings.toTimeString(parts, this);
            return name === 'toTimeString' ? time : `${date} ${time}`;
          }
        });
      }
    }

    partsTimestamp(parts, milliseconds = 0) {
      const date = new this.nativeDate(0);
      date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
      date.setUTCHours(parts.hour, parts.minute, parts.second, milliseconds);
      return date.getTime();
    }

    localToInstant(localTime) {
      if (!Number.isFinite(localTime)) return NaN;
      const offsets = new Set([-36, 0, 36].map(hours => this.zonedOffset(new this.nativeDate(localTime + hours * 3_600_000))));
      const choices = [...offsets].map(offset => {
        const time = localTime + offset * 60_000;
        const represented = time - this.zonedOffset(new this.nativeDate(time)) * 60_000;
        return { time, difference: represented - localTime };
      });
      const exact = choices.filter(choice => choice.difference === 0);
      if (exact.length) return Math.min(...exact.map(choice => choice.time));
      // Native Date's compatible DST disambiguation: earlier overlap; advance gaps.
      const forward = choices.filter(choice => choice.difference > 0).sort((a, b) => a.difference - b.difference);
      return (forward[0] || choices[0]).time;
    }

    installZonedDateWrites() {
      if (this.identityTimeZone === this.systemTimeZone) return;
      const runtime = this;
      const prototype = this.nativeDate.prototype;
      const setTime = prototype.setTime;
      for (const [name, utcName] of Object.entries({
        setFullYear: 'setUTCFullYear', setYear: 'setUTCFullYear', setMonth: 'setUTCMonth',
        setDate: 'setUTCDate', setHours: 'setUTCHours', setMinutes: 'setUTCMinutes',
        setSeconds: 'setUTCSeconds', setMilliseconds: 'setUTCMilliseconds'
      })) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        const original = descriptor.value;
        const utcSetter = prototype[utcName];
        this.installIdentityProperty(prototype, name, { ...descriptor, value: function (...args) {
          if (!runtime.live) return Reflect.apply(original, this, args);
          const time = prototype.getTime.call(this);
          let parts = runtime.zonedParts(this);
          if (!parts && ['setFullYear', 'setYear'].includes(name)) parts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
          const local = new runtime.nativeDate(parts ? runtime.partsTimestamp(parts, Number.isFinite(time) ? this.getUTCMilliseconds() : 0) : NaN);
          if (name === 'setYear') {
            const year = Number(args[0]);
            args = [year >= 0 && year <= 99 ? Math.trunc(year) + 1900 : year];
          }
          Reflect.apply(utcSetter, local, args);
          return Reflect.apply(setTime, this, [runtime.localToInstant(local.getTime())]);
        } });
      }
    }

    localStringTime(value) {
      // ISO date-only strings remain UTC; date-times without an offset are local.
      const match = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
      if (!match) return null;
      const utc = nativeParse(value + 'Z');
      return this.localToInstant(utc);
    }

    installZonedDateConstructor() {
      if (this.identityTimeZone === this.systemTimeZone || typeof this.nativeDate !== 'function') return;
      const runtime = this;
      const Original = this.nativeDate;
      let wrapped;
      wrapped = new Proxy(Original, {
        apply() { return new Original().toString(); },
        construct(target, args, newTarget) {
          let normalized = args;
          if (runtime.live && args.length >= 2) {
            const values = [
              Number(args[0]), Number(args[1]),
              args.length > 2 ? Number(args[2]) : 1,
              args.length > 3 ? Number(args[3]) : 0,
              args.length > 4 ? Number(args[4]) : 0,
              args.length > 5 ? Number(args[5]) : 0,
              args.length > 6 ? Number(args[6]) : 0
            ];
            const representedAsUtc = Original.UTC(...values);
            const instant = runtime.localToInstant(representedAsUtc);
            normalized = [instant];
          } else if (runtime.live && args.length === 1 && typeof args[0] === 'string') {
            const localTime = runtime.localStringTime(args[0]);
            if (localTime !== null) normalized = [localTime];
          }
          return Reflect.construct(target, normalized, newTarget === wrapped ? target : newTarget);
        }
      });
      const parseDescriptor = Object.getOwnPropertyDescriptor(Original, 'parse');
      this.installIdentityProperty(Original, 'parse', { ...parseDescriptor, value(value) {
        const text = String(value);
        const localTime = runtime.live ? runtime.localStringTime(text) : null;
        return localTime === null ? Reflect.apply(parseDescriptor.value, Original, [text]) : localTime;
      } });
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Date') || {
        configurable: true, enumerable: false, writable: true
      };
      if (this.installIdentityProperty(globalThis, 'Date', { ...descriptor, value: wrapped })) {
        const constructorDescriptor = Object.getOwnPropertyDescriptor(Original.prototype, 'constructor');
        if (constructorDescriptor?.value === Original) {
          this.installIdentityProperty(Original.prototype, 'constructor', {
            ...constructorDescriptor,
            value: wrapped
          });
        }
      }
    }

  }
  function reconcile() {
    const ordered = [...policies.values()].sort((a, b) => b.priority - a.priority);
    const highest = ordered[0];
    const next = highest ? {
      ...highest.policy,
      globalPrivacyControl: ordered.some(item => item.policy.globalPrivacyControl === true)
    } : null;
    const nextSignature = JSON.stringify(next);
    if (signature === nextSignature) return;
    installed?.dispose();
    installed = null;
    signature = nextSignature;
    if (next) installed = new IdentityInstallation(next);
  }
  Object.defineProperty(globalThis, KEY, { configurable: true, value: Object.freeze({
    systemTimeZone,
    systemOffset: () => Reflect.apply(nativeOffset, new NativeDate(), []),
    set(owner, policy, priority) { policies.set(owner, { policy: { ...policy }, priority }); reconcile(); },
    remove(owner) { policies.delete(owner); reconcile(); }
  }) });
})();
