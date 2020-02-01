import * as FC from "./fcclient";
import * as Discord from 'discord.js';
import * as NodeCache from "node-cache";

require('dotenv').config()
const ordinal = require('ordinal')

import * as deepdiff from 'deep-diff';
import * as _ from "lodash";
import schedule = require('node-schedule');
import {Mutex} from 'async-mutex';

class FCBot {

    discord: Discord.Client;
    fc: FC.Client;
    masterListEveryNChecks: number;
    check_number: number;
    jobs: _.Dictionary<schedule.Job> = {};

    discordChannels: Discord.TextChannel[] = [];

    leagueID: string;
    leagueYear: number;

    lastLeagueYear: FC.LeagueYear = undefined;
    lastLeagueActions: FC.LeagueAction[] = undefined;
    lastMasterGameYear: _.Dictionary<FC.MasterGameYear> = undefined;

    updateCache = new NodeCache({ stdTTL: Number(process.env.DEDUPE_WINDOW_SECS) });
    jobMutex = new Mutex();

    constructor() {
        this.discord = new Discord.Client();
        this.fc = new FC.Client(process.env.FC_EMAIL_ADDRESS, process.env.FC_PASSWORD);
        this.leagueID = process.env.LEAGUE_ID;
        this.leagueYear = Number(process.env.LEAGUE_YEAR);
        this.check_number = 0;

        // attach events
        this.discord.on('message', this.handleMessage.bind(this));
        this.discord.on('ready', this.handleReady.bind(this));
        console.log("Initialized FCBot!");
    }

    reportNextJob(jobtype: string) {
        const job = this.jobs[jobtype];
        if (job) {
            console.log(`Next ${jobtype} check:`, job.nextInvocation().toString());
        }
    }

