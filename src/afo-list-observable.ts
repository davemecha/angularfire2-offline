import { FirebaseListFactoryOpts } from 'angularfire2/interfaces';
import * as utils from 'angularfire2/utils';
import { ReplaySubject } from 'rxjs';

import { unwrap } from './database';
import { OfflineWrite } from './offline-write';
import { LocalUpdateService } from './local-update-service';

export class AfoListObservable<T> extends ReplaySubject<T> {
  orderKey: string;
  path: string;
  que = [];
  query: AfoQuery = {};
  queryReady = {
    ready: false,
    promise: undefined
  };
  value: any[];
  constructor(
    private ref,
    private localUpdateService: LocalUpdateService,
    private options: FirebaseListFactoryOpts) {
    super(1);
    this.init();
  }
  emulate(method, value = null, key?) {
    const clonedValue = JSON.parse(JSON.stringify(value));
    if (this.value === undefined) {
      console.log('value was undefined');
      this.que.push({
        method: method,
        value: clonedValue,
        key: key
      });
      return;
    }
    this.processEmulation(method, clonedValue, key);
    this.updateSubscribers();
  }
  init() {
    this.path = this.ref.$ref.toString().substring(this.ref.$ref.database.ref().toString().length - 1);
    this.setupQuery();
    this.subscribe((newValue: any) => {
      this.value = newValue;
      if (this.que.length > 0) {
        this.que.forEach(queTask => {
          this.processEmulation(queTask.method, queTask.value, queTask.key);
        });
        this.que = [];
        this.updateSubscribers();
      }
    });
  }
  push(value: any) {
    let resolve;
    let promise = new Promise(r => resolve = r);
    const key = this.ref.$ref.push(value, () => {
      resolve();
    }).key;
    this.emulate('push', value, key);
    OfflineWrite(
      promise,
      'object',
      `${this.path}/${key}`,
      'set',
      [value],
      this.localUpdateService);
    return promise;
  }
  update(key: string, value: any): firebase.Promise<void> {
    this.emulate('update', value, key);
    const promise = this.ref.update(key, value);
    this.offlineWrite(promise, 'update', [key, value]);
    return promise;
  }
  remove(key?: string): firebase.Promise<void> {
    this.emulate('remove', null, key);
    const promise = this.ref.remove(key);
    this.offlineWrite(promise, 'remove', [key]);
    return promise;
  }
  private checkIfResolved(resolve) {
    const notFinished = Object.keys(this.options.query)
      .some(queryItem => !(queryItem in this.query));
    if (!this.queryReady.ready && !notFinished) {
      this.queryReady.ready = true;
      resolve();
    }
  }
  private emulateQuery() {
    if (this.options.query === undefined) { return; }
    this.queryReady.promise.then(() => {
      console.log('query is ready', this.value);
      // Using format similar to [angularfire2](https://goo.gl/0EPvHf)

      // Check orderBy
      if (this.query.orderByChild) {
        this.orderKey = this.query.orderByChild;
        this.orderByString(this.query.orderByChild);
      } else if (this.query.orderByKey) {
        this.orderKey = '$key';
        this.orderByString('$key');
      } else if (this.query.orderByPriority) {
        // TODO
      } else if (this.query.orderByValue) {
        this.orderKey = '$value';
        this.orderByString('$value');
      }

      // check equalTo
      if (utils.hasKey(this.query, 'equalTo')) {
        if (utils.hasKey(this.query.equalTo, 'value')) {
          // TODO
        } else {
          this.equalTo(this.query.equalTo);
        }

        if (utils.hasKey(this.query, 'startAt') || utils.hasKey(this.query, 'endAt')) {
          throw new Error('Query Error: Cannot use startAt or endAt with equalTo.');
        }

        // apply limitTos
        if (!utils.isNil(this.query.limitToFirst)) {
          this.limitToFirst(this.query.limitToFirst);
        }

        if (!utils.isNil(this.query.limitToLast)) {
          this.limitToLast(this.query.limitToLast);
        }

        return;
      }

      // check startAt
      if (utils.hasKey(this.query, 'startAt')) {
        if (utils.hasKey(this.query.startAt, 'value')) {
          // TODO
        } else {
          this.startAt(this.query.startAt);
        }
      }

      if (utils.hasKey(this.query, 'endAt')) {
        if (utils.hasKey(this.query.endAt, 'value')) {
          // TODO
        } else {
          this.endAt(this.query.endAt);
        }
      }

      if (!utils.isNil(this.query.limitToFirst) && this.query.limitToLast) {
        throw new Error('Query Error: Cannot use limitToFirst with limitToLast.');
      }

      // apply limitTos
      if (!utils.isNil(this.query.limitToFirst)) {
        this.limitToFirst(this.query.limitToFirst);
      }

      if (!utils.isNil(this.query.limitToLast)) {
        this.limitToLast(this.query.limitToLast);
      }
    });
  }
  private endAt(endValue) {
    let found = false;
    for (let i = this.value.length - 1; !found && i > -1; i--) {
      if (this.value[i] === endValue) {
        this.value.splice(0, i + 1);
        found = true;
      }
    }
  }
  private equalTo(value, key?) {
    this.value.forEach((item, index) => {
      if (item[this.orderKey] !== value) {
        this.value.splice(0, index);
      }
    });
  }
  private limitToFirst(limit: number) {
    if (limit < this.value.length) {
      this.value = this.value.slice(0, limit);
    }
  }
  private limitToLast(limit: number) {
    if (limit < this.value.length) {
      this.value = this.value.slice(-limit);
    }
  }
  private offlineWrite(promise: firebase.Promise<void>, type: string, args: any[]) {
    OfflineWrite(
      promise,
      'list',
      this.path,
      type,
      args,
      this.localUpdateService);
  }
  private orderByString(x) {
    if (this.value === undefined) { return; }
    this.value.sort((a, b) => {
      const itemA = a[x].toLowerCase();
      const itemB = b[x].toLowerCase();
      if (itemA < itemB) { return -1; }
      if (itemA > itemB) { return 1; }
      return 0;
    });
  }
  private processEmulation(method, value, key) {
    if (this.value === null) {
      this.value = [];
    }
    const newValue = unwrap(key, value, () => value !== null);
    if (method === 'push') {
      let found = false;
      this.value.forEach((item, index) => {
        if (item.$key === key) {
          this.value[index] = newValue;
          found = true;
        }
      });
      if (!found) {
        this.value.push(newValue);
      }
    } else if (method === 'update') {
      let found = false;
      this.value.forEach((item, index) => {
        if (item.$key === key) {
          found = true;
          this.value[index] = newValue;
        }
      });
      if (!found) {
        this.value.push(newValue);
      }
    } else { // `remove` is the only remaining option
      if (key === undefined) {
        this.value = [];
      } else {
        this.value.forEach((item, index) => {
          if (item.$key === key) {
            this.value.splice(index, 1);
          }
        });
      }
    }
  }
  private setupQuery() {
    if (this.options.query === undefined) { return; }
    this.queryReady.promise = new Promise(resolve => {
      Object.keys(this.options.query).forEach(queryKey => {
        const queryItem = this.options.query[queryKey];
        if (typeof queryItem === 'object' && 'subscribe' in queryItem) {
          this.options.query[queryKey].subscribe(value => {
            this.query[queryKey] = value;
            this.checkIfResolved(resolve);
          });
        } else {
          this.query[queryKey] = this.options.query[queryKey];
        }
      });
      this.checkIfResolved(resolve);
    });
  }
  private startAt(startValue: string | number | boolean) {
    this.value.some((item, index) => {
      if (item === this.options.query.startAt) {
        this.value = this.value.slice(-this.value.length + index);
        return true;
      }
    });
  }
  private updateSubscribers() {
    console.log('updating subscribers');
    this.emulateQuery();
    this.next(<any>this.value);
  }
}

export interface AfoQuery {
  [key: string]: any;
}

