const rp = require('request-promise');
const _ = require('lodash');

gamesQueryUrl = "https://api.opencritic.com/api/game";


async function getAllGamesForYear(year) {
    var moreToGet = true;
    var skip = 0;
    var allGames = [];
    while (moreToGet) {
        const params = {
            platforms: "all",
            sort: "date",
            order: "desc",
            time: year,
            skip: skip
        }
        const thisResult = await rp.get({
            url: gamesQueryUrl,
            qs: params,
            simple: true,
            json: true
        });
        if (thisResult.length < 20) {
            moreToGet = false;
        } else {
            skip = skip + 20;
        }
        allGames.push(...thisResult);
    }
    return allGames;
}

getAllGamesForYear(2021).then( function (gamesArray) {
    gamesArray.forEach(function (game) {
        console.log(
            `${game.id}: ${game.name} - ${game.firstReleaseDate}`
        );
        if (game.topCriticScore == -1 && game.numReviews > 0) {
            console.log(`\tNo score. ${game.numReviews} reviews.`);
        }
        else if (game.topCriticScore == -1 && game.numReviews == 0) {
            console.log(`\tNo reviews.`);
        }
        else {
            console.log(`\t${round_to_precision(game.topCriticScore, 0.01)}, ${game.numReviews} reviews`);
        }
    });
    console.log(gamesArray.length, " games.");
});

function round_to_precision(x, precision) {
    var y = +x + (precision === undefined ? 0.5 : precision/2);
    return y - (y % (precision === undefined ? 1 : +precision));
}

