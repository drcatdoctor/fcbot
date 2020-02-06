import * as NodeCache from "node-cache";

import schedule = require('node-schedule');
import {Mutex} from 'async-mutex';
import * as FCDiff from "./fcdifftools";
import * as FC from "../fc/main";
import * as Client from "../fc/Client";
var ranked = require('ranked');

import * as Discord from 'discord.js';
import * as _ from "lodash";

import { FCMemcache } from './FCMemcache'
import { FCMongo } from './FCMongo'
import { FCBot } from "./main";

export interface WorkerSaveState {
    guildId: string,
    fcAuth: any,
    league: FC.League,
    channelNames: string[],
    running: boolean
}

export class GuildWorker {
    // set in constructor
    private guild: Discord.Guild;
    private memcache: FCMemcache;
    private fc: FC.Client;
    private mongo: FCMongo;
    running: boolean = false;

    private channels: Discord.TextChannel[] = [];
    private league: FC.League;

    private jobs: _.Dictionary<schedule.Job> = {};
    private jobMutex = new Mutex();
    private lastLeagueYear: FC.LeagueYear = undefined;
    private lastLeagueActions: FC.LeagueAction[] = undefined;
    private lastMasterGameYear: _.Dictionary<FC.MasterGameYear> = undefined;
    private updateCache = new NodeCache({ stdTTL: Number(process.env.DEDUPE_WINDOW_SECS) });

    constructor(guild: Discord.Guild, memcache: FCMemcache, mongo: FCMongo) {
        this.guild = guild;
        this.memcache = memcache;
        this.mongo = mongo;
        this.fc = new Client.Client();
        console.log("constructing GuildWorker doing loadState");
        this.loadState();
        this.fc.on('authRefresh', this.handleFCAuthRefresh.bind(this));
    }

    handleFCAuthRefresh(auth: any) {
        console.log("handleFCAuthRefresh saveState");
        this.saveState();
    }

    getChannelNamesList(): string[] {
        if (this.channels.length == 0) {
            return [];
        }
        else {
            return this.channels.map(c => "#" + c.name);
        }
    }

    addChannel(channelToAdd: Discord.TextChannel) { 
        this.channels = _.union(this.channels, [channelToAdd]);
        this.saveState();
    }

    removeChannel(channelToRemove: Discord.TextChannel) {
        _.remove(this.channels, c => c == channelToRemove)
        this.saveState();
    }

    private async loadState() {
        var state: WorkerSaveState = await this.mongo.get(this.guild.id);
        console.log("loadState");
        if (state) {
            console.log("Found state");
            console.log(state);
            this.fc.auth = state.fcAuth;
            this.league = state.league;
            for (var name of state.channelNames) {
                var found = <Discord.TextChannel>this.guild.channels.find(c => c.name == name && c.type == "text");
                if (!found) {
                    console.log(`Loaded state had channel #${name} but it wasn't found in the guild.`);
                } else {
                    this.channels.push(found);
                }
            }
            if (state.running) {
                this.startSchedule();
            }
        }
    }

    private async saveState() {
        var state: WorkerSaveState = {
            guildId: this.guild.id,
            fcAuth: this.fc.auth,
            league: this.league,
            channelNames: this.channels.map(c => c.name),
            running: this.running
        };
        console.log("saveState");
        console.log(state);
        return this.mongo.set(state);
    }

    async doFCLogin(emailAddress: string, password: string) {
        // state save will be handled by the authRefresh event
        return this.fc.login(emailAddress, password);
    }

    setLeague(leagueId: string, leagueYear: number) {
        this.league = { id: leagueId, year: leagueYear };
        console.log("setLeague saveState");
        this.saveState();
    }

    async doScoreReport(channel: Discord.TextChannel) {
        if (!this.league) {
            throw new Error("can't do score without league set");
        }
        if (!this.fc.auth) {
            throw new Error("can't do score without FC client logged in");
        }

        const leagueYear = await this.getLeagueYear();
        const rankedPlayers: {rank: number, item: FC.Player}[] = 
            ranked.ranking(leagueYear.players, (pl: FC.Player) => pl.totalFantasyPoints);

        var strings = rankedPlayers.map(ranking => {
            const pl = ranking.item;
            const rank = ranking.rank;
            return `**${rank}. ${pl.publisher.publisherName}** (${pl.publisher.playerName}) -- ` + 
            `**${pl.totalFantasyPoints.toPrecision(2)} points** (${pl.advancedProjectedFantasyPoints.toPrecision(2)} projected)`
        })
        const to_send = '*Score Report*\n' + strings.join('\n');
        FCBot.logSend(channel, to_send);
        channel.send(to_send);
    }

