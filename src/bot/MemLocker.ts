import * as _ from "lodash";
import { Mutex, MutexInterface } from 'async-mutex';

export class MemLocker {
    big_mutex: Mutex;
    dict: _.Dictionary<Mutex> = {};

    constructor() {
        this.big_mutex = new Mutex();
    }

    async acquire(url: string): Promise<MutexInterface.Releaser> {
        const big_release = await this.big_mutex.acquire();
        if (!this.dict[url]) {
            this.dict[url] = new Mutex();
        }
        big_release();
        return this.dict[url].acquire();
    }
}
