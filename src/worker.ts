import * as NodeCache from "node-cache";

import schedule = require('node-schedule');
import {Mutex} from 'async-mutex';
import * as FCDiff from "./fcdiff";
import * as FC from "./fc";

import * as Discord from 'discord.js';
import * as _ from "lodash";

import { FCMemcache } from './fcmemcache'
import { FCMongo } from './fcmongo'

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

    channels: Discord.TextChannel[] = [];
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
        this.fc = new FC.Client();
        this.loadState();
        this.fc.on('authRefresh', this.handleFCAuthRefresh.bind(this));
    }

    handleFCAuthRefresh(auth: any) {
        this.saveState();
    }

    async loadState() {
        var state: WorkerSaveState = await this.mongo.get({guildId: this.guild.id});
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

    async saveState() {
        var state: WorkerSaveState = {
            guildId: this.guild.id,
            fcAuth: this.fc.auth,
            league: this.league,
            channelNames: this.channels.map(c => c.name),
            running: this.running
        };
        return this.mongo.set(state);
    }

    async doFCLogin(emailAddress: string, password: string) {
        // state save will be handled by the authRefresh event
        return this.fc.login(emailAddress, password);
    }

    setLeague(leagueId: string, leagueYear: number) {
        this.league = { id: leagueId, year: leagueYear };
        this.saveState();
    }

    async doScoreReport(channel: Discord.TextChannel) {
        if (!this.league) {
            throw new Error("can't do score without league set");
        }
        if (!this.fc.auth) {
            throw new Error("can't do score without FC client logged in");
        }
        var strings = (await this.getLeagueYear()).players.map(pl =>
            `**${pl.publisher.publisherName}** (${pl.publisher.playerName}): ` + 
            `**${pl.totalFantasyPoints} points** (${round_to_precision(pl.advancedProjectedFantasyPoints, 0.01)} projected)`
        )
        channel.send('*Score Report*\n' + strings.join('\n'));
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
        this.saveState();
    }

    async stopSchedule() {
        _.values(this.jobs).forEach(job => job.cancel());
        this.jobs = {};
        console.log(`All jobs unscheduled for guild "${this.guild.name}" (${this.guild.id})`)
        this.running = false;
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
            console.log("Sending:\n" + to_send);
            channel.send(to_send);
        });
    
        this.updateCache.mset(updates.map(function (upd) { return {key: upd, val: 1}; }));
    }
}

function round_to_precision(x, precision) {
    var y = +x + (precision === undefined ? 0.5 : precision/2);
    return y - (y % (precision === undefined ? 1 : +precision));
}
