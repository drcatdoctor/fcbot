import * as deepdiff from 'deep-diff';
import * as FC from "../fc/main";
import * as _ from "lodash";
var ranked = require('ranked');
var dateFormat = require("dateformat");

const ordinal = require('ordinal');

const NUMERICAL_DIFF_REPORT_THRESHOLD = 2.0;

// things we don't care about.
const FILTER_OUT_KEYS = [
    'hypeFactor',
    'dateAdjustedHypeFactor',
    'projectedFantasyPoints',
    'projectedOrRealFantasyPoints',
    'advancedProjectedFantasyPoints',
    'percentStandardGame',
    'eligiblePercentStandardGame',
    'percentCounterPick',
    'eligiblePercentCounterPick',
    'averageDraftPosition',
    'totalProjectedPoints',
];

function filterAnythingButPublishers(path: string[], key: string): boolean {
    return (path.length == 0 && key != 'publishers');
}

function filterOutUninterestingKeys(path: string[], key: string): boolean {
    return FILTER_OUT_KEYS.includes(key);
}

function filterAnythingButStatusAndMessages(path: string[], key: string): boolean {
    return (path.length == 0 && (key != 'managerMessages' && key != 'playStatus'));
}


const DATE_REGEXP = new RegExp(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/);

export function cleandate(s: string) {
    if (!s)
        return s;
    const results = DATE_REGEXP.exec(s);
    if (results) {
        const d = new Date(s);
        return dateFormat(d, "DDDD, mmmm d");
    }
    else {
        return s;
    }
}

export function cleannum(n: number): string {
    return String( Math.round(n*10)/10 );
}

export function diffMGY(oldMGY: _.Dictionary<FC.MasterGameYear>, newMGY: _.Dictionary<FC.MasterGameYear>): string[] {
    const difflist = deepdiff.diff(oldMGY, newMGY, filterOutUninterestingKeys);
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
            const update = updateForGame(oldgame, newgame, key, d);
            if (update)
                updates.push(update);
        }
        else if (d.kind == 'N') {
            const gameMasterID = d.path[0];
            const game = newMGY[gameMasterID];
            var gameInfos = [`New game added! **${game.gameName}**`];
            if (game.criticScore) {
                gameInfos.push(`critic score ${cleannum(game.criticScore)}`)
            }
            // projected points seems to be broken on new entries.
            //else if (game.projectedFantasyPoints) {
            //    gameInfos.push(`projected points ${round_to_precision(game.projectedFantasyPoints, 0.01)}`)
            //}
            if (game.releaseDate) {
                gameInfos.push(`official release ${cleandate(game.releaseDate)}`)
            }
            else if (game.estimatedReleaseDate) {
                gameInfos.push(`est. release ${cleandate(game.estimatedReleaseDate)}`)
            }
            updates.push(gameInfos.join(', ') + ".");
        }
    });
    console.log("--- Master list updates");
    console.log(updates);
    return updates;
}

function addLhs(s: string, d: { lhs: string | null | undefined; }): string {
    if (d.lhs !== null && d.lhs !== undefined)
        return s + ` (was: ${d.lhs})`;
    else
        return "NEW: " + s;
}

function addLhsNum(s: string, d: { lhs: number | null | undefined; }): string {
    if (d.lhs !== null && d.lhs !== undefined)
        return s + ` (was: ${cleannum(d.lhs)})`;
    else
        return "NEW: " + s;
}

