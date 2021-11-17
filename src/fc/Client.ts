import _ = require("lodash");
import rp = require('request-promise');
import { EventEmitter } from "events";
import { League, LeagueYear, LeagueAction, MasterGameYear, LeagueUpcomingGame } from "./main";

const request_options = {
    headers: {
        'User-Agent': 'fantasy-critic-bot/' + process.env.HEROKU_RELEASE_VERSION
    },
    json: true,
    forever: true // use TCP & HTTP keepalive.
};

export class Client extends EventEmitter {
    private static readonly PRODUCTION_SITE_URL = "https://www.fantasycritic.games";
    readonly SITE_URL: string;
    private readonly BASE_API_URL: string;     // SITE_URL + "/api";

    private static readonly PATH_GET_LEAGUE_YEAR = '/League/GetLeagueYear';
    private static readonly PATH_GET_LEAGUE_UPCOMING = '/League/LeagueUpcomingGames';
    private static readonly PATH_GET_LEAGUE_ACTIONS = '/League/GetLeagueActions';
    private static readonly PATH_GET_MASTER_GAME_YEAR = '/game/MasterGameYear';
    private static readonly PATH_POST_LOGIN = '/account/login';
    private static readonly PATH_POST_REFRESH = '/token/refresh';

    auth: {
        token: string;
        refreshToken: string;
    };

    constructor() {
        super();

        if (process.env.OVERRIDE_FC_SITE_URL) {
            this.SITE_URL = process.env.OVERRIDE_FC_SITE_URL;
        }
        else {
            this.SITE_URL = Client.PRODUCTION_SITE_URL;
        }
        this.BASE_API_URL = this.SITE_URL + "/api";
    }

    leagueUrl(leagueID: string, year: number) {
        return this.SITE_URL + "/league/" + leagueID + "/" + year.toString();
    }

    async login(emailAddress: string, password: string) {
        const params = {
            emailAddress: emailAddress,
            password: password
        };
        console.log("Logging in to FC");
        const jsonbody = await rp.post(_.defaults({
            url: this.BASE_API_URL + Client.PATH_POST_LOGIN,
            body: params,
            simple: true
        }, request_options));
        this.auth = jsonbody;
        this.emit('authRefresh', jsonbody);
    }
    async refresh() {
        if (!this.auth) {
            throw new Error("Can't refresh without initial login");
        }
        console.log("Refreshing FC token");
        const params = {
            token: this.auth.token,
            refreshToken: this.auth.refreshToken
        };
        const jsonbody = await rp.post(_.defaults({
            url: this.BASE_API_URL + Client.PATH_POST_REFRESH,
            body: params,
            simple: true
        }, request_options)).catch(function (err) {
            console.log(err);
            console.log(err.response);
            console.log(err.response.body);
            throw err;
        });
        this.auth = jsonbody;
        this.emit('authRefresh', jsonbody);
    }
    async get(path: string, queryStringParams: object = undefined) {
        var self = this; // needed for functions because typescript is insane
        if (this.auth) {
            const getPromise = rp.get(_.defaults({
                url: this.BASE_API_URL + path,
                qs: queryStringParams,
                simple: false,
                resolveWithFullResponse: true,
                auth: {
                    bearer: this.auth.token
                }
            }, request_options));
            return getPromise.then(function (response) {
                if (response.statusCode == 403) {
                    console.log("get was 403");
                    return self.refresh().then(x => self.get(path, queryStringParams));
                }
                else if (response.statusCode == 200) {
                    return response.body;
                }
                else {
                    throw new Error(`For ${path}, ${queryStringParams}\nGot ${response.statusCode}: ` + response.body);
                }
            });
        }
        else {
            // try it?
            const getPromise = rp.get(_.defaults({
                url: this.BASE_API_URL + path,
                qs: queryStringParams,
                simple: false,
                resolveWithFullResponse: true,
            }, request_options));
            return getPromise.then(function (response) {
                if (response.statusCode == 403) {
                    throw new Error(`Unauthorized -- you probably need to do !fclogin first.`);
                }
                else if (response.statusCode == 200) {
                    return response.body;
                }
                else {
                    throw new Error(`For ${path}, ${queryStringParams}\nGot ${response.statusCode}: ` + response.body);
                }
            });            
        }
    }
    async getLeagueYear(league: League): Promise<LeagueYear> {
        return this.get(Client.PATH_GET_LEAGUE_YEAR, {
            leagueID: league.id,
            year: league.year
        });
    }
    async getLeagueUpcoming(league: League): Promise<LeagueUpcomingGame[]> {
        return this.get(Client.PATH_GET_LEAGUE_UPCOMING, {
            leagueID: league.id,
            year: league.year
        });
    }
    async getLeagueActions(league: League): Promise<LeagueAction[]> {
        return this.get(Client.PATH_GET_LEAGUE_ACTIONS, {
            leagueID: league.id,
            year: league.year
        });
    }
    async getMasterGameYear(year: number): Promise<MasterGameYear[]> {
        return this.get(Client.PATH_GET_MASTER_GAME_YEAR + "/" + String(year));
    }
}
