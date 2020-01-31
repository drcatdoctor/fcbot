import * as FC from "./fcclient";
import * as Discord from 'discord.js';
import * as NodeCache from "node-cache";

require('dotenv').config()
const ordinal = require('ordinal')

import * as deepdiff from 'deep-diff';
import * as _ from "lodash";

class FCBot {

    discord: Discord.Client;
    fc: FC.Client;
    masterListEveryNChecks: number;
    check_number: number;

    discordChannels: Discord.TextChannel[] = [];

    leagueID: string;
    leagueYear: number;

    lastLeagueYear: FC.LeagueYear = undefined;
    lastLeagueActions: FC.LeagueAction[] = undefined;
    lastMasterGameYear: _.Dictionary<FC.MasterGameYear> = undefined;

    updateCache = new NodeCache({ stdTTL: Number(process.env.DEDUPE_WINDOW_SECS) });

    constructor() {
        this.discord = new Discord.Client();
        this.fc = new FC.Client(process.env.FC_EMAIL_ADDRESS, process.env.FC_PASSWORD);
        this.leagueID = process.env.LEAGUE_ID;
        this.leagueYear = Number(process.env.LEAGUE_YEAR);
        this.check_number = 0;

        // attach events
        this.discord.on('message', this.handleMessage.bind(this));
        this.discord.on('ready', this.handleReady.bind(this));
        console.log("Initialized FCBot");
        console.log(this.fc);
    }

    run() {
        this.discord.login(process.env.BOT_TOKEN);

        setImmediate(this.loop.bind(this));
        setInterval(this.loop.bind(this), Number(process.env.CHECK_INTERVAL_SECONDS) * 1000);
    }

    static filterAnythingButPublishers(path: string[], key: string) {
        return (path.length == 0 && key != 'publishers');
    }


    loop() {
        const doMasterCheck = (this.check_number % this.masterListEveryNChecks == 0);
        this.check_number++;
        console.log(`Start check ${this.check_number}`)
    
        this.fc.getLeagueYear(this.leagueID, this.leagueYear)
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
    
    static diffMGY(lastMGY: _.Dictionary<FC.MasterGameYear>, newMGY: _.Dictionary<FC.MasterGameYear>): string[] {
        const difflist = deepdiff.diff(lastMGY, newMGY);

        if (!difflist) {
            return [];
        }

        var updates: string[] = [];
        difflist.forEach(function (d) {
            console.log(d);
            if (d.path.length > 1) {
                const gameMasterID = d.path[0];
                const key = d.path.slice(1).join('.');
                const gamedata = newMGY[gameMasterID];
                const update = FCBot.updateForGame(gamedata, key, d);
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
        // only keep updates that are NOT in the cache.
        const filteredUpdates = _.filter(updates, upd => this.updateCache.get(upd) === undefined );
    
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

    static updateForGame(game: FC.Game, key: string, d: any): string | undefined {
        switch (key) {
            case "released":   // publishers view
            case "isReleased": // master game list view
                if (d.rhs) 
                    return `**${game.gameName}** is out!`;
                else
                    return;
            case "criticScore":
                return FCBot.addLhs(`**${game.gameName}** critic score is now **${d.rhs}**!`, d);
            case "fantasyPoints":
                const points = (<FC.PublisherGame>game).counterPick ? -(d.rhs) : d.rhs;
                return `**${game.gameName}** is now worth **${points} points**!`;
            case "willRelease":
                if (d.rhs)
                    return `**${game.gameName}** now officially **will release** in ${process.env.LEAGUE_YEAR}.`;
                else
                    return `**${game.gameName}** now officially **will not release** in ${process.env.LEAGUE_YEAR}.`;
            case 'estimatedReleaseDate':
                return FCBot.addLhs(`**${game.gameName}** estimated release date is now **${d.rhs}**`, d);
            case 'releaseDate':
                return FCBot.addLhs(`**${game.gameName}** official release date is now **${d.rhs}**`, d);
            case 'eligibilitySettings.eligibilityLevel.name':
                return FCBot.addLhs(`**${game.gameName}** is now categorized as **\"${d.rhs}\"**.`, d);
        }
        return undefined;
    }
    
    static diffPublisherGames(pubdata: FC.Publisher, d: any): string[] {
        // d.path = publishers, N, games, ...?
        let updates: string[] = [];
    
        if (d.kind == 'E') {
            const gameindex = d.path[3]
            const gamedata = pubdata.games[gameindex]
            const update = FCBot.updateForGame(gamedata, d.path[4], d);
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
                const pubdata = newData.publishers[pubindex]
                if (d.path[2] == 'games') {
                    updates = _.union(updates, FCBot.diffPublisherGames(pubdata, d));
                }
                else if (d.path[2] == 'totalFantasyPoints') {
                    const rankStr = rankStrings[pubdata.publisherName];
                    updates.push(
                        `**${pubdata.publisherName}** (Player: ${pubdata.playerName}) has a new score: ` +
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

new FCBot().run();