function updateForReleaseDate(oldgame: FC.Game, newgame: FC.Game): string | undefined {
    var oldOfficial = cleandate(oldgame.releaseDate);
    var newOfficial = cleandate(newgame.releaseDate);
    var oldEstimate = cleandate(oldgame.estimatedReleaseDate);
    var newEstimate = cleandate(newgame.estimatedReleaseDate);
    if (newOfficial && !oldOfficial) {
        return `**${newgame.gameName}** has an official release date: **${newOfficial}**`;
    }
    else if (!newOfficial && oldOfficial) {
        var extra = "";
        if (newEstimate != oldEstimate) {
            extra = ` The new estimate is ${newEstimate} (was: ${oldEstimate})`;
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

function updateForGame(oldgame: FC.Game, newgame: FC.Game, key: string, d: any): string | undefined {
    switch (key) {
        case "released": // publishers view
        case "isReleased": // master game list view
            if (!d.lhs && d.rhs)
                return `**${newgame.gameName}** is out!`;
            else
                return;
        case "criticScore":
            if (!d.lhs && d.rhs) {
                return `**${newgame.gameName}** now has a score: **${cleannum(d.rhs)}**`;
            }
            else if (d.lhs && d.rhs && Math.abs(d.rhs - d.lhs) >= NUMERICAL_DIFF_REPORT_THRESHOLD) {
                // this could mean that maybe a critic score could slide many, many points very slowly
                // but this will have to do for now I guess
                return addLhsNum(`**${newgame.gameName}** critic score is now **${cleannum(d.rhs)}**!`, d);
            }
            else
                return undefined;
        case "fantasyPoints":
            if (d.rhs && (!d.lhs || (d.lhs && Math.abs(d.rhs - d.lhs) >= NUMERICAL_DIFF_REPORT_THRESHOLD))) {
                const points = (<FC.PublisherGame>newgame).counterPick ? -(d.rhs) : d.rhs;
                // don't report the 'was' for this, because it's covered by criticScore .. I guess..
                return `**${newgame.gameName}** is now worth **${cleannum(points)} points**!`;
            }
            else
                return undefined;
        case "willRelease":
            if (!d.lhs && d.rhs)
                return `**${newgame.gameName}** now officially **will release** during this league year.`;
            else if (d.lhs && !d.rhs)
                return `**${newgame.gameName}** now officially **will not release** during this league year.`;
        case 'estimatedReleaseDate':
        case 'releaseDate':
            return updateForReleaseDate(oldgame, newgame);
        case 'eligibilitySettings.eligibilityLevel.name':
            return addLhs(`**${newgame.gameName}** is now categorized as **\"${d.rhs}\"**.`, d);
    }
    return undefined;
}

function diffPublisherGames(oldpub: FC.Publisher, newpub: FC.Publisher, d: any): string[] {
    // d.path = publishers, N, games, ...?
    let updates: string[] = [];
    if (d.kind == 'E') {
        const gameindex = d.path[3];
        const oldgame = oldpub.games[gameindex];
        const newgame = newpub.games[gameindex];
        const update = updateForGame(oldgame, newgame, d.path[4], d);
        if (update)
            updates.push(update);
    }
    return updates;
}

interface Ranking<T> {
    rank: number,
    item: T
}

interface RankResult {
    rank: number,
    isTie: boolean
}

function makeRanks<T>(items: T[], key: ((item: T) => any) | string): Ranking<T>[] {
    if (typeof key === "string") {
        return ranked.ranking(items, (item: T) => item[key]);
    }
    else {
        return ranked.ranking(items, key);
    }
}

function getRank<T>(ranks: Ranking<T>[], item: T): RankResult {
    const ranking = ranks.find(value => value.item === item);
    return {
        'rank': ranking.rank,
        'isTie': _.filter(ranks, rp => rp.rank === ranking.rank).length > 1
    };
}

export function diffLeagueYear(oldData: FC.LeagueYear, newData: FC.LeagueYear): string[] {
    const difflist = deepdiff.diff(oldData, newData,
        (p, k) => filterAnythingButPublishers(p, k) || filterOutUninterestingKeys(p, k)
    );
    if (!difflist) {
        return [];
    }
    let updates: string[] = [];
    
    const newPublishers: FC.Publisher[] = newData.publishers || [];
    const oldPublishers: FC.Publisher[] = oldData.publishers || [];
    const sameLength = newPublishers.length == oldPublishers.length;
    const newRanks = makeRanks(newPublishers, 'totalFantasyPoints');
    const oldRanks = makeRanks(oldPublishers, 'totalFantasyPoints');

    difflist.forEach(function (d: any) {
        console.log(d);
        if (d.path[0] == "publishers" && d.path.length > 2 && sameLength) {
            const pubindex = d.path[1];
            const newpub = newPublishers[pubindex];
            const oldpub = oldPublishers[pubindex];
            if (d.path[2] == 'games') {
                updates = _.union(updates, diffPublisherGames(oldpub, newpub, d));
            }
            else if (d.path[2] == 'totalFantasyPoints') {
                const newRanking = getRank(newRanks, newpub);
                const oldRanking = getRank(oldRanks, oldpub);

                const rankStr = (newRanking.isTie ? "tied for " : "") + ordinal(newRanking.rank);

                const newScore = cleannum(d.rhs);
                const oldScore = cleannum(d.lhs);

                // skip this unless it's interesting
                if (newRanking.rank == oldRanking.rank && newRanking.isTie == oldRanking.isTie && 
                    Math.abs(d.rhs - d.lhs) < NUMERICAL_DIFF_REPORT_THRESHOLD) {
                        // don't bother
                    }
                else {
                    updates.push(`**${newpub.publisherName}** (Player: ${newpub.playerName}) has a new score: ` +
                        `**${newScore}**! (was: ${oldScore}). They are now **${rankStr}**.`);
                }
            }
        }
        else if (d.path[0] == 'publishers' && d.path.length == 1 && d.kind == 'A' && d.item && d.item.kind == 'N') {
            const newpub: FC.Publisher = d.item.rhs;
            updates.push(`New publisher added: **${newpub.publisherName}** (Player: ${newpub.playerName})`)
        }
    });
    console.log("--- Publisher updates");
    console.log(updates);
    return updates;
}

const playStatusMap = {
    "Drafting": "The draft is underway!",
    "DraftPaused": "The draft is paused!",
    "DraftFinal": "The draft is over! The league has started play!",
    "NotStartedDraft": "The draft is not yet active."
};

export function diffLeagueYearStatusAndMessages(oldData: FC.LeagueYear, newData: FC.LeagueYear): string[] {
    const difflist = deepdiff.diff(oldData, newData,
        (p, k) => filterAnythingButStatusAndMessages(p, k)
    );
    if (!difflist) {
        return [];
    }
    let updates: string[] = [];
    
    var newMessages = 0;
    difflist.forEach(function (d: any) {
        console.log(d);
        if (d.path[0] == "playStatus" && d.path.length == 2 && d.path[1] == "playStatus") {
            const newStatus = newData.playStatus.playStatus;
            updates.push(`League status update: **${_.get(playStatusMap, newStatus, "The league has entered unrecognized status '" + newStatus + "'!")}**`);
        }
        else if (d.path[0] == "managerMessages" && d.item.kind == 'N') {
            newMessages++;
        }
    });

    updates = updates.concat(newData.managerMessages.slice(0, newMessages).map(message => "New manager message: " + message.messageText));

    console.log("--- Status and messages updates");
    console.log(updates);
    return updates;
}

export function diffLeagueActions(oldLA: FC.LeagueAction[], newLA: FC.LeagueAction[]) {
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
    updates = newLA.slice(0, news).map(action => `**${action.publisherName}**: ${action.description}`);
    console.log("--- Action updates");
    console.log(updates);
    return updates;
}
