import _ = require("lodash");
import rp = require('request-promise');
import { EventEmitter } from "events";
import { OCGame } from "./main";

const request_options = {
    headers: {
        'User-Agent': 'fantasy-critic-bot/' + process.env.HEROKU_RELEASE_VERSION
    },
    json: true,
    forever: true // use TCP & HTTP keepalive.
};

export class OCClient extends EventEmitter {
    private readonly BASE_URL = "https://api.opencritic.com/api";
    private readonly PATH_GET_GAME = '/game';

    async get(path: string, queryStringParams: object = undefined) {
        const getPromise = rp.get(_.defaults({
            url: this.BASE_URL + path,
            qs: queryStringParams,
            simple: false,
            resolveWithFullResponse: true,
        }, request_options));
        return getPromise.then(function (response) {
            if (response.statusCode == 200) {
                return response.body;
            }
            else {
                throw new Error(`For ${path}, ${queryStringParams}\nGot ${response.statusCode}: ` + response.body);
            }
        });
    }
    async getGame(openCriticID: number): Promise<OCGame> {
        return this.get(this.PATH_GET_GAME + "/" + String(openCriticID));
    }
}
