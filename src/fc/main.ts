import { Dictionary } from 'lodash'
import { Client } from './Client'

export { Client }

export interface League {
    id: string;
    year: number;
}

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
    releaseDate: string | null,
    averagedScore: boolean,
    projectedFantasyPoints: number
}

export interface MasterGameYear extends Game {
    year: number,
    masterGameID: string,
    minimumReleaseDate: string,
    maximumReleaseDate: string,
    earlyAccessReleaseDate: string,
    internationalReleaseDate: string,
    isReleased: boolean,
    openCriticID: number,
    averagedScore: boolean,
    tags: string[],
    subGames: MasterGameYear[],
    boxartFileName: string,
    addedTimestamp: string,
    error: boolean,
    hypeFactor: number,
    averageDraftPosition: number,
    percentStandardGame: number,
    percentCounterPick: number
    eligiblePercentStandardGame: number,
    eligiblePercentCounterPick: number,
    dateAdjustedHypeFactor: number,
    projectedOrRealFantasyPoints: number
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
    manualCriticScore: boolean,
    masterGame: MasterGameYear
    // missing some
}

export interface Publisher {
    autoDraft: boolean,
    averageCriticScore?: number,
    publisherName: string,
    playerName: string,
    games: PublisherGame[],
    gamesDictionary: Dictionary<PublisherGame> | null,   // our addition
    totalFantasyPoints: number,
    budget: number,
    draftPosition: number,
    freeDroppableGames: number,
    freeGamesDropped: number,
    gamesReleased: number,
    gamesWillRelease: number,
    leagueID: string,
    leagueName: string,
    nextToDraft: boolean,
    oustandingInvite: boolean,
    publicLeague: boolean,
    publisherID: string,
    totalProjectedPoints: number
    year: number
    // missing some
}

export interface LeagueYear {
    publishers: Publisher[],
    players: Player[],
    managerMessages: ManagerMessage[],
    gamesToDraft: number,
    counterPicks: number,
    playStatus: PlayStatus,
    draftSystem: string,
    scoringSystem: string,
    pickupSystem: string,
    standardGames: number,
    year: number,
    supportedYear: SupportedYear
    // missing some
}

export interface ManagerMessage {
    isPublic: boolean,
    messageID: string,
    messageText: string,
    timestamp: Date
}

export interface PlayStatus {
    draftFinished: boolean,
    draftIsActive: boolean,
    draftIsPaused: boolean,
    draftingCounterPicks: boolean,
    playStarted: boolean,
    playStatus: string,
    readyToDraft: boolean,
    readyToSetDraftOrder: boolean,
    startDraftErrors: string[]
}

export interface SupportedYear {
    finished: boolean,
    openForCreation: boolean,
    openForPlay: boolean,
    startDate: Date,
    year: number
}

export interface Player {
    publisher: Publisher,
    totalFantasyPoints: number,
    simpleProjectedFantasyPoints: number,
    advancedProjectedFantasyPoints: number,
    user: User,
    previousYearWinner: boolean
}

export interface User {
    displayName: string,
    leagueID: string,
    leagueName: string,
    removable: boolean,
    userID: string
}

export interface LeagueAction {
    publisherName: string,
    timestamp: string,
    actionType: string,
    description: string,
    managerAction: boolean
}

export interface LeagueUpcomingGame {
    counterPickPublisherID: string,
    counterPickPublisherName: string,
    estimatedReleaseDate: string,
    gameName: string,
    leagueID: string,
    leagueName: string,
    masterGame: MasterGameYear,
    masterGameID: string,
    maximumReleaseDate: Date,
    publisherID: string,
    publisherName: string,
    releaseDate: string,
    year: number
}
