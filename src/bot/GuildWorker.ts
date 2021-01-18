import * as NodeCache from "node-cache";

import schedule = require('node-schedule');
import { Mutex } from 'async-mutex';
import * as FCDiff from "./fcdifftools";
import * as FC from "../fc/main";
import * as OpenCritic from "../opencritic/main";
var ranked = require('ranked');

import * as Discord from 'discord.js';
import * as _ from "lodash";

import { FCMemcache } from './FCMemcache'
import { FCMongo } from './FCMongo'
import { FCBot } from "./main";
import { stringify } from "querystring";
import { group } from "console";

export interface WorkerSaveState {
    guildId: string,
    fcAuth: any,
    league: FC.League,
    channelNames: string[],
    running: boolean
};

export class GuildWorker {
    private guild: Discord.Guild;
    private memcache: FCMemcache;
    private fc: FC.Client;
    private ocClient: OpenCritic.OCClient;
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
        this.fc = new FC.Client();
        this.ocClient = new OpenCritic.OCClient();
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
        // NOTE called in constructor

        var state: WorkerSaveState = await this.mongo.get(this.guild.id);
        console.log("loadState");
        if (state) {
            console.log("Found state");
            console.log(state);
            this.league = state.league;
            for (var name of state.channelNames) {
                var found = <Discord.TextChannel>this.guild.channels.cache.find(c => c.name == name && c.type == "text");
                if (!found) {
                    console.log(`Loaded state had channel #${name} but it wasn't found in the guild.`);
                } else {
                    this.channels.push(found);
                }
            }
            if (state.fcAuth && state.fcAuth.token && state.fcAuth.token.length > 4096) {
                // assume there is some problem (there is, due to a problem on the FC server)
                console.log("Discarding fcAuth value due to ridiculous length");
                this.channels.forEach(ch => {
                    ch.send("Authorization reset due to server issue. Please re-login.");
                });
            }
            else {
                this.fc.auth = state.fcAuth;
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

    getLeague() {
        return this.league;
    }

    hasLeague() {
        if (this.league) {
            return true;
        } else {
            return false;
        }
    }

    private playStatusMap = {
        "Drafting": "Draft in Progress",
        "DraftPaused": "Draft in Progress (paused)",
        "DraftFinal": "League in Play (Draft Complete)",
        "NotStartedDraft": "League is in pre-draft signup mode"
    };
    
    async doScoreReport(channel: Discord.TextChannel) {
        if (!this.league) {
            throw new Error("Can't do score without league set. (Check !fcadminhelp for commands.)");
        }

        const leagueYear = await this.getLeagueYear();
        const leagueUpcoming = await this.getLeagueUpcoming();

        const leagueStatus = _.get(this.playStatusMap, leagueYear.playStatus.playStatus, `Unrecognized status: ${leagueYear.playStatus.playStatus}`);

        const rankedPlayers: { rank: number, item: FC.Player }[] =
            ranked.ranking(leagueYear.players, (pl: FC.Player) => pl.totalFantasyPoints);

        var strings: string[] = [];
        
        if (leagueYear.playStatus.playStatus != "DraftFinal") {
            strings.push(
                "*Note: " + leagueStatus + "*"
            );
        }

        strings = strings.concat(rankedPlayers.map(ranking => {
            const pl = ranking.item;
            const rank = ranking.rank;
            var playerNameString = pl.user.displayName;
            if (pl.previousYearWinner) {
                playerNameString = playerNameString + "👑";
            }
            if (pl.publisher == null) {
                return `.. No publisher defined (${playerNameString}) - n/a points`;
            }
            else {
                return `**${rank}. ${pl.publisher.publisherName}** (${playerNameString}) - ` +
                    `**${Math.round(pl.totalFantasyPoints * 100) / 100} points**`;
            }
        }));
        const embed = new Discord.MessageEmbed();
        embed.setDescription(strings.join('\n'));

        const user1 = leagueYear.players[0].user;
        embed.setTitle(user1.leagueName);
        embed.setURL(FC.Client.leagueUrl(this.league.id, this.league.year));
        embed.setColor("ffcc00");

        if (leagueUpcoming.length > 0) {
            const rankedUpcoming: { rank: number, item: FC.LeagueUpcomingGame }[] =
            ranked.ranking(leagueUpcoming, (lug: FC.LeagueUpcomingGame) => lug.maximumReleaseDate, { reverse: true });
            const firstUpcoming = _.filter(rankedUpcoming, ranking => ranking.rank == 1);

            const gameDescs = GuildWorker.joinWithAnd(
                _.map(firstUpcoming, ranking => `${ranking.item.gameName} (for ${ranking.item.publisherName})`)
            );
            const releaseWord = (firstUpcoming.length > 1) ? "releases" : "release";

            embed.setFooter(
                `Next expected ${releaseWord}: ${gameDescs}, by ${FCDiff.cleandate(firstUpcoming[0].item.estimatedReleaseDate)}`
            );       
        }

        channel.send(embed);
    }

    private static joinWithAnd(arr: string[]) {
        if (arr.length == 0) {
            return '';
        }
        if (arr.length == 1) {
            return arr[0];
        }
        return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
    }

    async doPublisherReport(channel: Discord.TextChannel, searchString: string) {
        if (!this.league) {
            throw new Error("Can't do publisher report without league set. (Check !fcadminhelp for commands.)");
        }

        const leagueYear = await this.getLeagueYear();
        const player = _.find(leagueYear.players, (pl: FC.Player) => 
            pl.publisher != null && pl.publisher.publisherName.toLowerCase().includes(searchString.toLowerCase())
        );

        if (!player) {
            throw new Error(`No publisher matching '${searchString}'. (Use !fcscore for a list.)`)
        }
        const leagueStatus = _.get(this.playStatusMap, leagueYear.playStatus.playStatus, `Unrecognized status: ${leagueYear.playStatus.playStatus}`);
        const pub = player.publisher;

        var embed = new Discord.MessageEmbed();
        embed.setTitle(pub.publisherName)

        var strings = [
            `(Player: ${pub.playerName})`
        ];

        if (leagueYear.playStatus.playStatus != "DraftFinal") {
            strings.push(
                "*Note: " + leagueStatus + "*"
            );
        }

        strings = strings.concat( pub.games.map(game => {
            var name = game.gameName;
            var points = "";
            var score = "";
            if (game.counterPick) {
                name = "*" + name + " (cp)*";
            }
            name = "**" + name + "**";
            if (game.fantasyPoints !== undefined && game.fantasyPoints != null) {
                points = " - Points: **" + FCDiff.cleannum(game.fantasyPoints) + "**";
            }
            if (game.criticScore !== undefined && game.criticScore != null) {
                score = " - Rating: **" + FCDiff.cleannum(game.criticScore) + "**";
            }
            if (!game.willRelease) {
                name = name + " - will not release this year";
            }
            else if (!game.released) {
                if (game.releaseDate) {
                    return `${name} - ${FCDiff.cleandate(game.releaseDate)}` + score + points;
                }
                else {
                    return `${name} - ${FCDiff.cleandate(game.estimatedReleaseDate)} (est.)` + score + points;
                }
            }
            else {
                return `${name}` + score + points; 
            }
        }) );

        strings = strings.filter(s => s != undefined && s != null && s.length > 0);
        strings.push(`Total points: **${FCDiff.cleannum(pub.totalFantasyPoints)}**`);

        embed.setDescription(strings.join('\n'));
        embed.setColor("aaccff");
        console.log(strings.join('\n'));
        channel.send(embed);
    }

    private firstSentenceRegexp = new RegExp(/^(?:[A-Z ]+\n)*\n*([^\.\!]+[\.\!])[\s$]/, "m");

    private async infoForOne(game: FC.MasterGameYear): Promise<string | Discord.MessageEmbed> {
        var embed = new Discord.MessageEmbed();

        if (game.openCriticID) {
            var ocGame = await this.ocClient.getGame(game.openCriticID);

            embed.setTitle(ocGame.name);
            embed.setURL('https://opencritic.com/game/' + game.openCriticID.toString() + '/view');
    
            var companyGroups = [
                ocGame.Companies.filter(c => c.type == "DEVELOPER").map(c => c.name).join(", "),
                ocGame.Companies.filter(c => c.type == "PUBLISHER").map(c => c.name).join(", ")
            ];
            companyGroups = companyGroups.filter(group => group.length > 0);
            const genrecompanies = 
                `(${ocGame.Genres.map(g => g.name).join(", ")}. ${companyGroups.join("; ")}.)`;        

            const tagString = game.tags.join(" / ");

            var body = `*${tagString}*\n`

            if (ocGame.description) {
                const firstSentence = ocGame.description.match(this.firstSentenceRegexp);

                if (firstSentence.length > 0) {
                    body = body + firstSentence[1];
                } else {
                    body = body + ocGame.description;
                }
            } else {
                body = body + "No description available.";
            }


            body = body + "\n" + genrecompanies;

            embed.setDescription(body);

            if (ocGame.logoScreenshot && ocGame.logoScreenshot.thumbnail) {
                embed.setThumbnail("https:" + ocGame.logoScreenshot.thumbnail);
            }
            else if (ocGame.bannerScreenshot && ocGame.bannerScreenshot.thumbnail) {
                embed.setThumbnail("https:" + ocGame.bannerScreenshot.thumbnail);
            }
            else if (ocGame.mastheadScreenshot && ocGame.mastheadScreenshot.thumbnail) {
                embed.setThumbnail("https:" + ocGame.mastheadScreenshot.thumbnail);
            }
            console.log("  Thumbnail: " + embed.thumbnail);
     
            if (ocGame.numTopCriticReviews < 3) {
                embed.addField("Critic Score", "N/A", true);
            } else {
                embed.addField("Critic Score", `${FCDiff.cleannum(ocGame.topCriticScore)}, from ${ocGame.numTopCriticReviews} reviews`, true);
                embed.addField("Fantasy Points", (game.projectedOrRealFantasyPoints > 0 ? "+" : "") + FCDiff.cleannum(game.projectedOrRealFantasyPoints), true);
            }

            if (ocGame.reviewSummary.completed) {
                embed.setFooter("\"" + ocGame.reviewSummary.summary + "\"");
            }
        } 
        else {
            embed.setTitle(game.gameName);
            const tagString = game.tags.join(" / ");
            embed.setDescription(`*${tagString}*\n(No OpenCritic link.)`);
        }

        if (game.isReleased) {
            embed.addField("Released", FCDiff.cleandate(game.releaseDate), true);
        } else if (game.releaseDate) {
            embed.addField("Scheduled Release", FCDiff.cleandate(game.releaseDate), true);
        } else if (game.estimatedReleaseDate) {
            embed.addField("Estimated Release", FCDiff.cleandate(game.estimatedReleaseDate), true);
        }

        if (!game.isReleased) {
            if (game.dateAdjustedHypeFactor != undefined && game.dateAdjustedHypeFactor != null) {
                embed.addField("Hype Factor", FCDiff.cleannum(game.dateAdjustedHypeFactor), true);
            }
            if (game.averageDraftPosition != undefined && game.averageDraftPosition != null) {
                embed.addField("Average Draft Position", FCDiff.cleannum(game.averageDraftPosition), true);
            }
        } 

        return embed;
    }

    async checkOne(channel: Discord.TextChannel, gameSearch: string) {
        if (!this.league) {
            throw new Error("Can't check a game without a league set. (Check !fcadminhelp for commands.)");
        }
        var MGYdict = this.lastMasterGameYear;
        if (!MGYdict) {
            MGYdict = await this.getMGY();
        }
        var search = gameSearch.toLowerCase();

        var hits = _.values(MGYdict).filter(mgy => mgy.gameName.toLowerCase().includes(search));

        if (hits.length > 1) {
            // try exact match
            var exactHits = hits.filter(mgy => mgy.gameName.toLowerCase() == search);
            if (exactHits.length == 1) {
                hits = exactHits;
            }
        }

        var result: string | Discord.MessageEmbed;
        if (hits.length > 5) {
            result = `Got ${hits.length} hits for "${gameSearch}" - be more specific.`
        }
        else if (hits.length > 1) {
            result = `Which one: ${hits.map(mgy => mgy.gameName).join(', ')}?`
        }
        else if (hits.length == 1) {
            result = await this.infoForOne(hits[0]);
        }
        else {
            result = `No results for "${gameSearch}".`;
        }
        FCBot.logSend(channel, result.toString());

        try {
            channel.send(result);
        } catch (e) {
            if (e.message.includes("Missing Permissions")) {
                channel.send("Unable to embed result -- insufficient permissions.\n" +
                    `Server admin should go to https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=${FCBot.NEEDS_PERMISSIONS}&scope=bot to reauthorize.`)
            } else {
                throw e;
            }
        }
    }

    async startSchedule() {
        // the big site updates happens every even hour, so let's do the big check every few mins until :10.
        // skip multiples of three so we don't collide with small checks.
        // this should only be every other hour, but due to UTC and daylight savings times, I don't want to 
        // deal with that shit, so let's just try every hour and half the time this will be wrong.
        this.jobs["big"] =
            schedule.scheduleJob('1,2,4,5,7,10 * * * *', this.doCheck.bind(this, true, "big"));

        // let's do small checks every 3 minutes
        this.jobs["small"] =
            schedule.scheduleJob('*/3 * * * *', this.doCheck.bind(this, false, "small"));

        // Bids and drops go through Saturday evenings at 8PM Eastern
        // heroku times are in UTC, which makes this Sunday morning at 1am.
        //                                                s    m      h D M W
        this.jobs["bidsAndDrops"] = schedule.scheduleJob('0 0,1,2,4,5 1 * * 0', this.doCheck.bind(this, false, "bidsAndDrops"));

        _.forOwn(this.jobs, (job, jobname) =>
            console.log(`For guild "${this.guild.name}" (${this.guild.id}): the first`, jobname, "job will run at", job.nextInvocation().toString())
        );

        this.doCheck(true, "startup phase 1").then(_ => this.doCheck(false, "startup phase 2"));
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
        if (!this.league) {
            return;
        }
        if (!this.lastLeagueYear)
            this.lastLeagueYear = await this.memcache.getLongLived(
                FCMemcache.leagueYearKey(this.league)
            );
        if (!this.lastLeagueActions)
            this.lastLeagueActions = await this.memcache.getLongLived(
                FCMemcache.leagueActionsKey(this.league)
            );

        if (!this.lastMasterGameYear && this.league.year != undefined && this.league.year != null)
            this.lastMasterGameYear = await this.memcache.getLongLived(
                FCMemcache.masterGameYearKey(this.league.year)
            );
    }

    private async recordInMemcache() {
        if (!this.league) {
            return;
        }
        this.memcache.setLongLived(FCMemcache.leagueYearKey(this.league), this.lastLeagueYear);
        this.memcache.setLongLived(FCMemcache.leagueActionsKey(this.league), this.lastLeagueActions);
        this.memcache.setLongLived(FCMemcache.masterGameYearKey(this.league.year), this.lastMasterGameYear);
    }

    private updatesForLeagueYear(newLeagueYear: FC.LeagueYear): string[] {
        var updates: string[] = [];
        if (this.lastLeagueYear) {
            updates = FCDiff.diffLeagueYear(this.lastLeagueYear, newLeagueYear)
            updates = updates.concat(FCDiff.diffLeagueYearStatusAndMessages(this.lastLeagueYear, newLeagueYear));
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

    private async getLeagueUpcoming(): Promise<FC.LeagueUpcomingGame[]> {
        return this.fc.getLeagueUpcoming(this.league);
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
        if (!this.league) {
            console.log("No league, skipping check.");
            return;
        }
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

            if (doMasterCheck) {
                var newMGY = await this.getMGY();
                updateLength = updates.push(... this.updatesForMasterGameYear(newMGY));
                console.log("Currently have", updateLength, "updates");
            }
            else {
                var newLeagueYear = await this.getLeagueYear();
                var updateLength = updates.push(... this.updatesForLeagueYear(newLeagueYear));
                console.log("Currently have", updateLength, "updates");
    
                var newLeagueActions = await this.getLeagueActions();
                updateLength = updates.push(... this.updatesForLeagueActions(newLeagueActions));
                console.log("Currently have", updateLength, "updates");
            }

            this.sendUpdates(updates);
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

    private sendUpdates(updates: string[]) {
        if (updates.length > 40) {
            console.log("Obviously something is wrong, not sending the", updates.length, "updates queued for channel");
            return;
        }

        // basic dedupe
        const uniqUpdates = _.uniq(updates);

        // only keep updates that are NOT in the cache.
        const filteredUpdates = _.filter(uniqUpdates, upd => this.updateCache.get(upd) === undefined);

        console.log("There are", filteredUpdates.length, "updates to send to", this.channels.length, "channels.");
        if (filteredUpdates.length != uniqUpdates.length) {
            console.log(uniqUpdates.length - filteredUpdates.length, "updates were filtered out by the updateCache.");
        }

        var first_send = true;
        var to_send = "";
        const separator = '\n';
        const self = this; // for closure
        _.chunk(filteredUpdates, 6).forEach(function (chunk) {
            if (first_send) {
                to_send = "*News!*" + separator + chunk.join(separator);
                first_send = false;
            } else {
                to_send = chunk.join(separator);
            }
            self.channels.forEach((channel: Discord.TextChannel) => {
                FCBot.logSend(channel, to_send);
                channel.send(to_send);
            })
        });

        this.updateCache.mset(updates.map(function (upd) { return { key: upd, val: 1 }; }));
    }
}
