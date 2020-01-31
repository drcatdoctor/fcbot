const rp = require('request-promise');

export interface EligibilityLevel {
    name: string
    // etc
}

export interface EligibilitySettings {
    eligibilityLevel: EligibilityLevel
}

export interface Game {
    gameName: string,
    criticScore: number | null,
    willRelease: boolean,
    estimatedReleaseDate: string,
    releaseDate: string | null
}

export interface MasterGameYear extends Game {
    masterGameID: string,
    sortableEstimatedReleaseDate: string,
    isReleased: boolean,
    openCriticID: number,
    averagedScore: boolean,
    eligibilitySettings: EligibilitySettings,
    subGames: MasterGameYear[],
    boxartFileName: string,
    addedTimestamp: string,
    error: boolean
    // missing some
}

export interface PublisherGame extends Game {
    publisherGameID: string,
    timestamp: string,
    counterPick: boolean,
    released: boolean,
    fantasyPoints: number | null,
    simpleProjectedFantasyPoints: number,
    advancedProjectedFantasyPoints: number,
    linked: boolean,
    manualCriticScore: boolean
    // missing some
}

export interface Publisher {
    publisherName: string,
    playerName: string,
    games: PublisherGame[],
    totalFantasyPoints: number
    // missing some
}

export interface LeagueYear {
    publishers: Publisher[]
    // missing some
}

export interface LeagueAction {
    publisherName: string,
    timestamp: string,
    actionType: string,
    description: string,
    managerAction: boolean
}

export class Client {
    private readonly BASE_URL = "https://www.fantasycritic.games/api";

    private readonly PATH_GET_LEAGUE_YEAR = '/League/GetLeagueYear';
    private readonly PATH_GET_LEAGUE_ACTIONS = '/League/GetLeagueActions';
    private readonly PATH_GET_MASTER_GAME_YEAR = '/game/MasterGameYear';
    private readonly PATH_POST_LOGIN = '/account/login';
    private readonly PATH_POST_REFRESH = '/token/refresh';
    
    private emailAddress: string;
    private password: string;
    private auth: {
        token: string,
        refreshToken: string
        // plus some other stuff
    };
    
    constructor(emailAddress: string, password: string) {
        this.emailAddress = emailAddress;
        this.password = password;
        this.auth = undefined;
    }

    async login() {
        const params = {
            emailAddress: this.emailAddress,
            password: this.password
        }
        const jsonbody = await rp.post({
            url: this.BASE_URL + this.PATH_POST_LOGIN,
            json: true,
            body: params,
            simple: true
        });
        this.auth = jsonbody;
    }

    
    async refresh() {
        if (!this.auth) {
            throw new Error("Can't refresh without initial login");
        }
        const params = {
            token: this.auth.token,
            refreshToken: this.auth.refreshToken
        }
        const jsonbody = await rp.post({
            url: this.BASE_URL + this.PATH_POST_REFRESH,
            json: true,
            body: params,
            simple: true
        });
        this.auth = jsonbody;
    }

    async get(path: string, queryStringParams: object = undefined) {
        if (this.auth) {
            const getPromise = rp.get({
                url: this.BASE_URL + path,
                qs: queryStringParams,
                json: true,
                simple: false,
                resolveWithFullResponse: true,
                auth: {
                    bearer: this.auth.token
                }
            });
    
            return getPromise.then(function (response) {
                if (response.statusCode == 403) {
                    console.log("get was 403");
                    return this.refresh().then(x => this.get(path, queryStringParams));
                }
                else if (response.statusCode == 200) {
                    return response.body
                } 
                else {
                    throw new Error(`Got ${response.statusCode}: ` + response.body)
                }
            });
        }
        else {
            return this.login().then(x => this.get(path, queryStringParams));
        }
    }

    async getLeagueYear(leagueID: string, year: number): Promise<LeagueYear> {
        return this.get(this.PATH_GET_LEAGUE_YEAR, {
            leagueID: leagueID,
            year: year
        });
    }

    async getLeagueActions(leagueID: string, year: number): Promise<LeagueAction[]> {
        return this.get(this.PATH_GET_LEAGUE_ACTIONS, {
            leagueID: leagueID,
            year: year
        });
    }

    async getMasterGameYear(year: number): Promise<MasterGameYear[]> {
        return this.get(this.PATH_GET_MASTER_GAME_YEAR + "/" + String(year));
    }
    
};
