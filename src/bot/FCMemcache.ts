import * as memjs from "memjs";
import * as FC from "../fc/main";

export class FCMemcache {

    memClient: memjs.Client;

    constructor() {
        var memjsClient = memjs.Client.create(process.env.MEMCACHEDCLOUD_SERVERS, <unknown>{
            username: process.env.MEMCACHEDCLOUD_USERNAME,
            password: process.env.MEMCACHEDCLOUD_PASSWORD
          });
        console.log("Memcache using servers:", memjsClient.servers.map((s: any) => `${s.host}:${s.port}`).join(", "));
        this.memClient = memjsClient;
    }

    static leagueYearKey(league: FC.League): string {
        return ["LeagueYear", league.id, String(league.year)].join('/');
    }
    static leagueActionsKey(league: FC.League): string {
        return ["LeagueActions", league.id, String(league.year)].join('/');
    }
    static masterGameYearKey(year:number): string {
        return "MasterGameYear/" + String(year);
    }

    async setLive(key: string, value: any) {
        this.memClient.set("live/" + key, JSON.stringify(value), { expires: 30 });
    }
    async setLongLived(key: string, value: any) {
        this.memClient.set(key, JSON.stringify(value), { expires: 86400 });
    }
    
    async getLive(key: string): Promise<any | null> {
        return this.getLongLived("live/" + key);
    }
    async getLongLived(key: string): Promise<any | null> {
        var something = await this.memClient.get(key);
        if (something.value != null && something.value.toString() != null && something.value.toString() != "") {
            console.log("Retrieved from memcache", key);
            return JSON.parse(something.value.toString());
        } else {
            return null;
        }
    }
}
