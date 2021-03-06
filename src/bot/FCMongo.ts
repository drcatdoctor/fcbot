import * as Mongo from "mongodb";
import { WorkerSaveState } from "./GuildWorker";

// I don't like mongo, it seems to be written and maintained by idiots, but 
// I'm just using it as an extremely basic key->doc store so hopefully
// it can manage to do that without breaking somehow.
export class FCMongo {

    mongo: Mongo.MongoClient;
    connected: boolean = false;

    COLLECTION_NAME = "fcbotdev";

    constructor() {
        const mongo_uri = process.env.MONGO_URI;

        if (!mongo_uri) {
            console.log("No MONGO_URI set, no mongo for you");
        } else {
            this.mongo = new Mongo.MongoClient(mongo_uri, {
                useUnifiedTopology: true,
                loggerLevel: 'warn'
            });
            console.log("mongo connecting to", mongo_uri);
        }
    }

    private async collection() {
        // I would like to use this.mongo.isConnected, but the idiots at mongo hq 
        // made a client where this returns true even when you aren't connected.
        if (!this.connected) {
            await this.mongo.connect();
            this.connected = true;
        }

        return this.mongo.db().collection(this.COLLECTION_NAME);
    }

    async set(state: WorkerSaveState) {
        if (!this.mongo) return;
        const coll = await this.collection();

        return (await this.collection()).findOneAndReplace(
            { guildId: state.guildId },
            state,
            { upsert: true }
        );
    }

    async get(guildId: string): Promise<WorkerSaveState | undefined | null> {
        if (!this.mongo) return undefined;
        return (await this.collection()).findOne({guildId: guildId});
    }

}