    static infoForOne(game: FC.MasterGameYear): string {
        var l1 = `${game.gameName}, a ${game.eligibilitySettings.eligibilityLevel.name} `;
        if (game.isReleased) {
            l1 += "released on " + FCDiff.cleandate(game.releaseDate);
        } else if (game.releaseDate) {
            l1 += "scheduled for " + FCDiff.cleandate(game.releaseDate);
        } else if (game.estimatedReleaseDate) {
            l1 += "estimated release " + FCDiff.cleandate(game.estimatedReleaseDate);
        }
        var l2s: string[] = [];
        if (game.criticScore) {
            l2s.push( "Critic score " + FCDiff.cleannum(game.criticScore) );
        }
        if (game.projectedFantasyPoints) {
            l2s.push( "Projected points " + FCDiff.cleannum(game.projectedFantasyPoints) );
        }     
        var l3s: string[] = [];   
        if (game.percentStandardGame !== undefined) {
            l3s.push( `Picked %${FCDiff.cleannum(game.percentStandardGame * 100.0)} of the time` );
        }
        if (game.percentCounterPick !== undefined) {
            l3s.push( `Counterpicked %${FCDiff.cleannum(game.percentCounterPick * 100.0)} of the time` );
        }
        var line = l1;
        if (l2s) {
            line = line + "\n" + l2s.join(' - ');
        }
        if (l3s) {
            line = line + "\n" + l3s.join("\n");
        }
        return line;
    }

    async checkOne(channel: Discord.TextChannel, gameSearch: string) {
        var MGYdict = this.lastMasterGameYear;
        if (!MGYdict) {
            MGYdict = await this.getMGY();
        }
        var search = gameSearch.toLowerCase();

        var hits = _.values(MGYdict).filter( mgy => mgy.gameName.toLowerCase().includes(search) );

        var result: string;
        if (hits.length > 5) {
            result = `Got ${hits.length} hits for "${gameSearch}" - be more specific.`
        }
        else if (hits.length > 1) {
            result = `Which one: ${hits.map( mgy => mgy.gameName ).join(', ')}?`
        }
        else if (hits.length == 1) {
            result = GuildWorker.infoForOne(hits[0]);
        }
        else {
            result = `No results for "${gameSearch}".`;
        }
        FCBot.logSend(channel, result);
        channel.send(result);
    }

    async startSchedule() {
        if (!this.league) {
            throw new Error("can't start guild schedule without league set");
        }
        if (!this.fc.auth) {
            throw new Error("can't start guild schedule without FC client logged in");
        }
        // the site update seems to finish at */2:08, so let's do the big check every 1 min from :08 to :12.
        // but also adjust for UTC, so it's not 2 4 6 .. it's 7 9 11 ...
        this.jobs["big"] =
            schedule.scheduleJob('8-12 1,3,5,7,9,11,13,15,17,19,21,23 * * *', this.doCheck.bind(this, true, "big"));

        // let's do small checks every 3 minutes
        this.jobs["small"] = 
            schedule.scheduleJob('*/3 * * * *', this.doCheck.bind(this, false, "small"));

        // Bids go through Monday evenings at 8PM Eastern
        // heroku times are in UTC, which makes this Tuesday morning at 1am.
        //                                       s    m    h D M W
        this.jobs["bids"] = schedule.scheduleJob('0,30 0-59 1 * * 2', this.doCheck.bind(this, false, "bids"));

        // Dropping goes through Sunday evenings at 8PM Eastern.
        // blah blah Monday morning at 1am.
        this.jobs["drops"] = schedule.scheduleJob('0,30 0-59 1 * * 1', this.doCheck.bind(this, false, "drops"));

        _.forOwn(this.jobs, (job, jobname) => 
            console.log(`For guild "${this.guild.name}" (${this.guild.id}): the first`, jobname, "job will run at", job.nextInvocation().toString())
        );

        this.doCheck(true, "startup");
        this.running = true;
        console.log("after start saveState");
        this.saveState();
    }

    async stopSchedule() {
        _.values(this.jobs).forEach(job => job.cancel());
        this.jobs = {};
        console.log(`All jobs unscheduled for guild "${this.guild.name}" (${this.guild.id})`)
        this.running = false;
        console.log("after stop saveState");
        this.saveState();
    }

    private async checkForMemcache() {
        if (!this.lastLeagueYear)
            this.lastLeagueYear = await this.memcache.getLongLived(
                FCMemcache.leagueYearKey(this.league)
            );
        if (!this.lastLeagueActions)
            this.lastLeagueActions = await this.memcache.getLongLived(
                FCMemcache.leagueActionsKey(this.league)
            );
        if (!this.lastMasterGameYear) 
            this.lastMasterGameYear = await this.memcache.getLongLived(
                FCMemcache.masterGameYearKey(this.league.year)
            );
    }

    private async recordInMemcache() {
        this.memcache.setLongLived( FCMemcache.leagueYearKey(this.league), this.lastLeagueYear );
        this.memcache.setLongLived( FCMemcache.leagueActionsKey(this.league), this.lastLeagueActions );
        this.memcache.setLongLived( FCMemcache.masterGameYearKey(this.league.year), this.lastMasterGameYear );
    }