    start() {
        this.discord.login(process.env.BOT_TOKEN);

        this.doCheck(true, "startup");

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
            console.log("First", jobname, "job will run at", job.nextInvocation().toString())
        );
    }

    static filterAnythingButPublishers(path: string[], key: string) {
        return (path.length == 0 && key != 'publishers');
    }

    async doCheck(doMasterCheck: boolean, jobtype: string) {
        if (this.jobMutex.isLocked()) {
            console.log("Skipping", jobtype, "check due to job in progress.");
            return;
        }
        const release = await this.jobMutex.acquire();
        console.log("Start", jobtype, "check");
        await this.fc.getLeagueYear(this.leagueID, this.leagueYear)
          .then(
              newLeagueYear => this.updatesForLeagueYear(newLeagueYear)
          ).then( 
              updates => this.fc.getLeagueActions(this.leagueID, this.leagueYear).then (
                  newLeagueActions => updates.concat(this.updatesForLeagueActions(newLeagueActions))
              )
          ).then( 
              updates =>
                doMasterCheck ? this.fc.getMasterGameYear(this.leagueYear).then (
                    newMGY => updates.concat(this.updatesForMasterGameYear(newMGY))
                ) : updates
         ).then( 
             updates =>
                this.discordChannels.forEach(c => this.sendUpdatesToChannel(c, updates))
         );
         this.reportNextJob(jobtype);
         release();
    }

    updatesForLeagueYear(newLeagueYear: FC.LeagueYear): string[] {
        var updates: string[] = [];
        if (this.lastLeagueYear) {
            updates = FCBot.diffLeagueYear(this.lastLeagueYear, newLeagueYear)
        } else {
            console.log("storing first result.")
        }
        this.lastLeagueYear = newLeagueYear;
        return updates;
    }

    updatesForLeagueActions(newLeagueActions: FC.LeagueAction[]): string[] {
        var updates: string[] = [];
        if (this.lastLeagueActions) {
            updates = FCBot.diffLeagueActions(this.lastLeagueActions, newLeagueActions)
        } else {
            console.log("storing first actions.")
        }
        this.lastLeagueActions = newLeagueActions;
        return updates;
    }
    
    updatesForMasterGameYear(newMGYRaw: FC.MasterGameYear[]) {
        const newMGY = _.keyBy(newMGYRaw, game => game.masterGameID);

        console.log("Master Game List check");

        var updates: string[] = [];
        if (this.lastMasterGameYear) {
            updates = FCBot.diffMGY(this.lastMasterGameYear, newMGY);
        } else {
            console.log("storing first master list.")
        }
        this.lastMasterGameYear = newMGY;
        return updates;
    }
    
    static diffMGY(oldMGY: _.Dictionary<FC.MasterGameYear>, newMGY: _.Dictionary<FC.MasterGameYear>): string[] {
        const difflist = deepdiff.diff(oldMGY, newMGY);

        if (!difflist) {
            return [];
        }

        var updates: string[] = [];
        difflist.forEach(function (d) {
            console.log(d);
            if (d.path.length > 1) {
                const gameMasterID = d.path[0];
                const key = d.path.slice(1).join('.');
                const newgame = newMGY[gameMasterID];
                const oldgame = oldMGY[gameMasterID];
                const update = FCBot.updateForGame(oldgame, newgame, key, d);
                if (update) updates.push(update); 
            }
            else if (d.kind == 'N') {
                const gameMasterID = d.path[0];
                const gamedata = newMGY[gameMasterID];
                updates.push(
                    `New game added! **${gamedata.gameName}**, est. release ${gamedata.estimatedReleaseDate}.`
                );
            }
        });
        console.log("--- Master list updates");
        console.log(updates);
        return updates;
    }
    

    handleMessage(message: Discord.Message) {
        //if(!message.guild || message.author.bot) return;

        //if(message.content.indexOf('!') !== 0) return;
    
        //const args = message.content.split(/\s+/g);
        //const command = args.shift().slice(guildConf.prefix.length).toLowerCase();
    
        // Alright. Let's make a command! This one changes the value of any key
        // in the configuration.
        //if(command === "setconf") {
        //    return doSetConf(message, args);
        //}
        //if(command === "showconf") {
        //    return doShowConf(message, args);
        //}
    }

    handleReady() {
        console.log(`Logged in as ${this.discord.user.tag}!`);
        var myGuilds: Discord.Collection<string, Discord.Guild>;
        if (process.env.LIMIT_TO_GUILD_ID) {
            myGuilds = this.discord.guilds.filter( (value, key) => key == process.env.LIMIT_TO_GUILD_ID);
        } else {
            myGuilds = this.discord.guilds;
        }
        this.discordChannels = <Discord.TextChannel[]>
            myGuilds.map(g => g.channels.find(c => c.name == "fantasy-games-critic" && c.type == "text"))
        this.discordChannels.forEach(c => console.log(`Discord active on: #${c.name} on "${c.guild.name}"`));
    }

    sendUpdatesToChannel(channel: Discord.TextChannel, updates: string[]) {
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

    static addLhs(s: string, d: {lhs: string | null | undefined}): string {
        if (d.lhs)
            return s + ` (was: ${d.lhs})`;
        else
            return "NEW: " + s;
    }

    static DATE_REGEXP = new RegExp(/(\d\d\d\d-\d\d-\d\d)T\d\d:\d\d:\d\d/);
    static cleandate(s: string) {
        if (!s) return s;
        const results = FCBot.DATE_REGEXP.exec(s);
        if (results) {
            const justTheDate = results[1];
            return justTheDate;
        } else {
            return s;
        }
    }

    static updateForReleaseDate(oldgame: FC.Game, newgame: FC.Game): string | undefined {
        var oldOfficial = FCBot.cleandate(oldgame.releaseDate);
        var newOfficial = FCBot.cleandate(newgame.releaseDate);
        var oldEstimate = FCBot.cleandate(oldgame.estimatedReleaseDate);
        var newEstimate = FCBot.cleandate(newgame.estimatedReleaseDate);

        if (newOfficial && !oldOfficial) {
            return `**${newgame.gameName}** has an official release date: **${newOfficial}**`;    
        }
        else if (!newOfficial && oldOfficial) {
            var extra = "";
            if (newEstimate != oldEstimate) {
                extra = ` The new estimate is ${newEstimate} (was: ${oldEstimate})`
            }
            return `**${newgame.gameName}** had its official release date **removed**.` + extra;    
        }
        else if (newOfficial != oldOfficial) {
            // official change
            return `**${newgame.gameName}** has a new official release date: **${newOfficial}** (was: ${oldOfficial})`;
        }
        else if (newEstimate != oldEstimate) {
            // either no official date, or official date didn't change
            return `**${newgame.gameName}** has a new estimated release: **${newEstimate}** (was: ${oldEstimate})`;
        }
        else // nothing changed
            return undefined;
    }

    static updateForGame(oldgame: FC.Game, newgame: FC.Game, key: string, d: any): string | undefined {
        switch (key) {
            case "released":   // publishers view
            case "isReleased": // master game list view
                if (d.rhs) 
                    return `**${newgame.gameName}** is out!`;
                else
                    return;
            case "criticScore":
                if (!d.rhs) {
                    return FCBot.addLhs(`**${newgame.gameName}** critic score was removed??`, d)
                }
                else if (d.lhs && Math.abs(d.rhs - d.lhs) > 1.0) {
                    // this could mean that maybe a critic score could slide many, many points very slowly
                    // but this will have to do for now I guess
                    return FCBot.addLhs(`**${newgame.gameName}** critic score is now **${d.rhs}**!`, d);
                }
                else
                    return undefined;
            case "fantasyPoints":
                const points = (<FC.PublisherGame>newgame).counterPick ? -(d.rhs) : d.rhs;
                return `**${newgame.gameName}** is now worth **${points} points**!`;
            case "willRelease":
                if (d.rhs)
                    return `**${newgame.gameName}** now officially **will release** in ${process.env.LEAGUE_YEAR}.`;
                else
                    return `**${newgame.gameName}** now officially **will not release** in ${process.env.LEAGUE_YEAR}.`;
            case 'estimatedReleaseDate':
            case 'releaseDate':
                return FCBot.updateForReleaseDate(oldgame, newgame);
            case 'eligibilitySettings.eligibilityLevel.name':
                return FCBot.addLhs(`**${newgame.gameName}** is now categorized as **\"${d.rhs}\"**.`, d);
        }
        return undefined;
    }
    
    static diffPublisherGames(oldpub: FC.Publisher, newpub: FC.Publisher, d: any): string[] {
        // d.path = publishers, N, games, ...?
        let updates: string[] = [];
    
        if (d.kind == 'E') {
            const gameindex = d.path[3]
            const oldgame = oldpub.games[gameindex]
            const newgame = newpub.games[gameindex]
            const update = FCBot.updateForGame(oldgame, newgame, d.path[4], d);
            if (update) updates.push(update);        
        }
        return updates;
    }

    static diffLeagueYear(oldData: FC.LeagueYear, newData: FC.LeagueYear): string[] {
        const difflist = deepdiff.diff(oldData, newData, FCBot.filterAnythingButPublishers);

        if (!difflist) {
            return [];
        }

        let updates: string[] = [];
    
        // build ranking
        let rankStrings: {[index: string]: string} = {};
        _.chain(newData.publishers).groupBy(pub => pub.totalFantasyPoints).toPairs().orderBy(0, "desc").value().forEach( 
            function (pair, index) {
                const pubGroup = pair[1];
                const isTied = pair[1].length > 1;
                pubGroup.forEach( function (pub) {
                    const rankStr = (isTied ? "tied for " : "") + ordinal(index + 1);
                    rankStrings[pub.publisherName] = rankStr;
                });
            }
        );
    
        difflist.forEach(function (d: any) {
            console.log(d);
            if (d.path[0] == "publishers" && d.path.length > 2) {
                const pubindex = d.path[1]
                const newpub = newData.publishers[pubindex]
                const oldpub = oldData.publishers[pubindex]
                if (d.path[2] == 'games') {
                    updates = _.union(updates, FCBot.diffPublisherGames(oldpub, newpub, d));
                }
                else if (d.path[2] == 'totalFantasyPoints') {
                    const rankStr = rankStrings[newpub.publisherName];
                    updates.push(
                        `**${newpub.publisherName}** (Player: ${newpub.playerName}) has a new score: ` +
                        `**${d.rhs}**! (was: ${d.lhs}). They are currently **${rankStr}**.`
                    )
                }
            }    
        });
        console.log("--- Publisher updates");
        console.log(updates);
        return updates;
    }

    static diffLeagueActions(oldLA: FC.LeagueAction[], newLA: FC.LeagueAction[]) {
        const difflist = deepdiff.diff(oldLA, newLA);
        if (!difflist) {
            return [];
        }
    
        var updates: string[] = [];
        // count number of Ns
        var news = 0;
        difflist.forEach(function (d) {
            if (d.path === undefined && d.kind == 'A' && d.item.kind == 'N') {
                news++;
            }    
        });
        updates = newLA.slice(0, news).map( action =>
            `**${action.publisherName}**: ${action.description}`
        );
        console.log("--- Action updates");
        console.log(updates);
        return updates;
    }
}

new FCBot().start();
