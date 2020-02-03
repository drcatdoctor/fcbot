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
    publishers: Publisher[],
    players: Player[]
    // missing some
}

export interface Player {
    publisher: Publisher,
    totalFantasyPoints: number,
    simpleProjetedFantasyPoints: number,
    advancedProjectedFantasyPoints: number
}

export interface LeagueAction {
    publisherName: string,
    timestamp: string,
    actionType: string,
    description: string,
    managerAction: boolean
}