    private updatesForLeagueYear(newLeagueYear: FC.LeagueYear): string[] {
        var updates: string[] = [];
        if (this.lastLeagueYear) {
            updates = FCDiff.diffLeagueYear(this.lastLeagueYear, newLeagueYear)
        } else {
            console.log("storing first result.")
        }
        this.lastLeagueYear = newLeagueYear;
        return updates;
    }

    private updatesForLeagueActions(newLeagueActions: FC.LeagueAction[]): string[] {
        var updates: string[] = [];
        if (this.lastLeagueActions) {
            updates = FCDiff.diffLeagueActions(this.lastLeagueActions, newLeagueActions)
        } else {
            console.log("storing first actions.")
        }
        this.lastLeagueActions = newLeagueActions;
        return updates;
    }
    
    private updatesForMasterGameYear(newMGY: _.Dictionary<FC.MasterGameYear>) {
        console.log("Master Game List check");

        var updates: string[] = [];
        if (this.lastMasterGameYear) {
            updates = FCDiff.diffMGY(this.lastMasterGameYear, newMGY);
        } else {
            console.log("storing first master list.")
        }
        this.lastMasterGameYear = newMGY;
        return updates;
    }

    private async getLeagueYear(): Promise<FC.LeagueYear> {
        const memKey = FCMemcache.leagueYearKey(this.league);
        var newLeagueYear: FC.LeagueYear = await this.memcache.getLive(memKey);
        if (!newLeagueYear) {
            newLeagueYear = await this.fc.getLeagueYear(this.league);
            this.memcache.setLive(memKey, newLeagueYear);
        }
        return newLeagueYear;        
    }

    private async getLeagueActions(): Promise<FC.LeagueAction[]> {
        const memKey = FCMemcache.leagueActionsKey(this.league);
        var newLeagueActions: FC.LeagueAction[] = await this.memcache.getLive(memKey);
        if (!newLeagueActions) {
            newLeagueActions = await this.fc.getLeagueActions(this.league);
            this.memcache.setLive(memKey, newLeagueActions);
        }
        return newLeagueActions;
    }

    private async getMGY(): Promise<_.Dictionary<FC.MasterGameYear>> {
        const memKey = FCMemcache.masterGameYearKey(this.league.year);
        var newMGYRaw: FC.MasterGameYear[] = await this.memcache.getLive(memKey);
        if (!newMGYRaw) {
            newMGYRaw = await this.fc.getMasterGameYear(this.league.year);
            this.memcache.setLive(memKey, newMGYRaw);
        }
        return _.keyBy(newMGYRaw, game => game.masterGameID);
    }

    private async doCheck(doMasterCheck: boolean, jobtype: string) {
        if (this.jobMutex.isLocked()) {
            console.log("Skipping", jobtype, "check due to job in progress.");
            return;
        }
        if (!this.guild.available) {
            console.log(`Guild "${this.guild.name}" is not available - skipping check until later.`);
            return;
        }
       const release = await this.jobMutex.acquire();
        try {
            console.log("Start", jobtype, "check");
            await this.checkForMemcache();

            var updates: string[] = [];

            var newLeagueYear = await this.getLeagueYear();
            updates.push( ... this.updatesForLeagueYear(newLeagueYear) );

            var newLeagueActions = await this.getLeagueActions();
            updates.push( ... this.updatesForLeagueActions(newLeagueActions) );

            if (doMasterCheck) {
                var newMGY = await this.getMGY();
                updates.push( ... this.updatesForMasterGameYear(newMGY) );
            } 

            this.channels.forEach(c => this.sendUpdatesToChannel(c, updates))
            this.recordInMemcache();
        }
        catch (err) {
            console.log("ERROR: ", err);
        }
        finally {
            release();
        }
        this.reportNextJob(jobtype);
    }

    private reportNextJob(jobtype: string) {
        const job = this.jobs[jobtype];
        if (job) {
            console.log(`Next ${jobtype} check:`, job.nextInvocation().toString());
        }
    }

    private sendUpdatesToChannel(channel: Discord.TextChannel, updates: string[]) {
        if(updates.length > 40) {
            console.log("Obviously something is wrong, not sending the", updates.length, "updates queued for channel");
            return;
        }

        // basic dedupe
        const uniqUpdates = _.uniq(updates);

        // only keep updates that are NOT in the cache.
        const filteredUpdates = _.filter(uniqUpdates, upd => this.updateCache.get(upd) === undefined );
    
        var first_send = true;
        var to_send = "";
        const separator = '\n';
        _.chunk(filteredUpdates, 6).forEach(function (chunk) {
            if (first_send) {
                to_send = "*News!*" + separator + chunk.join(separator);
                first_send = false;
            } else {
                to_send = chunk.join(separator);
            }
            FCBot.logSend(channel, to_send);
            channel.send(to_send);
        });
    
        this.updateCache.mset(updates.map(function (upd) { return {key: upd, val: 1}; }));
    }
}
