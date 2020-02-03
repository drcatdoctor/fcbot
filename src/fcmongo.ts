import * as Mongo from "mongodb";

export class FCMongo {

    mongo: Mongo.MongoClient;
    connected: boolean = false;

    COLLECTION_NAME = "fcbot";

    constructor() {
        if (!process.env.MONGODB_URI) {
            console.log("No MONGODB_URI set, no mongo for you");
        } else {
            this.mongo = new Mongo.MongoClient(process.env.MONGODB_URI);
        }
    }

    private async collection() {
        if (!this.connected) {
            await this.mongo.connect();
            this.connected = true;
        }

        return this.mongo.db().collection(this.COLLECTION_NAME);
    }

    async set(document: any) {
        if (!this.mongo) return;
        return (await this.collection()).insertOne(document);
    }

    async get(docMatch: any) {
        if (!this.mongo) return undefined;
        return (await this.collection()).findOne(docMatch);
    }

}