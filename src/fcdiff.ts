import * as deepdiff from 'deep-diff';
import * as FC from "./fc";
import * as _ from "lodash";

const ordinal = require('ordinal');


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
            const gamedata = newMGY[gameMasterID];
            updates.push(`New game added! **${gamedata.gameName}**, est. release ${gamedata.estimatedReleaseDate}.`);
        }
    });
    console.log("--- Master list updates");
    console.log(updates);
    return updates;
}

function addLhs(s: string, d: {
    lhs: string | null | undefined;
}): string {
    if (d.lhs)
        return s + ` (was: ${d.lhs})`;
    else
        return "NEW: " + s;
}

const DATE_REGEXP = new RegExp(/(\d\d\d\d-\d\d-\d\d)T\d\d:\d\d:\d\d/);

function cleandate(s: string) {
    if (!s)
        return s;
    const results = DATE_REGEXP.exec(s);
    if (results) {
        const justTheDate = results[1];
        return justTheDate;
    }
    else {
        return s;
    }
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
            if (d.rhs)
                return `**${newgame.gameName}** is out!`;
            else
                return;
        case "criticScore":
            if (!d.rhs) {
                return addLhs(`**${newgame.gameName}** critic score was removed??`, d);
            }
            else if (d.lhs && Math.abs(d.rhs - d.lhs) > 1.0) {
                // this could mean that maybe a critic score could slide many, many points very slowly
                // but this will have to do for now I guess
                return addLhs(`**${newgame.gameName}** critic score is now **${d.rhs}**!`, d);
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

export function diffLeagueYear(oldData: FC.LeagueYear, newData: FC.LeagueYear): string[] {
    const difflist = deepdiff.diff(oldData, newData,
        (p, k) => filterAnythingButPublishers(p, k) || filterOutUninterestingKeys(p, k)
    );
    if (!difflist) {
        return [];
    }
    let updates: string[] = [];
    // build ranking
    let rankStrings: {
        [index: string]: string;
    } = {};
    _.chain(newData.publishers).groupBy(pub => pub.totalFantasyPoints).toPairs().orderBy(0, "desc").value().forEach(function (pair, index) {
        const pubGroup = pair[1];
        const isTied = pair[1].length > 1;
        pubGroup.forEach(function (pub) {
            const rankStr = (isTied ? "tied for " : "") + ordinal(index + 1);
            rankStrings[pub.publisherName] = rankStr;
        });
    });
    difflist.forEach(function (d: any) {
        console.log(d);
        if (d.path[0] == "publishers" && d.path.length > 2) {
            const pubindex = d.path[1];
            const newpub = newData.publishers[pubindex];
            const oldpub = oldData.publishers[pubindex];
            if (d.path[2] == 'games') {
                updates = _.union(updates, diffPublisherGames(oldpub, newpub, d));
            }
            else if (d.path[2] == 'totalFantasyPoints') {
                const rankStr = rankStrings[newpub.publisherName];
                updates.push(`**${newpub.publisherName}** (Player: ${newpub.playerName}) has a new score: ` +
                    `**${d.rhs}**! (was: ${d.lhs}). They are currently **${rankStr}**.`);
            }
        }
    });
    console.log("--- Publisher updates");
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
